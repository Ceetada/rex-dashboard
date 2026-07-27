# Compliance considerations

> **Not legal advice.** This is an engineering assessment of the obligations that shape the system's design. Nigerian counsel must review before launch, and two items below are **hard launch blockers**.

---

## 1. The launch blockers

Stating these first because they change what can be shipped, not merely how.

### 1.1 CBN — the wallet holds customer funds

A stored-value balance a customer can load and spend is regulated activity in Nigeria. Operating it requires either:

- a **CBN licence** (Payment Service Provider / Mobile Money Operator), or
- a **partnership with a licensed institution**, where the licensed partner holds the funds and Evas operates as a technical layer.

**Nothing that holds real customer money may go live until this is resolved.**

The architecture anticipates a bad answer here. `WalletService` is a single, isolated seam: if the licensing route fails, a pass-through model — where each purchase charges a card directly and no balance is ever stored — substitutes behind the same interface without touching the service layer. That substitution is the contingency, and it is the reason the wallet was not spread across the codebase.

### 1.2 NHIA — health plan distribution

Health plans may only be distributed for **NHIA-accredited HMOs**. The `HmoProvider` model carries `accreditationNo` for this reason, and it must hold a real number before any plan is sold.

Accreditation lead time is measured in months. Started in Phase 0, not Phase 4.

---

## 2. Nigeria Data Protection Act 2023

The NDPA is the obligation with the widest reach across the codebase.

### 2.1 Lawful basis

Every processing purpose is mapped to a basis, and the mapping determines whether a user may refuse:

| Purpose | Basis | Can the user refuse? |
|---|---|---|
| Account creation, authentication | Contract | No — it is the service |
| Processing transactions | Contract | No |
| BVN/NIN for KYC | Legal obligation | No — but they can decline and stay at a lower tier |
| Security notifications | Legitimate interest | **No** — enforced in `NotificationsService` |
| Marketing | **Consent** | Yes, freely and at any time |
| Analytics | Legitimate interest | Yes, opt-out |

The security-notification row is a design constraint, not a policy statement: `resolveChannels()` returns `['IN_APP','EMAIL','SMS']` for `SECURITY` before it ever reads preferences, and the preferences schema does not accept `SECURITY` as an overridable category. A user cannot mute "your password was changed" — which is exactly the message an attacker wants suppressed.

### 2.2 Consent must be provable

The `Consent` model records type, **version**, granted/revoked, timestamp and hashed IP. Version-stamping means a policy change re-prompts only the users who have not accepted the new text.

`acceptedTerms` in the signup schema is `z.literal(true)` — a pre-ticked or defaulted box is not consent under the NDPA, and typing it as a literal makes that unrepresentable rather than merely discouraged.

### 2.3 Data subject rights

| Right | Implementation | Status |
|---|---|---|
| Access | `GET /users/me/export` — machine-readable, all personal data | Phase 6 |
| Rectification | Profile editing | ✅ |
| **Erasure** | Two-stage — see below | Phase 6 |
| Portability | JSON export | Phase 6 |
| Objection | Notification preferences | ✅ |
| Withdraw consent | Marketing toggle, effective immediately | ✅ |

**Erasure is genuinely hard, and the tension is real.** NDPA grants a right to deletion. CBN mandates seven-year retention of financial records. These conflict directly.

The resolution is two-stage:

1. **On request:** soft-delete the account, revoke all sessions, and **tokenise the PII** — replace name, email, phone, BVN, NIN and address with irreversible tokens. The person is no longer identifiable from the record. The financial history survives as anonymous rows.
2. **After the statutory retention window:** hard purge.

This satisfies erasure in substance — the data no longer identifies a person — while preserving the audit trail the financial regulator requires. It is documented here because it is the kind of decision that looks like a compromise until the reasoning is written down.

### 2.4 Data minimisation

| Decision | Effect |
|---|---|
| Admin list views return `hasBvn: boolean` | Support never sees a BVN, at all |
| `ServiceOrder.recipientMasked` alongside the encrypted value | History renders without decrypting 50 rows |
| IPs stored as keyed hashes | Comparable for fraud review, not identifying |
| `costPrice` never exposed | Not the user's data, and not their business |
| Audit payloads field-filtered on write | The audit log is not a second breach surface |

### 2.5 Breach notification

**72 hours** to the Nigeria Data Protection Commission; affected individuals without undue delay where risk is high.

