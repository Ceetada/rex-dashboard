import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Application-layer encryption for the fields we must be able to read back:
 * BVN, NIN, RSA numbers, HMO member numbers, phone/smartcard recipients.
 *
 * Why not rely on disk encryption alone: RDS encryption-at-rest protects
 * against someone walking off with a disk. It does nothing about a leaked
 * read-replica credential, a SQL injection, or an over-broad support query —
 * all of which return plaintext. Encrypting in the application means the
 * database alone is not enough to expose a single BVN.
 *
 * AES-256-GCM is used because it authenticates as well as encrypts: a tampered
 * ciphertext fails to decrypt rather than silently yielding garbage.
 *
 * Envelope format (base64 of):  [1B version][12B IV][16B auth tag][ciphertext]
 * The version byte is what makes key rotation possible without a flag day —
 * old envelopes keep decrypting under the previous key while new writes use
 * the current one.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12;
  private readonly tagLength = 16;

  /** version byte -> 32-byte key */
  private readonly keys = new Map<number, Buffer>();
  private readonly currentVersion: number;
  private readonly blindIndexKey: Buffer;

  constructor(private readonly config: ConfigService) {
    // Keys arrive as "1:<base64>,2:<base64>" so several can be live at once.
    const raw = this.config.getOrThrow<string>('ENCRYPTION_KEYS');
    for (const entry of raw.split(',')) {
      const [version, material] = entry.split(':');
      const key = Buffer.from(material!.trim(), 'base64');
      if (key.length !== 32) {
        throw new Error(`ENCRYPTION_KEYS: version ${version} must be 32 bytes (256-bit)`);
      }
      this.keys.set(Number(version), key);
    }
    if (this.keys.size === 0) throw new Error('ENCRYPTION_KEYS must contain at least one key');
    this.currentVersion = Math.max(...this.keys.keys());

    const blindIndex = Buffer.from(this.config.getOrThrow<string>('BLIND_INDEX_KEY'), 'base64');
    if (blindIndex.length < 32) throw new Error('BLIND_INDEX_KEY must be at least 32 bytes');
    this.blindIndexKey = blindIndex;
  }

  encrypt(plaintext: string): string {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([this.currentVersion]), iv, tag, ciphertext]).toString('base64');
  }

  decrypt(envelope: string): string {
    const buf = Buffer.from(envelope, 'base64');
    const version = buf[0]!;
    const key = this.keys.get(version);
    if (!key) {
      // Retired key: the data is unreadable and that is a genuine incident, not
      // a validation error the caller can recover from.
      throw new Error(`No decryption key available for envelope version ${version}`);
    }
    const iv = buf.subarray(1, 1 + this.ivLength);
    const tag = buf.subarray(1 + this.ivLength, 1 + this.ivLength + this.tagLength);
    const ciphertext = buf.subarray(1 + this.ivLength + this.tagLength);

    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** True when an envelope was written under an older key and should be re-wrapped. */
  needsRotation(envelope: string): boolean {
    return Buffer.from(envelope, 'base64')[0] !== this.currentVersion;
  }

  /**
   * Deterministic, keyed hash for equality lookups on encrypted columns.
   *
   * Encryption is randomised (same BVN encrypts differently every time), which
   * is what we want — but it makes "is this BVN already registered?"
   * impossible. A blind index solves that: it is stable enough to index and
   * compare, and keyed so an attacker with the database cannot brute-force the
   * 11-digit space offline without also holding the key.
   */
  blindIndex(value: string): string {
    return createHmac('sha256', this.blindIndexKey)
      .update(value.trim().toLowerCase())
      .digest('base64url');
  }

  /** Constant-time comparison, for anything an attacker can submit repeatedly. */
  safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  /**
   * Hashes an IP address before storage. Under the NDPA an IP is personal data,
   * but we still need it for rate limiting and fraud review — a keyed hash keeps
   * it comparable without keeping it identifying.
   */
  hashIp(ip: string): string {
    return createHmac('sha256', this.blindIndexKey).update(ip).digest('base64url').slice(0, 32);
  }
}
