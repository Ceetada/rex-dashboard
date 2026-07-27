# Database ERD

Full definitions in [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma). This document explains the modelling decisions rather than restating the columns.

---

## 1. Identity and access

```
                    ┌──────────────┐
                    │     User     │
                    │──────────────│
                    │ email  citext│◀── case-insensitive at the DB level
                    │ phone  E.164 │
                    │ passwordHash │
                    │ status       │
                    │ kycTier      │
                    │ 2FA fields   │
                    │ lockedUntil  │
                    │tokensValidFrom│◀── instant global revocation
                    └──────┬───────┘
                           │ 1:1
         ┌─────────────────┼─────────────────┬──────────────┐
         │                 │                 │              │
   ┌─────▼─────┐    ┌──────▼──────┐   ┌──────▼──────┐ ┌─────▼──────┐
   │  Profile  │    │   Wallet    │   │Notification │ │  UserRole  │
   │───────────│    │─────────────│   │ Preference  │ │  (M:N)     │
   │ names, DOB│    │ balance     │   └─────────────┘ └─────┬──────┘
   │ address   │    │ledgerBalance│                         │
   │ stateCode ├──▶ │ version     │                   ┌─────▼──────┐
   │ lgaCode   │    └─────────────┘                   │    Role    │
   │bvnEncrypted│                                     └─────┬──────┘
   │bvnBlindIndex│◀── searchable without                    │ M:N
   │ninEncrypted │    being reversible              ┌───────▼────────┐
   └───────────┘                                    │  Permission    │
                                                    │ resource:action│
                                                    └────────────────┘
```

**Why `citext` on email.** Nigerians type email addresses in every casing imaginable. Enforcing case-insensitive uniqueness in the database beats remembering to call `.toLowerCase()` at every write site — one forgotten call creates a duplicate account.

**Why `tokensValidFrom`.** Access tokens are stateless and live 15 minutes. Without this column, suspending an account or forcing a global logout would leave the user active for up to a quarter of an hour. Comparing it against each JWT's `iat` makes revocation instant.

**Why permissions are rows, not an enum.** Roles change with the org chart; endpoints should not. Guards check `user:suspend`, so splitting "support" into two tiers never touches a controller.

**Why BVN has both an encrypted column and a blind index.** Encryption is randomised — the same BVN encrypts differently every time — which makes "is this BVN already registered?" impossible. A keyed HMAC is stable enough to index and compare, and keyed so a database thief cannot brute-force the 11-digit space offline.

## 2. Sessions and devices

```
   User ──1:N──▶ Device ──1:N──▶ Session ──1:N──▶ RefreshToken
                   │                                    │
                   │ fingerprint (hashed)               │ tokenHash (SHA-256)
                   │ trusted                            │ usedAt
                   │ lastIpHash ◀── IPs are personal    │ replacedById ──┐
                   │                data under NDPA     │                │
                   └────────────────────────────────────┘   rotation chain
                                                            (self-reference)
```

The `replacedById` self-reference forms the rotation chain. Presenting a token whose `usedAt` is set means replay — the entire chain is revoked, because we cannot distinguish attacker from victim and failing closed is the only safe answer.

Only hashes are stored. A database dump must not yield working sessions.

## 3. Money

```
        ┌──────────────┐
        │    Wallet    │
        │──────────────│
        │ balance      │  settled funds
        │ ledgerBalance│  balance − in-flight holds = spendable
        │ version      │  optimistic concurrency
        └──────┬───────┘
               │ 1:N
       ┌───────▼────────┐         ┌──────────────────┐
       │  LedgerEntry   │◀───N:1──│   Transaction    │
       │────────────────│         │──────────────────│
       │ direction      │         │ reference EVS-…  │
       │ amount BigInt  │         │ type · status    │
       │ balanceAfter   │◀── denormalised so a       │ amount · fee     │
       │ narration      │    statement needs no      │ idempotencyKey ∪ │
       │ APPEND ONLY    │    replay                  │ providerRef      │
       └────────────────┘         └────────┬─────────┘
                                           │ 1:1
                                  ┌────────▼─────────┐
                                  │  ServiceOrder    │
                                  │──────────────────│
                                  │ recipientEncrypted│
                                  │ recipientMasked  │◀── list rendering
                                  │ status           │    without decrypting
                                  │ attemptCount     │    every row
                                  └──────────────────┘
```

**`Transaction` and `ServiceOrder` are separate tables** because money movement and delivery fail independently. A wallet debit can succeed while a network fails to credit the line. Collapsing them would force one row to represent two lifecycles and make the reconciliation query incoherent.

**`LedgerEntry` is append-only.** Corrections are compensating entries, never edits, so a user's statement shows both the charge and the refund. Anything else makes disputes unanswerable.

**Money is `BigInt` kobo everywhere.** Never float, never Decimal. Naira has no sub-kobo denomination, so integer kobo is exact.

The one place `Decimal` appears is `InvestmentHolding.units` and `unitCost` — unit prices are genuinely fractional, and that is not settled cash.

## 4. Health

```
  HmoProvider ──1:N──▶ HealthPlan ──1:N──▶ PlanBenefit
       │                    │                  │ category
       │ 1:N                │ 1:N              │ limitLabel (free text)
       ▼                    ▼                  │ isIncluded ◀── exclusions
  Hospital            HealthSubscription           are rows too
   stateCode               │
   lat/lng                 ├──1:N──▶ Dependant
                           └──1:N──▶ Claim
```

