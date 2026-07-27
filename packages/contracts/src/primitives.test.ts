import { describe, expect, it } from 'vitest';

import {
  detectNetwork,
  formatNaira,
  koboToNaira,
  maskPhone,
  nairaToKobo,
  normaliseNgPhone,
  password,
} from './primitives';
import { buyAirtimeSchema } from './services';

describe('normaliseNgPhone', () => {
  it.each([
    ['08031234567', '+2348031234567'],
    ['8031234567', '+2348031234567'],
    ['+2348031234567', '+2348031234567'],
    ['2348031234567', '+2348031234567'],
    ['0803 123 4567', '+2348031234567'],
    ['0803-123-4567', '+2348031234567'],
    ['(0803) 123 4567', '+2348031234567'],
  ])('normalises %s', (input, expected) => {
    expect(normaliseNgPhone(input)).toBe(expected);
  });

  it.each([
    ['0123456789', 'unallocated prefix'],
    ['080312345', 'too short'],
    ['080312345678', 'too long'],
    ['+14155550123', 'not Nigerian'],
    ['', 'empty'],
  ])('rejects %s (%s)', (input) => {
    expect(normaliseNgPhone(input)).toBeNull();
  });
});

describe('detectNetwork', () => {
  it.each([
    ['08031234567', 'MTN'],
    ['09161234567', 'MTN'],
    ['08021234567', 'AIRTEL'],
    ['09071234567', 'AIRTEL'],
    ['08051234567', 'GLO'],
    ['09151234567', 'GLO'],
    ['08091234567', 'NINE_MOBILE'],
    ['09081234567', 'NINE_MOBILE'],
  ])('maps %s to %s', (phone, network) => {
    expect(detectNetwork(phone)).toBe(network);
  });

  it('returns null for an unallocated prefix rather than guessing', () => {
    // 0700 is Nigeria's non-geographic/toll range, not a mobile prefix. Guessing
    // a network here would silently send a top-up to the wrong aggregator.
    expect(detectNetwork('07001234567')).toBeNull();
    expect(detectNetwork('01234567890')).toBeNull();
  });
});

describe('money', () => {
  it('round-trips naira and kobo without float drift', () => {
    // 0.1 + 0.2 territory: this is precisely why the ledger is integer kobo.
    expect(nairaToKobo(1234.56)).toBe(123456);
    expect(koboToNaira(123456)).toBe(1234.56);
    expect(nairaToKobo(0.1) + nairaToKobo(0.2)).toBe(nairaToKobo(0.3));
  });

  it('formats as naira for a Nigerian audience', () => {
    expect(formatNaira(500_000)).toContain('5,000');
    expect(formatNaira(0)).toContain('0');
  });

  it('accepts BigInt straight from Prisma', () => {
    expect(koboToNaira(123456n)).toBe(1234.56);
  });
});

describe('maskPhone', () => {
  it('shows enough to recognise, not enough to dial', () => {
    expect(maskPhone('+2348031234567')).toBe('0803•••4567');
  });
});

describe('password policy', () => {
  it.each([
    ['short1A', 'too short'],
    ['alllowercase1', 'no uppercase'],
    ['ALLUPPERCASE1', 'no lowercase'],
    ['NoNumbersHere', 'no digit'],
    ['Password1', 'too short and common-ish'],
  ])('rejects %s (%s)', (value) => {
    expect(password.safeParse(value).success).toBe(false);
  });

  it('accepts a reasonable passphrase', () => {
    expect(password.safeParse('Correct-Horse7-Battery').success).toBe(true);
  });
});

describe('buyAirtimeSchema', () => {
  const base = {
    idempotencyKey: '3f1c9a2e-1f2b-4c3d-8e5f-6a7b8c9d0e1f',
    network: 'MTN' as const,
    phone: '08031234567',
    amountKobo: 100_000,
  };

  it('normalises the phone number as part of validation', () => {
    const parsed = buyAirtimeSchema.parse(base);
    expect(parsed.phone).toBe('+2348031234567');
  });

  it('enforces the network floor and ceiling', () => {
    expect(buyAirtimeSchema.safeParse({ ...base, amountKobo: 1_000 }).success).toBe(false);
    expect(buyAirtimeSchema.safeParse({ ...base, amountKobo: 9_000_000 }).success).toBe(false);
  });

  it('requires an idempotency key so a retry cannot double-charge', () => {
    const { idempotencyKey: _omitted, ...withoutKey } = base;
    expect(buyAirtimeSchema.safeParse(withoutKey).success).toBe(false);
  });
});
