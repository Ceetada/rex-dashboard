/**
 * The provider abstraction.
 *
 * Integrations with VTU aggregators, cable billers, HMOs, PFAs and payment
 * processors are the least stable part of this system: they change pricing,
 * change auth schemes, go down at month-end, and get replaced outright. The
 * core application must never import a vendor SDK or know a vendor's name.
 *
 * So: the domain talks to these interfaces. Each vendor gets an adapter class
 * that implements one. The registry resolves an adapter by category and
 * priority, with a circuit breaker in front, so failing over from one
 * aggregator to another is a database update, not a deploy.
 *
 * The result types are deliberately explicit about the *unknown* case. A VTU
 * request that times out has not necessarily failed — the top-up may well have
 * been delivered. Modelling that as a boolean success flag is how platforms end
 * up either double-crediting users or refusing legitimate refunds.
 */

export type ProviderCategory = 'VTU' | 'CABLE' | 'PAYMENT' | 'HMO' | 'PENSION' | 'MESSAGING';

export interface ProviderContext {
  /** Our own reference, passed downstream so the vendor's logs line up with ours. */
  reference: string;
  idempotencyKey: string;
  userId: string;
}

export type DeliveryOutcome =
  | { status: 'DELIVERED'; providerReference: string; raw?: unknown }
  | { status: 'FAILED'; reason: string; retryable: boolean; raw?: unknown }
  /**
   * The provider did not tell us. The order must be held and reconciled — never
   * auto-refunded and never marked delivered.
   */
  | { status: 'UNKNOWN'; providerReference?: string; reason: string; raw?: unknown };

// ── VTU: airtime and data ───────────────────────────────────────────────────

export interface AirtimeRequest extends ProviderContext {
  network: 'MTN' | 'AIRTEL' | 'GLO' | 'NINE_MOBILE';
  /** E.164. Adapters convert to whatever local format the vendor wants. */
  phone: string;
  amountKobo: number;
}

export interface DataRequest extends ProviderContext {
  network: 'MTN' | 'AIRTEL' | 'GLO' | 'NINE_MOBILE';
  phone: string;
  /** The vendor's own plan code, from ServiceProduct.externalCode. */
  externalCode: string;
  amountKobo: number;
}

export interface RemoteDataPlan {
  externalCode: string;
  name: string;
  amountKobo: number;
  validityDays: number | null;
}

export interface VtuAdapter {
  readonly slug: string;
  readonly category: 'VTU';
  purchaseAirtime(request: AirtimeRequest): Promise<DeliveryOutcome>;
  purchaseData(request: DataRequest): Promise<DeliveryOutcome>;
  /** Used by the nightly catalogue sync — vendors change bundles constantly. */
  listDataPlans(network: DataRequest['network']): Promise<RemoteDataPlan[]>;
  /** Requery by our reference. This is what resolves an UNKNOWN outcome. */
  requery(reference: string): Promise<DeliveryOutcome>;
  healthCheck(): Promise<boolean>;
}

// ── Cable ───────────────────────────────────────────────────────────────────

export interface SmartcardValidation {
  valid: boolean;
  customerName: string | null;
  currentPackage: string | null;
  dueDate: string | null;
  reason?: string;
}

export interface CableRequest extends ProviderContext {
  biller: string;
  smartcardNumber: string;
  externalCode: string;
  amountKobo: number;
}

export interface CableAdapter {
  readonly slug: string;
  readonly category: 'CABLE';
  /** Always called before purchase — confirming the name prevents mis-topups. */
  validateSmartcard(biller: string, smartcardNumber: string): Promise<SmartcardValidation>;
  subscribe(request: CableRequest): Promise<DeliveryOutcome>;
  listPackages(biller: string): Promise<RemoteDataPlan[]>;
  requery(reference: string): Promise<DeliveryOutcome>;
  healthCheck(): Promise<boolean>;
}

// ── Payments ────────────────────────────────────────────────────────────────

export interface ChargeRequest extends ProviderContext {
  amountKobo: number;
  email: string;
  channel: 'CARD' | 'BANK_TRANSFER' | 'USSD';
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeInitiation {
  /** Where to send the user to complete payment. */
  authorizationUrl: string;
  providerReference: string;
  accessCode?: string;
}

export interface ChargeVerification {
  status: 'SUCCESSFUL' | 'FAILED' | 'PENDING';
  amountKobo: number;
  providerReference: string;
  paidAt: string | null;
  channel: string | null;
  fees: number;
  raw?: unknown;
}

export interface PaymentAdapter {
  readonly slug: string;
  readonly category: 'PAYMENT';
  initiateCharge(request: ChargeRequest): Promise<ChargeInitiation>;
  /**
   * Never trust a webhook body or a client-side "payment succeeded" callback.
   * Verification is a fresh server-to-server call by reference — this is the
   * single most exploited weakness in Nigerian payment integrations.
   */
  verifyCharge(providerReference: string): Promise<ChargeVerification>;
  /** Signature check for inbound webhooks; adapters own their own scheme. */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  parseWebhook(payload: unknown): { externalId: string; eventType: string; reference: string } | null;
  healthCheck(): Promise<boolean>;
}

// ── Messaging ───────────────────────────────────────────────────────────────

export interface SmsRequest {
  to: string;
  body: string;
  /** Nigerian networks require pre-registered sender IDs for A2P traffic. */
  senderId?: string;
}

export interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  text: string;
  templateId?: string;
  variables?: Record<string, unknown>;
}

export interface MessagingAdapter {
  readonly slug: string;
  readonly category: 'MESSAGING';
  sendSms?(request: SmsRequest): Promise<{ messageId: string }>;
  sendEmail?(request: EmailRequest): Promise<{ messageId: string }>;
  healthCheck(): Promise<boolean>;
}

// ── HMO / Pension (read-mostly sync integrations) ───────────────────────────

export interface HmoAdapter {
  readonly slug: string;
  readonly category: 'HMO';
  enrolMember(input: {
    reference: string;
    planExternalCode: string;
    principal: { firstName: string; lastName: string; dateOfBirth: string; phone: string; email: string };
    dependants: Array<{ firstName: string; lastName: string; dateOfBirth: string; relationship: string }>;
  }): Promise<{ memberNumber: string; effectiveDate: string }>;
  fetchMemberStatus(memberNumber: string): Promise<{ status: string; renewalDate: string | null }>;
  listHospitals(stateCode?: string): Promise<Array<{ name: string; address: string; city: string; stateCode: string }>>;
  healthCheck(): Promise<boolean>;
}

export interface PensionAdapter {
  readonly slug: string;
  readonly category: 'PENSION';
  /** PFAs are the system of record; we mirror, we do not own. */
  fetchAccount(rsaNumber: string): Promise<{
    balanceKobo: number;
    employeeContributionsKobo: number;
    employerContributionsKobo: number;
    returnsKobo: number;
    employerName: string | null;
  } | null>;
  fetchContributions(
    rsaNumber: string,
    since: Date,
  ): Promise<Array<{ externalReference: string; amountKobo: number; periodMonth: string; type: string }>>;
  healthCheck(): Promise<boolean>;
}

export type AnyAdapter =
  | VtuAdapter
  | CableAdapter
  | PaymentAdapter
  | MessagingAdapter
  | HmoAdapter
  | PensionAdapter;
