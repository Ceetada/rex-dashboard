# Testing strategy

The shape is a pyramid, but the *emphasis* is unusual: the money and security paths get integration tests against real infrastructure, because those are the places where a mock proves nothing.

```
        ╱ E2E ╲            ~25 journeys — Playwright, real browser
      ╱─────────╲
    ╱ Integration ╲        ~150 — real Postgres + Redis via testcontainers
  ╱─────────────────╲
╱       Unit          ╲    ~600 — pure logic, no I/O
```

---

## Unit tests

**What belongs here:** pure functions and decision logic with no I/O.

Already written and passing:

- **`packages/design-tokens/contrast.test.ts`** — 45 assertions covering every foreground/background pairing the system ships, in both themes, with translucent tints flattened over their real backdrop. This is what makes "accessible" a build gate rather than a review note. It caught two genuine failures during construction.

- **`packages/contracts/primitives.test.ts`** — 34 assertions on Nigerian phone normalisation across every format users actually type, network detection per NCC prefix allocation, kobo/naira round-tripping without float drift, masking, and password policy.

- **`apps/api/wallet.service.spec.ts`** — 11 assertions pinning the behaviours that cost real money if they regress: a debit never overdraws (including the off-by-one kobo boundary), a frozen wallet still accepts refunds, and a refund is idempotent.

**What does not belong here:** anything asserting that a mock was called. A test that mocks Prisma and then asserts Prisma was called tests nothing.

---

## Integration tests

**Real Postgres and Redis via testcontainers.** Not in-memory substitutes — the behaviours under test are transaction isolation and row locking, which no substitute reproduces.

### The concurrency suite

This is the most important suite in the repository:

```ts
it('cannot double-spend under parallel debits', async () => {
  await seedWallet(userId, 50_000n);          // ₦500

  const results = await Promise.allSettled([
    buyAirtime(userId, 50_000n),
    buyAirtime(userId, 50_000n),
  ]);

  // Exactly one succeeds. The row lock decides which.
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(await balanceOf(userId)).toBe(0n);
  expect(await ledgerCount(userId)).toBe(1);
});
```

A mocked version of this test passes with a broken implementation. Only a real database proves `SELECT … FOR UPDATE` is doing its job.

### Provider failure matrix

Every adapter is tested against a fake provider that can be told to fail in specific ways:

| Provider behaviour | Required outcome |
|---|---|
| Success | `DELIVERED`, wallet debited once |
| Clean rejection | `REFUNDED`, wallet restored, circuit **not** tripped |
| Timeout | `REQUIRES_RECONCILIATION`, **no refund**, no confirmation |
| 5 consecutive transport errors | Circuit opens, next request fails over |
| Requery says delivered | Settles, user notified |
| Requery says failed | Refunds, user notified |
| 8 requeries all unknown | Refunds in the user's favour, flagged for review |

The timeout row is the one that matters. An implementation that refunds on timeout passes a naive test suite and loses money in production.

### Security suite

- Refresh-token replay revokes the whole chain
- Unknown email and wrong password are indistinguishable in message and timing
- Expired and future-dated tokens rejected
- `tokensValidFrom` bump invalidates issued access tokens immediately
- Permission guard denies and audit-logs
- A user cannot read or mutate another user's resources by guessing UUIDs
- Zod strips unknown fields — `{ "kycTier": "TIER_3" }` in a profile update never reaches the service
- Webhook signature verification rejects tampered bodies
- SQL injection attempts through every string parameter

### Idempotency suite

- Same key twice → one charge, identical response
- Same key, different body → `422`
- Key belonging to another user → rejected
- Concurrent requests with the same key → one execution

---

## End-to-end tests

Playwright, against a real build with seeded data. Roughly 25 journeys covering the paths from [personas and journeys](./03-personas-and-journeys.md), including:

- Signup → email verify → phone OTP → dashboard
- Login → 2FA → dashboard
- Buy airtime with a saved recipient (asserts ≤3 interactions)
- Purchase with a forced provider timeout → **asserts the receipt says "Confirming", not "Delivered"**
- Insufficient funds → inline top-up prompt
- Cable: validate → confirm name → pay
- Health enrolment with dependants
- Retirement contribution → chart updates
- Device revocation → that session is dead
- Admin suspends a user → user's next request 401s

### Accessibility in CI

`@axe-core/playwright` runs on every major screen in both themes. Zero violations is a merge gate, not a report.

Additionally asserted:

- Full keyboard traversal with a visible focus ring at every step
- The wallet balance is above the fold at 360×640
- Screen-reader announcements on form errors and status changes

---

## What is deliberately not tested

**Third-party APIs.** We test our adapters against fakes that reproduce documented behaviour. Testing Paystack tests Paystack.

**Framework behaviour.** No tests that Next.js routes or that Prisma generates SQL.

**Visual pixel diffing.** High maintenance, low signal. The contrast tests cover the accessibility-critical properties; the rest is review.

---

## Coverage targets

| Area | Target | Why |
|---|---|---|
| `wallet/`, `services/`, `auth/` | 95% | Money and security |
| Other services | 85% | |
| Controllers | 70% | Thin by design |
| UI components | 60% | E2E covers integration |
| Design tokens | 100% | Small, and entirely correctness |

Coverage is a floor, not a goal. A 95% number on the wallet module means nothing if the concurrency test is missing.

---

## CI pipeline

```
lint → typecheck → unit → build → integration (containers) → e2e → a11y
```

Merge blockers: any test failure, any type error, any axe violation, coverage below floor on the money and security paths.
