import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  AirtimeRequest,
  DataRequest,
  DeliveryOutcome,
  RemoteDataPlan,
  VtuAdapter,
} from '../provider.types';

/**
 * Reference VTU adapter (VTpass-shaped).
 *
 * This exists as much to demonstrate the contract as to integrate one vendor.
 * Everything vendor-specific is confined to this file: the local phone format,
 * the service-id naming, the response-code table, the auth scheme. Swapping to
 * a different aggregator means writing a sibling class and changing a row in
 * the `providers` table — no domain code moves.
 *
 * Note the response-code handling in particular. Aggregators use HTTP 200 for
 * business failures and their own numeric codes for the real outcome, and
 * several codes mean "pending", not "failed". Mapping those to UNKNOWN rather
 * than FAILED is what stops the platform refunding top-ups it actually
 * delivered.
 */
@Injectable()
export class VtpassAdapter implements VtuAdapter {
  readonly slug = 'vtpass';
  readonly category = 'VTU' as const;

  private readonly logger = new Logger(VtpassAdapter.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly timeoutMs = 30_000;

  /** Vendor service ids, kept in one place rather than sprinkled through code. */
  private readonly airtimeServiceIds: Record<AirtimeRequest['network'], string> = {
    MTN: 'mtn', AIRTEL: 'airtel', GLO: 'glo', NINE_MOBILE: 'etisalat',
  };
  private readonly dataServiceIds: Record<DataRequest['network'], string> = {
    MTN: 'mtn-data', AIRTEL: 'airtel-data', GLO: 'glo-data', NINE_MOBILE: 'etisalat-data',
  };

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('VTPASS_BASE_URL', 'https://api-service.vtpass.com/api');
    this.apiKey = this.config.get<string>('VTPASS_API_KEY', '');
    this.secretKey = this.config.get<string>('VTPASS_SECRET_KEY', '');
  }

  async purchaseAirtime(request: AirtimeRequest): Promise<DeliveryOutcome> {
    return this.purchase({
      serviceID: this.airtimeServiceIds[request.network],
      // The vendor wants local format; our domain speaks E.164 everywhere else.
      phone: this.toLocal(request.phone),
      amount: request.amountKobo / 100,
      request_id: request.reference,
    });
  }

  async purchaseData(request: DataRequest): Promise<DeliveryOutcome> {
    return this.purchase({
      serviceID: this.dataServiceIds[request.network],
      billersCode: this.toLocal(request.phone),
      variation_code: request.externalCode,
      phone: this.toLocal(request.phone),
      amount: request.amountKobo / 100,
      request_id: request.reference,
    });
  }

  async listDataPlans(network: DataRequest['network']): Promise<RemoteDataPlan[]> {
    const response = await this.call('GET', `/service-variations?serviceID=${this.dataServiceIds[network]}`);
    const content = response?.content as { variations?: Array<Record<string, string>> } | undefined;
    const variations = content?.variations ?? [];
    return variations.map((v) => ({
      externalCode: v.variation_code!,
      name: v.name!,
      amountKobo: Math.round(Number(v.variation_amount) * 100),
      validityDays: this.parseValidity(v.name!),
    }));
  }

  async requery(reference: string): Promise<DeliveryOutcome> {
    try {
      const response = await this.call('POST', '/requery', { request_id: reference });
      return this.interpret(response);
    } catch (error) {
      return {
        status: 'UNKNOWN',
        reason: error instanceof Error ? error.message : 'Requery failed',
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.call('GET', '/service-categories');
      return Boolean(response);
    } catch {
      return false;
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async purchase(payload: Record<string, unknown>): Promise<DeliveryOutcome> {
    try {
      const response = await this.call('POST', '/pay', payload);
      return this.interpret(response);
    } catch (error) {
      // A network-level failure tells us nothing about what the vendor did with
      // the request. UNKNOWN, never FAILED.
      return {
        status: 'UNKNOWN',
        reason: error instanceof Error ? error.message : 'Network error contacting provider',
      };
    }
  }

  /**
   * Maps the vendor's response codes onto our three-state outcome.
   * The `000` / `099` / `001` distinction is the whole point of this method.
   */
  private interpret(response: Record<string, unknown> | null): DeliveryOutcome {
    if (!response) return { status: 'UNKNOWN', reason: 'Empty response from provider' };

    const code = String(response.code ?? '');
    const content = response.content as Record<string, unknown> | undefined;
    const transaction = content?.transactions as Record<string, unknown> | undefined;
    const status = String(transaction?.status ?? '').toLowerCase();
    const providerReference = String(transaction?.transactionId ?? response.requestId ?? '');

    if (code === '000' && status === 'delivered') {
      return { status: 'DELIVERED', providerReference, raw: response };
    }
    // 099 = transaction is processing; 001 = pending. Both are genuinely
    // undecided, and treating either as a failure would refund a live top-up.
    if (code === '099' || code === '001' || status === 'pending' || status === 'initiated') {
      return { status: 'UNKNOWN', providerReference, reason: 'Provider is still processing', raw: response };
    }
    if (status === 'reversed' || status === 'failed') {
      return {
        status: 'FAILED',
        reason: String(response.response_description ?? 'Provider rejected the transaction'),
        retryable: false,
        raw: response,
      };
    }

    // Definite client-side rejections — retrying will not help.
    const terminal = new Set(['011', '012', '013', '014', '015', '016', '017', '018']);
    if (terminal.has(code)) {
      return {
        status: 'FAILED',
        reason: String(response.response_description ?? 'Transaction rejected'),
        retryable: false,
        raw: response,
      };
    }

    return {
      status: 'UNKNOWN',
      providerReference,
      reason: `Unrecognised provider code ${code}`,
      raw: response,
    };
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    // AbortController rather than a bare fetch: an aggregator that hangs must
    // not hold a request open indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
          'secret-key': this.secretKey,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Provider returned HTTP ${response.status}`);
      }
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  private toLocal(e164: string): string {
    return e164.startsWith('+234') ? `0${e164.slice(4)}` : e164;
  }

  private parseValidity(name: string): number | null {
    if (/monthly|30\s*days/i.test(name)) return 30;
    if (/weekly|7\s*days/i.test(name)) return 7;
    if (/daily|1\s*day/i.test(name)) return 1;
    const match = /(\d+)\s*days?/i.exec(name);
    return match ? Number(match[1]) : null;
  }
}
