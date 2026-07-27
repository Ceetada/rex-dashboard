import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  ChargeInitiation,
  ChargeRequest,
  ChargeVerification,
  PaymentAdapter,
} from '../provider.types';

/**
 * Paystack payment adapter.
 *
 * The two things this file gets right that integrations routinely get wrong:
 *
 *  1. Webhook signatures are verified against the *raw* request body with a
 *     constant-time comparison. Re-serialising the parsed JSON changes byte
 *     ordering and whitespace, so the HMAC no longer matches — which is why
 *     main.ts enables rawBody.
 *
 *  2. A webhook is only ever a hint that something happened. The amount and
 *     status are re-fetched from Paystack by reference before a wallet is
 *     credited. Trusting the webhook payload's `amount` field means anyone who
 *     can POST to the endpoint can mint money.
 */
@Injectable()
export class PaystackAdapter implements PaymentAdapter {
  readonly slug = 'paystack';
  readonly category = 'PAYMENT' as const;

  private readonly logger = new Logger(PaystackAdapter.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY', '');
  }

  async initiateCharge(request: ChargeRequest): Promise<ChargeInitiation> {
    const response = await this.call('POST', '/transaction/initialize', {
      email: request.email,
      amount: request.amountKobo, // Paystack works in kobo, as we do
      reference: request.reference,
      callback_url: request.callbackUrl,
      channels: [request.channel.toLowerCase().replace('_', '')],
      metadata: { ...request.metadata, userId: request.userId },
    });

    const data = response?.data as Record<string, string> | undefined;
    if (!data?.authorization_url) throw new Error('Paystack did not return an authorization URL');

    return {
      authorizationUrl: data.authorization_url,
      providerReference: data.reference!,
      accessCode: data.access_code,
    };
  }

  async verifyCharge(providerReference: string): Promise<ChargeVerification> {
    const response = await this.call('GET', `/transaction/verify/${encodeURIComponent(providerReference)}`);
    const data = response?.data as Record<string, unknown> | undefined;
    if (!data) throw new Error('Empty verification response');

    const status = String(data.status);
    return {
      status: status === 'success' ? 'SUCCESSFUL' : status === 'failed' ? 'FAILED' : 'PENDING',
      // This amount — from a server-to-server call — is the only one we trust.
      amountKobo: Number(data.amount ?? 0),
      providerReference: String(data.reference),
      paidAt: data.paid_at ? String(data.paid_at) : null,
      channel: data.channel ? String(data.channel) : null,
      fees: Number(data.fees ?? 0),
      raw: data,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!signature) return false;
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    // Length check first: timingSafeEqual throws on a mismatch rather than
    // returning false, and the length itself is not a secret.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): { externalId: string; eventType: string; reference: string } | null {
    const event = payload as { event?: string; data?: { id?: number; reference?: string } };
    if (!event?.event || !event.data?.reference) return null;
    return {
      // Paystack's own event id, used to dedupe redeliveries.
      externalId: String(event.data.id ?? event.data.reference),
      eventType: event.event,
      reference: event.data.reference,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      return Boolean(await this.call('GET', '/bank?country=nigeria&perPage=1'));
    } catch {
      return false;
    }
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok || json.status === false) {
        throw new Error(String(json.message ?? `Paystack returned HTTP ${response.status}`));
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}
