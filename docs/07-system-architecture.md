# System architecture

---

## 1. Overview

```
                            ┌──────────────────┐
                            │    Cloudflare    │
                            │  WAF · DDoS · CDN│
                            └────────┬─────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
        ┌────────▼─────────┐                   ┌─────────▼────────┐
        │   Vercel Edge    │                   │  Application LB  │
        │  Next.js 15 SSR  │──── REST/JSON ───▶│   (Railway/ECS)  │
        │  React 18 · RSC  │   cookies+CSRF    └─────────┬────────┘
        └──────────────────┘                             │
                                              ┌──────────▼──────────┐
                                              │    NestJS API       │
                                              │  (stateless, N×)    │
                                              └──────────┬──────────┘
                    ┌──────────────┬────────────────┬────┴──────┬──────────────┐
                    │              │                │           │              │
            ┌───────▼──────┐ ┌─────▼─────┐  ┌───────▼──────┐ ┌──▼───┐ ┌────────▼───────┐
            │ PostgreSQL   │ │   Redis   │  │  Worker pool │ │  S3  │ │Provider Registry│
            │ primary +    │ │ sessions  │  │ reconcile    │ │ docs │ │  ┌───────────┐ │
            │ read replica │ │ ratelimit │  │ notify · sync│ │      │ │  │ adapters  │ │
            └──────────────┘ │ cache     │  └──────────────┘ └──────┘ │  └─────┬─────┘ │
                             └───────────┘                            └────────┼───────┘
                                                                               │
                    ┌──────────────┬──────────────┬──────────────┬─────────────┤
                    │              │              │              │             │
              ┌─────▼────┐  ┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼────┐ ┌──────▼─────┐
              │ VTU aggr.│  │  Cable     │ │  Paystack  │ │   HMOs    │ │    PFAs    │
              │ (airtime │  │  billers   │ │ Flutterwave│ │           │ │            │
              │  + data) │  │            │ │            │ │           │ │            │
              └──────────┘  └────────────┘ └────────────┘ └───────────┘ └────────────┘
```

## 2. Layering

```
┌─────────────────────────────────────────────────────────┐
│ Controllers    HTTP only. Validate (Zod) → delegate.     │
│                No business logic, ever.                  │
├─────────────────────────────────────────────────────────┤
│ Services       All business rules. Owns transaction      │
│                boundaries. Knows nothing about HTTP.     │
├─────────────────────────────────────────────────────────┤
│ Provider       Typed interfaces. The domain's only view  │
│ abstraction    of the outside world.                     │
├─────────────────────────────────────────────────────────┤
│ Adapters       One per vendor. All vendor weirdness      │
│                lives here and nowhere else.              │
├─────────────────────────────────────────────────────────┤
│ Prisma         Data access. Parameterised by default.    │
└─────────────────────────────────────────────────────────┘
```

The rule that matters: **dependencies point inward.** A service may not import an adapter class, only the interface. This is what allows a VTU aggregator swap to be a database row change.

## 3. The provider abstraction

Third-party integrations are the least stable part of this system. Vendors change pricing, change auth schemes, go down at month-end, and get replaced. Nothing in the domain layer may know a vendor's name.

```
   VtuService                         ProviderRegistry
       │                                     │
       │  resolve('VTU')                     │  queries providers table
       ├────────────────────────────────────▶│  ORDER BY priority
       │                                     │  skips open circuits
       │  ◀─── VtuAdapter (interface) ───────┤
       │                                     │
       │  execute(slug, () => adapter.purchaseAirtime(…))
       ├────────────────────────────────────▶│  circuit breaker wraps call
       │                                     │
       │  ◀─── DeliveryOutcome ──────────────┤
       │       DELIVERED | FAILED | UNKNOWN
```

**Adding a provider:**

1. Write a class implementing `VtuAdapter` (or `CableAdapter`, `PaymentAdapter`, …).
2. List it in `ProvidersModule`.
3. Insert a `providers` row with a category and priority.

No domain code changes. No migration. The registry picks it up on next resolve.

**The circuit breaker** opens after 5 consecutive failures and cools off for 60s, then half-opens and judges by the next result. Deliberately simple — anything more elaborate is hard to reason about at 2am.

Note what does *not* trip it: a provider cleanly rejecting a request (insufficient balance, invalid number) means the integration is working perfectly. Only transport-level errors count.

## 4. The three-state delivery contract

This is the architectural decision that most distinguishes this system from a demo.