The audit log is what makes a breach assessment possible at all: it answers *what* was accessed, *by whom*, and *when*. Without it, a breach notification is guesswork, and guesswork tends toward over-notification.

### 2.6 Cross-border transfer

Data resides in AWS `eu-west-1` (Ireland). NDPA permits transfer to jurisdictions with adequate protection; the EU qualifies. Standard contractual clauses with sub-processors.

If Nigerian residency becomes mandatory, the database tier moves to a local provider with **no application change** — nothing in the codebase assumes a region.

---

## 3. CBN operational requirements

Beyond licensing:

| Requirement | Implementation |
|---|---|
| KYC tiering with transaction limits | `KycTier` enum; limits enforced in the service layer |
| Transaction records, 7 years | Append-only ledger, partitioned, archived |
| Audit trail for examination | `AuditLog`, immutable, queryable by actor and resource |
| AML monitoring | Velocity checks; suspicious-pattern flagging (Phase 6) |
| Consumer complaints | Support tickets with SLA tracking |
| Dispute resolution | Every transaction carries a human reference and full provider payload |

### KYC tiers

| Tier | Requires | Wallet cap | Per transaction |
|---|---|---|---|
| 0 | Email | ₦0 | Cannot transact |
| 1 | Phone verified | ₦50,000 | ₦20,000 |
| 2 | BVN or NIN | ₦500,000 | ₦200,000 |
| 3 | Full KYC + address | ₦5,000,000 | ₦1,000,000 |

Indicative figures pending regulatory confirmation. The tier is stored on `User` so it is queryable, and enforced in the service layer rather than the UI — a client-side limit is not a limit.

---

## 4. PenCom

We do **not** administer pension funds. We display RSA data with the user's explicit consent, and the PFA remains the system of record.

The engineering consequences are visible in the product:

- Every pension figure carries `lastSyncedAt`, rendered in the UI
- The retirement screen shows a provenance banner naming the PFA
- Estimated benefits state their assumptions inline — an unqualified projection reads as a promise

Linking an RSA requires the user's consent, recorded as a `Consent` row.

---

## 5. Security controls mapped to obligations

| Control | Implementation | Obligation |
|---|---|---|
| Encryption in transit | TLS 1.3, HSTS preload | NDPA §39 |
| Encryption at rest | AES-256-GCM application-layer + RDS | NDPA §39 |
| Access control | RBAC, permission-level | NDPA, CBN |
| Audit logging | Every mutation and privileged read | CBN, NDPA |
| MFA | TOTP + recovery codes | CBN |
| Session management | Rotation, reuse detection, device binding | CBN |
| Rate limiting | Tiered, per endpoint cost | Availability |
| Input validation | Zod at every boundary | OWASP |
| Secrets management | AWS Secrets Manager, versioned keys | NDPA §39 |
| Penetration testing | Annual + on major change | CBN |
| Incident response | Runbooks, 72h notification path | NDPA §40 |

---

## 6. Consumer protection

**Advertising.** Health plan pages must show exclusions as prominently as inclusions — implemented as `isIncluded: false` benefit rows rendered on the card, not behind a link. Retirement projections must state assumptions.

**Pricing transparency.** No hidden fees. `Transaction.fee` is a separate field and is shown.

**Refunds.** Automatic and prompt for failed purchases. Where an outcome cannot be confirmed after repeated attempts, the refund goes **in the user's favour** and is audit-logged as `service_order.refunded_unconfirmed` — so the cost of that policy is measured rather than hidden.

**Complaints.** Every transaction carries a reference a user can read aloud to support. Support can see the state without escalating to an engineer.

---

## 7. Pre-launch checklist

- [ ] **CBN position resolved** — licence obtained or partner agreement executed *(blocker)*
- [ ] **HMO partner NHIA-accredited**, accreditation number on file *(blocker)*
- [ ] NDPC registration as a data controller
- [ ] DPIA completed and signed off
- [ ] Data Protection Officer appointed
- [ ] Privacy policy and terms reviewed by Nigerian counsel
- [ ] Sub-processor agreements (AWS, Vercel, Paystack, aggregators)
- [ ] External penetration test passed, findings closed
- [ ] Incident response runbook tested, not merely written
- [ ] Backup restore drill completed and timed
- [ ] Retention automation implemented and verified
- [ ] Data export and erasure flows tested end to end
- [ ] Staff access review; least privilege confirmed
- [ ] Accessibility audit passed (WCAG 2.2 AA)

The two blockers gate launch entirely. Everything else gates general availability.
