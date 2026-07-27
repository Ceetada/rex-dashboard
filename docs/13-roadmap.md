# Development roadmap

Phases are ordered by dependency and by risk, not by visible progress. The riskiest unknowns are pulled forward deliberately.

---

## Phase 0 — Foundations ✅ *complete*

| Deliverable | Status |
|---|---|
| Monorepo, workspace tooling, shared tsconfig | ✅ |
| Design tokens generated from the logo; 45 contrast assertions passing | ✅ |
| Prisma schema (37 models), validated | ✅ |
| Shared contracts package with Nigerian primitives, 34 tests passing | ✅ |
| NestJS skeleton: config validation, global guards, error envelope | ✅ |
| Next.js skeleton: theme, primitives, app shell | ✅ |

**Exit criterion met:** `pnpm typecheck` and `pnpm test` pass; both apps build.

---

## Phase 1 — Identity (3 weeks)

Nothing else can be built on an auth layer that has to be revisited.

- Signup → email verification → phone OTP → active
- Argon2id, exponential lockout, constant-work path for unknown emails
- JWT + refresh rotation with reuse detection
- Device recognition, step-up challenge, device management UI
- TOTP 2FA with recovery codes
- Password reset that terminates all sessions
- RBAC seeded; permission guard enforcing
- Audit logging on every auth event

**Exit:** a full security review of the auth surface passes, and the integration suite covers replay detection, lockout, and enumeration resistance.

**Parallel, non-engineering, starts now:** CBN licensing conversations, HMO partner accreditation, PFA API access. These have long lead times and one of them (CBN) is a launch blocker.

---

## Phase 2 — Money (3 weeks)

- Wallet, append-only ledger, `FOR UPDATE` locking
- Paystack adapter: initialise, verify, webhook with signature verification
- Funding by card, transfer and USSD
- Idempotency middleware and record table
- Statement UI
- Reconciliation job skeleton

**Exit:** a concurrency test proves no double-spend under parallel debits against a real Postgres. Money invariants hold under load.

---

## Phase 3 — Digital services (4 weeks)

The habit-forming hook, and the first revenue.

- Provider registry, circuit breaker, failover
- VTU adapter (airtime + data), cable adapter
- Three-state delivery contract end to end
- Reconciliation with backoff and give-up refund
- Airtime, data and cable UIs; saved recipients; history
- Admin reconciliation queue

**Exit:** deliberate provider-failure drills produce correct outcomes — no double charges, no unrefunded failures, and every UNKNOWN resolves or refunds within the SLA.

---

## Phase 4 — Health (3 weeks)

- Catalogue, benefit and exclusion rendering
- Enrolment with dependants; premium snapshotting
- Hospital network search
- Renewal reminders, auto-renew, cancellation
- HMO adapter (or manual enrolment fallback if accreditation is still pending)
- Admin plan management

**Exit:** adding a fourth plan requires only a database insert. This is tested, not assumed.

---

## Phase 5 — Retirement (3 weeks)

- Savings account, contributions, auto-debit (day ≤28)
- Holdings, valuations, monthly chart
- Pension linking, PFA sync adapter, statements
- Provenance labelling throughout

**Exit:** pension figures always render with `lastSyncedAt`; savings works fully with no RSA linked.

---

## Phase 6 — Platform completion (3 weeks)

- Notifications: all channels, preferences, quiet hours, suppression records
- Profile, address with state/LGA validation, avatar upload
- Support tickets
- Admin: metrics, user management, announcements, audit browser
- Data export and account deletion (NDPA)

---

## Phase 7 — Hardening and launch (4 weeks)

- External penetration test; remediation
- Load test to 10× projected launch traffic
- Full accessibility audit (axe + manual screen-reader passes)
- Runbooks, on-call rotation, alerting
- NDPA compliance review; DPIA sign-off
- Closed beta (~200 users), then staged rollout

**Exit:** pen-test findings closed, error budget defined, rollback rehearsed.

---

## Post-launch

**Q1** — PWA install and offline shell · Yoruba, Hausa and Igbo localisation · claims submission · electricity bills (the adapter and schema already support it) · referrals

**Q2** — second VTU aggregator for real failover · recurring auto-payments · household sub-accounts · React Native app sharing `@evas/contracts`

**Q3+** — wallet withdrawal (requires the CBN position resolved) · insurance beyond health · employer portal for group plans · savings goals

---

## Sequencing rationale

**Why identity first:** every other module depends on it, and retrofitting security is how vulnerabilities ship.

**Why money before services:** services spend money. Building purchases on an unproven ledger means debugging two systems at once.

**Why services before health:** services are the frequency hook that makes health conversion possible, and they exercise the provider abstraction under real failure conditions before anything higher-value depends on it.

**Why compliance runs in parallel from week one:** CBN licensing has a multi-month lead time and is a hard launch blocker. Starting it in Phase 7 would mean a finished product with nowhere to go.