```
        user taps "Buy ₦500 airtime"
                    │
     ┌──────────────▼──────────────┐
     │ TRANSACTION (Serializable)  │
     │  · create Transaction       │   both, or neither
     │  · debit wallet FOR UPDATE  │
     │  · create ServiceOrder      │
     └──────────────┬──────────────┘
                    │  commit
                    ▼
          call provider (outside the transaction —
          a slow vendor must not hold a DB lock)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   DELIVERED     FAILED      UNKNOWN
        │           │           │
        │           │           └─▶ status = REQUIRES_RECONCILIATION
        │           │               no refund. no confirmation.
        │           │               UI says "confirming".
        │           │                        │
        │           │               ┌────────▼─────────┐
        │           │               │ReconciliationJob │
        │           │               │ every 5 min      │
        │           │               │ backoff 2ⁿ min   │
        │           │               │ requery provider │
        │           │               └────────┬─────────┘
        │           │                        │
        │           │            ┌───────────┼───────────┐
        │           │            ▼           ▼           ▼
        │           │       DELIVERED     FAILED    still UNKNOWN
        │           │            │           │      after 8 tries
        │           │            │           │           │
        │           ▼            │           ▼           ▼
        │      refund +          │      refund +   refund in the
        │      notify            │      notify     user's favour,
        │                        │                 flagged for review
        ▼                        ▼
    settle + notify         settle
```

**Why UNKNOWN is never auto-refunded immediately:** the top-up may well have been delivered. Refunding it means giving away airtime we paid for. Only after 8 requeries do we refund anyway — deliberately in the user's favour, and audit-logged as `service_order.refunded_unconfirmed` so the loss is measurable rather than invisible.

**Why `Transaction` and `ServiceOrder` are separate tables:** the money movement and the delivery fail independently. A single table would have to represent "paid but not delivered" as a status on a row that also means "payment", which collapses two lifecycles into one and makes the reconciliation query incoherent.

## 5. Money handling

```
Wallet
  balance        settled funds
  ledgerBalance  balance − in-flight holds  ← what is spendable

LedgerEntry (append-only)
  direction   CREDIT | DEBIT
  amount      BigInt kobo, always positive
  balanceAfter denormalised, so statements need no replay
```

Three invariants:

1. **Money is `BigInt` kobo.** Never float, never Decimal. Naira has no sub-kobo denomination, so integer kobo is exact and immune to the rounding drift that eventually appears in any float ledger.

2. **Balance changes only inside a transaction that also writes the ledger entry.** A balance without an explaining row is corruption; the two succeed or fail together.

3. **Reads preceding writes use `SELECT … FOR UPDATE`.** Two concurrent debits that both read ₦500 and both write ₦0 let a user spend ₦1000. Optimistic version checks alone do not prevent this under real concurrency.

Corrections are **compensating entries**, never edits. A refund is a new CREDIT plus a `REVERSAL` transaction, so a user's statement shows both the charge and the return. Anything else makes disputes unanswerable.

## 6. Authentication flow

```
  POST /auth/login
        │
        ├─ unknown email? ── dummy Argon2 hash ──▶ 401 (identical timing & message)
        │
        ├─ locked? ──▶ 429 with remaining minutes
        │
        ├─ verify Argon2id
        │       │
        │       └─ fail ──▶ increment counter, exponential lock, 401
        │
        ├─ new device + no 2FA ──▶ 200 VERIFICATION_REQUIRED  (step-up + notify)
        ├─ 2FA enabled          ──▶ 200 TWO_FACTOR_REQUIRED
        │
        └─ success ──▶ create Session
                       issue access JWT   (15m, claims: sub, sid, roles, perms)
                       issue refresh      (32 random bytes, SHA-256 hash stored)
                       set __Host- cookies, HttpOnly · Secure · SameSite=Strict
```

**Why cookies, not localStorage:** localStorage is readable by any script on the page, so one XSS — in our code or a dependency — hands over the session. HttpOnly cookies are not readable by script.

**Why the `__Host-` prefix:** browsers refuse such a cookie unless it is Secure, has no Domain attribute and is Path=/. A compromised subdomain therefore cannot write a cookie we would trust. Free subdomain-takeover defence.

**Refresh rotation with reuse detection:**

```
  client presents refresh token R1
        │
        ├─ R1 already used? ──▶ REPLAY. Revoke the entire chain.
        │                       Both parties re-authenticate. Fail closed —
        │                       we cannot tell attacker from victim.
        │
        └─ valid ──▶ atomically: create R2, mark R1 used, link R1→R2
```

Rotation must be atomic. Minting R2 without burning R1 leaves both briefly valid and silently breaks reuse detection.

**Instant global revocation:** `User.tokensValidFrom` is compared against each JWT's `iat`. Bumping it invalidates every issued access token immediately rather than waiting out the 15-minute TTL. This is what makes "suspend account" and "log out everywhere" actually work.