**Benefits are rows, not columns.** A fourth plan is an insert. Nothing in the codebase branches on `PlanTier` for presentation — that is what makes the "support additional plans without a code change" requirement testable rather than aspirational.

**`isIncluded: false` rows exist deliberately** so a plan can state what it does *not* cover. Discovering an exclusion at a hospital counter is the worst failure this product could produce.

**`limitLabel` is free text** ("₦150,000 per year", "2 visits per quarter") because HMO benefit language is genuinely not normalisable across providers, and forcing it into a numeric schema loses meaning.

**`premiumAmount` is snapshotted onto the subscription** — the catalogue price may change, and a user's agreed premium must not change with it.

## 5. Retirement and pension

```
  RetirementAccount ──1:N──▶ RetirementContribution   (we own this)
     balance                    periodMonth (normalised to the 1st)
     totalContributed      ──▶ InvestmentHolding
     totalGrowth           ──▶ AccountValuation   ◀── precomputed chart series
                                asOfDate

  PensionFundAdmin ──1:N──▶ PensionAccount          (the PFA owns this)
                                │ rsaNumberEncrypted
                                │ rsaBlindIndex
                                │ lastSyncedAt  ◀── surfaced in the UI
                                ├──1:N──▶ PensionContribution
                                │          externalReference (dedupe on re-sync)
                                └──1:N──▶ PensionStatement
```

The two halves are deliberately separate aggregates because they are legally distinct. We are the system of record for savings; the PFA is the system of record for the RSA. Every pension row therefore carries provenance, and `lastSyncedAt` is rendered in the UI rather than hidden.

**`AccountValuation` is denormalised on purpose.** Replaying the contribution history to draw a chart gets slower every month a user stays with us, and that chart is on the dashboard path.

**`periodMonth` is normalised to the 1st** so the monthly chart is a plain `GROUP BY` rather than date arithmetic per request.

**`@@unique([accountId, externalReference])`** on pension contributions makes re-syncing a PFA feed idempotent.

## 6. Services catalogue

```
  ServiceProduct                        SavedRecipient
    serviceType  AIRTIME|DATA|CABLE|…     recipientEncrypted
    network      (null for cable)         recipientMasked
    billerCode   (null for airtime/data)  recipientBlindIndex ◀── dedupe
    externalCode ◀── the vendor's code     isFavourite
    amount / costPrice ◀── margin          useCount
```

**One table serves data bundles and cable packages** because they are the same shape: a code, a name, a price, a validity. A new biller adds rows, not tables. `ELECTRICITY` is already in the `ServiceType` enum for the same reason.

**`externalCode` is kept separate from our own identifiers** so switching aggregators does not change our public API.

**`costPrice` is never exposed** through any endpoint — margin is not the user's business, and leaking it invites arbitrage.

## 7. Operational tables

```
  AuditLog          append-only; actor, action, before/after, outcome, reason
                    records DENIED and FAILED attempts, not only successes
                    payloads field-filtered before write

  Consent           NDPA: version-stamped, revocable, provable

  IdempotencyRecord stores the response so a retry replays rather than re-executes
                    requestHash catches same-key-different-body (→ 422)

  WebhookEvent      @@unique([providerSlug, externalId]) — dedupes redeliveries
                    signatureValid recorded before processing

  Provider          category · status · priority · failureCount
                    drives registry resolution and failover ordering

  FeatureFlag       rolloutPct + userIds allowlist for dark launches
```

**The audit log is field-filtered on write.** An audit trail that faithfully captures a password hash or a decrypted BVN in its `before` payload has simply moved the breach to another table.

## 8. Indexing strategy

Indexes exist for queries the product actually runs, not speculatively:

| Index | Serves |
|---|---|
| `transactions(userId, createdAt)` | Transaction history, the most common authenticated read |
| `transactions(status, createdAt)` | Reconciliation queue |
| `service_orders(status, createdAt)` | Same |
| `ledger_entries(walletId, createdAt)` | Wallet statement |
| `health_subscriptions(renewalDate, status)` | Nightly renewal reminders |
| `notifications(userId, readAt, createdAt)` | Bell badge + list, one composite for both |
| `audit_logs(resource, resourceId)` | "Everything that happened to this record" |
| `hospitals(stateCode, city)` | Network search |
| `devices(userId, lastSeenAt)` | Device management screen |

Partial indexes on soft-delete columns (`deletedAt IS NULL`) keep the common path off deleted rows.

## 9. Data retention

| Data | Retention | Driver |
|---|---|---|
| Transactions, ledger | 7 years | CBN record-keeping |
| Audit logs | 7 years | Regulatory examination |
| OTP challenges | Until expiry, then pruned hourly | Minimisation |
| Idempotency records | 24h | Operational only |
| Sessions, refresh tokens | Until expiry + 30 days | Incident forensics |
| Webhook events | 90 days | Replay window |
| Deleted accounts | Soft-delete + PII tokenisation immediately; hard purge after the statutory window | NDPA erasure vs financial retention |

That last row is the genuine tension: NDPA grants an erasure right, and CBN mandates retention. The resolution is two-stage — tokenise the personal data now so the account is functionally erased, keep the financial record, and purge fully once the retention period expires. Detail in [17-compliance.md](./17-compliance.md).

---

**Next:** [Prisma schema](./09-prisma-schema.md) · [Architecture](./07-system-architecture.md)
