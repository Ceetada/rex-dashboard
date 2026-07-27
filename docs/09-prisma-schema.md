# Prisma schema

The schema is a real, validating artefact rather than a document listing: **[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)**.

```bash
cd apps/api
pnpm prisma validate    # ✓ passes
pnpm prisma generate
pnpm prisma migrate dev
pnpm prisma:seed
```

## What it contains

**37 models** across seven domains:

| Domain | Models |
|---|---|
| Identity & access | `User` `Profile` `State` `Lga` `Role` `Permission` `RolePermission` `UserRole` |
| Sessions | `Device` `Session` `RefreshToken` `OtpChallenge` `RecoveryCode` `VerificationToken` |
| Money | `Wallet` `LedgerEntry` `Transaction` |
| Health | `HmoProvider` `HealthPlan` `PlanBenefit` `Hospital` `HealthSubscription` `Dependant` `Claim` |
| Retirement | `RetirementAccount` `RetirementContribution` `InvestmentHolding` `AccountValuation` `PensionFundAdmin` `PensionAccount` `PensionContribution` `PensionStatement` |
| Services | `Provider` `ServiceProduct` `ServiceOrder` `SavedRecipient` |
| Ops & compliance | `Notification` `NotificationDelivery` `NotificationPreference` `Announcement` `SupportTicket` `TicketMessage` `AuditLog` `Consent` `IdempotencyRecord` `WebhookEvent` `FeatureFlag` |

## Conventions enforced throughout

**Money is `BigInt` kobo.** Never `Float`, never `Decimal`. Naira has no sub-kobo denomination, so integer kobo is exact and immune to the rounding drift that eventually surfaces in any float ledger. The single exception is `InvestmentHolding.units`/`unitCost`, where `Decimal(20,6)` is correct — unit prices are genuinely fractional and are not settled cash.

**Encrypted columns are suffixed `Encrypted`** and hold an AES-256-GCM envelope produced by `EncryptionService`, not raw values. Applies to BVN, NIN, RSA numbers, HMO member numbers and service recipients.

**Searchable encrypted columns carry a `BlindIndex` sibling** — a keyed HMAC that makes uniqueness checks and lookups possible without a reversible copy.

**Masked duplicates exist where lists must render cheaply.** `ServiceOrder.recipientMasked` lets a 50-row history page render without 50 decryptions.

**`deletedAt` marks soft deletion.** Erasure is two-stage: tokenise PII immediately, hard purge after the statutory retention window.

**Every human-mutable table is covered by `AuditLog`.**

## Enums as extension points

Several enums are deliberately open to extension without migration pain:

- `ServiceType` already includes `ELECTRICITY` — the adapter and catalogue shapes support it today.
- `BenefitCategory` covers eleven categories; adding a twelfth is additive and the UI renders whatever it is given.
- `ProviderCategory` spans VTU, cable, payment, HMO, pension and messaging.

## The status enum that matters

```prisma
enum TransactionStatus {
  PENDING
  PROCESSING
  SUCCESSFUL
  FAILED
  REVERSED
  REQUIRES_RECONCILIATION   // ← the one naive implementations omit
}
```

`REQUIRES_RECONCILIATION` is not an error state. It means the provider neither confirmed nor denied, so the outcome is genuinely unknown and must be resolved before we either settle or refund. See [architecture §4](./07-system-architecture.md#4-the-three-state-delivery-contract).

## Seeding

[`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts) is idempotent (upsert by natural key) so it can be re-run against any environment, including production — it is the mechanism for rolling out a new plan or provider.

It seeds: 24 permissions · 5 roles · 37 states · LGAs · 6 providers · 3 health plans with full benefit and exclusion lists · data bundles for 4 networks · 13 cable packages.