## 7. Authorisation

Guards check **permissions** (`user:suspend`), never role names. Roles are database rows; permissions are strings carried in the JWT.

```
ThrottlerGuard  ──▶  JwtAuthGuard  ──▶  PermissionsGuard
  rate limit          authenticate         authorise
                      + live status        + audit denials
                        check
```

All three are registered globally, so **a new controller is protected by default** and must opt out explicitly with `@Public()`. Opt-in guards mean the one endpoint someone forgets to annotate is the one that leaks.

Authorisation costs no database read on the hot path because claims live in the token. That is safe because the token lives 15 minutes and any role change bumps `tokensValidFrom`.

## 8. Encryption

```
plaintext ──▶ AES-256-GCM ──▶ [1B version][12B IV][16B tag][ciphertext] ──▶ base64
```

Applied to BVN, NIN, RSA numbers, HMO member numbers and service recipients.

**Why application-layer and not just RDS encryption-at-rest:** disk encryption protects against someone walking off with a disk. It does nothing about a leaked read-replica credential, a SQL injection, or an over-broad support query — all of which return plaintext. Encrypting in the application means the database alone is not enough to expose a single BVN.

**The version byte** enables key rotation without a flag day: add key 2, new writes use it, a background job re-wraps old envelopes, then key 1 retires.

**Blind indexes** solve the search problem encryption creates. Randomised encryption means the same BVN encrypts differently each time, so "is this BVN already registered?" becomes impossible. A keyed HMAC is stable enough to index and compare, and keyed so an attacker holding the database cannot brute-force the 11-digit space offline.

## 9. Background jobs

| Job | Cadence | Purpose |
|---|---|---|
| `reconcilePendingOrders` | 5 min | Resolve UNKNOWN outcomes (§4) |
| `pruneExpiredRecords` | hourly | Expired idempotency keys, OTPs, tokens |
| Catalogue sync | nightly | Refresh data bundles and cable packages from providers |
| Valuation snapshot | daily | Precompute retirement chart series |
| Renewal reminders | daily | Health plans approaching renewal |
| Announcement fan-out | on demand | Write Notification rows for a filtered audience |

Fan-out is a job rather than part of the request because writing a row per user inline would time out on any real audience.

## 10. Request lifecycle

```
Cloudflare ─▶ Vercel/LB ─▶ helmet ─▶ cookie-parser ─▶ requestId ─▶ CORS
   ─▶ ThrottlerGuard ─▶ JwtAuthGuard ─▶ PermissionsGuard
   ─▶ ZodValidationPipe ─▶ Controller ─▶ Service ─▶ Prisma / Adapter
   ─▶ HttpExceptionFilter ─▶ response (+ X-Request-Id)
```

Every response carries a request id, echoed into error bodies and surfaced in the UI, so a user can quote it to support instead of describing the problem from memory.

The exception filter never leaks internals: a Prisma error string exposes table and column names, a stack trace exposes file paths. Both go to logs with the request id; the client receives a generic message and that id.

## 11. Data flow: dashboard

```
GET /users/me/dashboard
        │
        └─▶ UsersService.getDashboard()
                │
                └─▶ Promise.all([
                      user + profile,
                      wallet balance,
                      active health subscription,
                      retirement account,
                      pension existence,
                      recent transactions (8),
                      unread notification count,
                    ])
                │
                └─▶ one composed response
```

**One aggregate endpoint, not six parallel calls.** On a Nigerian 3G connection, request count dominates payload size — one 40KB response beats six 6KB ones. The queries run in parallel server-side where latency to the database is sub-millisecond.

## 12. Failure modes and responses

| Failure | Detection | Response |
|---|---|---|
| VTU provider down | Circuit breaker, 5 consecutive failures | Failover to next by priority; 503 if none |
| Provider times out mid-purchase | No definite outcome | REQUIRES_RECONCILIATION; requery loop |
| Database primary fails | Health check | Managed failover to standby; API returns 503 |
| Redis unavailable | Connection error | Rate limiting degrades to in-memory; sessions unaffected (JWT is stateless) |
| Refresh token replayed | Reuse detection | Revoke chain; force re-auth; alert |
| Payment webhook forged | HMAC signature check | Reject; log; never process |
| Duplicate purchase submit | Idempotency key collision | Replay original result |
| Audit write fails | Caught exception | Operation proceeds; error logged and alerted — a gap in the trail is itself a compliance issue |

---

**Next:** [Database ERD](./08-database-erd.md) · [Deployment](./15-deployment-architecture.md) · [Scalability](./16-scalability.md)
