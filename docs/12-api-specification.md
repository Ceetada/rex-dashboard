# API specification

Base URL `https://api.evas.ng/api/v1` · JSON only · OpenAPI at `/api/docs` in non-production.

---

## Conventions

**Authentication.** Session cookies, not bearer tokens, for browser clients:

```
Set-Cookie: __Host-evas_access=<jwt>;  HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900
Set-Cookie: __Host-evas_refresh=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000
```

The access token is **never** returned in a response body. `Authorization: Bearer` is accepted for native and server-to-server clients.

**Money** is always an integer in kobo, in fields suffixed `Kobo`. `120000` is ₦1,200.00.

**Errors** share one envelope:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Your wallet balance is too low for this transaction",
    "details": { "shortfallKobo": 25000 },
    "requestId": "8f3c91ab-..."
  }
}
```

`code` is stable and machine-readable; `message` is user-facing English and may change. `requestId` is echoed in `X-Request-Id` and surfaced in the UI so users can quote it to support.

**Pagination** is cursor-based — offset pagination breaks on an append-heavy ledger:

```json
{ "data": [...], "nextCursor": "uuid-or-null", "hasMore": true }
```

**Idempotency.** Every purchase endpoint requires an `idempotencyKey` in the body (and accepts the `Idempotency-Key` header). Replaying a key returns the original result rather than executing again. A key reused with a different body returns `422`.

**Rate limits.** `10/s` burst, `100/min`, `1000/hr` by default; auth and purchase endpoints are tighter. `429` includes `Retry-After`.

---

## Authentication

### `POST /auth/signup`

```json
{
  "firstName": "Chidinma", "lastName": "Okafor",
  "email": "chidinma@example.com", "phone": "08031234567",
  "password": "Correct-Horse7-Battery", "confirmPassword": "Correct-Horse7-Battery",
  "acceptedTerms": true, "marketingOptIn": false
}
```

**`201`**
```json
{ "status": "VERIFICATION_SENT" }
```

Returns the **same response whether or not the email is already registered**. A duplicate instead notifies the real owner that someone tried to register with their address. Confirming existence here would turn signup into a user-enumeration oracle.

`acceptedTerms` must be literally `true` — an unticked box is a valid answer, and NDPA requires consent to be explicit.

### `POST /auth/login`

```json
{ "email": "chidinma@example.com", "password": "…", "rememberMe": true }
```

Three possible `200` responses — a client must handle all three:

```json
{ "status": "AUTHENTICATED", "session": { "user": {...}, "expiresIn": 900 } }
```
```json
{ "status": "TWO_FACTOR_REQUIRED", "challengeId": "uuid", "method": "TOTP",
  "hint": "Enter the 6-digit code from your authenticator app" }
```
```json
{ "status": "VERIFICATION_REQUIRED", "challengeId": "uuid", "destination": "0803•••67" }
```

The third occurs on an unrecognised device **even when 2FA is off** — most account takeovers present valid credentials from a new device.

| Error | Status | Notes |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Identical message and timing for unknown email and wrong password |
| `ACCOUNT_LOCKED` | 429 | Exponential backoff, capped at 30 minutes |
| `ACCOUNT_SUSPENDED` | 401 | |

### `POST /auth/verify-otp`

```json
{ "challengeId": "uuid", "code": "391847" }
```

Returns `AUTHENTICATED` with cookies set, or `PHONE_VERIFIED`. Attempt-limited to 5 — six digits is a small space, and the cap is what actually provides the security.

### `POST /auth/refresh`

No body; reads the refresh cookie. Rotates on every use.

**`200`** `{ "expiresIn": 900 }`

**`401 SESSION_REVOKED`** — an already-used token was presented. This is replay: the entire chain is revoked and both parties must re-authenticate. Failing closed is the only safe response, since we cannot tell attacker from victim.

### Other auth endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/forgot-password` | Always `202` with the same body. 3/5min. |
| `POST` | `/auth/reset-password` | Ends **every** session on success |
| `POST` | `/auth/logout` | Clears cookies, revokes this session |
| `POST` | `/auth/logout-all` | Bumps `tokensValidFrom` — instant global revocation |
| `POST` | `/auth/2fa/setup` | Returns `secret` + `otpauthUrl`; does not enable yet |
| `POST` | `/auth/2fa/confirm` | Enables 2FA, returns 10 single-use recovery codes |
| `GET` | `/auth/devices` | |
| `DELETE` | `/auth/devices/:id` | Revokes that device's sessions |

2FA is only enabled after a valid code is produced, so a mis-scanned QR cannot lock a user out of their own account.

---

## Users

### `GET /users/me/dashboard`

The aggregate that powers the landing screen. One call, not six — on Nigerian 3G, request count dominates payload size.

**`200`**
```json
{
  "user": { "firstName": "Chidinma", "kycTier": "TIER_2", "profileCompletion": 75 },
  "wallet": { "balanceKobo": 12450000, "availableKobo": 12250000, "currency": "NGN", "isFrozen": false },
  "verification": {
    "email": true, "phone": true, "bvn": true, "twoFactor": false,
    "score": 75,
    "nextAction": { "label": "Turn on two-factor authentication", "href": "/settings/security" }
  },
  "health": { "subscriptionCount": 1, "activePlanName": "Family HMO Plan", "daysUntilRenewal": 24 },
  "retirement": { "balanceKobo": 124000000, "growthPct": 12.7, "hasPension": true },
  "recentActivity": [
    { "id": "uuid", "type": "AIRTIME_PURCHASE", "title": "MTN airtime for 0803•••4567",
      "subtitle": "EVS-8F3K2M9Q", "amountKobo": 50000, "status": "SUCCESSFUL",
      "createdAt": "2026-07-27T09:14:22.000Z" }
  ],
  "unreadNotifications": 3
}
```

`nextAction` is a single next step, computed server-side, rather than a checklist — a checklist gets dismissed, one prompt gets completed.

### `GET /users/me` · `PATCH /users/me`

Profile returns `hasBvn: boolean`, **never the value**. `PATCH` accepts only schema fields, so a client cannot smuggle `kycTier` into an update.

### `PUT /users/me/notification-preferences`

```json
{
  "emailEnabled": true, "smsEnabled": true, "pushEnabled": false, "inAppEnabled": true,
  "categoryOverrides": { "MARKETING": { "email": false, "sms": false } },
  "quietHoursStart": "22:00", "quietHoursEnd": "07:00", "timezone": "Africa/Lagos"
}
```

`SECURITY` is not an accepted category. A user cannot mute "your password was changed" — precisely the message an attacker would want suppressed.

---

## Services

### `GET /services/products?serviceType=DATA&network=MTN`

```json
[{ "id": "uuid", "serviceType": "DATA", "network": "MTN", "name": "2GB Monthly",
   "amountKobo": 100000, "validityDays": 30 }]
```

`costPrice` is never exposed.

### `POST /services/airtime`

```json
{
  "idempotencyKey": "3f1c9a2e-1f2b-4c3d-8e5f-6a7b8c9d0e1f",
  "network": "MTN", "phone": "08031234567", "amountKobo": 50000,
  "saveRecipient": true, "recipientLabel": "Mum"
}
```

**`201`**
```json
{
  "id": "uuid", "reference": "EVS-8F3K2M9Q", "serviceType": "AIRTIME", "network": "MTN",
  "recipientMasked": "0803•••4567", "amountKobo": 50000,
  "status": "DELIVERED", "failureReason": null,
  "createdAt": "…", "deliveredAt": "…"
}
```

`status` is one of `DELIVERED` · `REFUNDED` · **`REQUIRES_RECONCILIATION`**.

That third value is the important one. It means the provider neither confirmed nor denied. The order is **not** refunded and **not** confirmed — a background job requeries with backoff until the provider commits. Clients must render it as "confirming", never as success or failure. See [architecture §4](./07-system-architecture.md#4-the-three-state-delivery-contract).

| Error | Status |
|---|---|
| `INSUFFICIENT_FUNDS` (with `shortfallKobo`) | 409 |
| `WALLET_FROZEN` | 409 |
| `NO_PROVIDER_AVAILABLE` | 503 |
| `VALIDATION_FAILED` (with per-field messages) | 400 |

`503` rather than `500` when every provider is down, because it tells the client to retry.

### `POST /services/data`

Takes `productId`, never an amount — trusting a client-supplied price is how you get ₦1 purchases of ₦5,000 bundles.

### `POST /services/cable/validate` → `POST /services/cable`

Two steps, deliberately.

```json
{ "biller": "dstv", "smartcardNumber": "1234567890" }
```
```json
{ "biller": "dstv", "smartcardNumber": "1234567890",
  "customerName": "EMEKA OKAFOR", "currentPackage": "DStv Compact", "dueDate": "2026-08-12" }
```

The name must be shown before payment. Money sent to a stranger's decoder cannot be recovered, and mistyping one digit of an 11-digit number is common. The purchase endpoint **re-validates server-side** rather than trusting the echoed name.

### `GET /services/recipients` · `GET /services/orders`

Recipients return `recipientMasked` only; the full value never leaves the server.

---

## Health plans

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health-plans` | Public |
| `GET` | `/health-plans/plans/:slug` | Public |
| `GET` | `/health-plans/hospitals?stateCode=LA&city=Ikeja` | Public |
| `GET` | `/health-plans/subscriptions` | Required |
| `POST` | `/health-plans/subscriptions` | Required |
| `DELETE` | `/health-plans/subscriptions/:id` | Required |

The catalogue is public so it can be rendered and indexed before sign-up.

```json
{
  "id": "uuid", "slug": "family-hmo", "name": "Family HMO Plan", "tier": "FAMILY",
  "premiumKobo": 1200000, "billingCycle": "MONTHLY", "maxDependants": 5,
  "coverageLimitKobo": 200000000, "waitingPeriodDays": 30, "hospitalCount": 340,
  "benefits": [
    { "category": "OUTPATIENT", "title": "Outpatient care for all members",
      "limitLabel": "Unlimited", "isIncluded": true },
    { "category": "OPTICAL", "title": "Optical care", "limitLabel": null, "isIncluded": false }
  ]
}
```

**Exclusions are returned as `isIncluded: false` rows**, not omitted. A plan page that lists only inclusions leaves people to discover exclusions at a hospital counter.

Cancelling sets `autoRenew: false` and keeps cover to the end of the paid period — it does not void cover already paid for.

---

## Retirement

| Method | Path | Notes |
|---|---|---|
| `GET` | `/retirement/savings` | Balance, contributed, growth, holdings, monthly series |
| `POST` | `/retirement/savings/contribute` | Idempotent |
| `GET` | `/retirement/savings/contributions` | Cursor-paginated |
| `GET` | `/retirement/pension` | Mirrored from the PFA |

Pension responses always carry `lastSyncedAt` and the PFA's identity. We mirror rather than own this data, and a user deciding on retirement needs to know how old the number is. `rsaNumberMasked` is the only form returned.

---

## Notifications

| Method | Path |
|---|---|
| `GET` | `/notifications?unreadOnly=true` |
| `GET` | `/notifications/unread-count` |
| `PATCH` | `/notifications/read` (body: `{ "ids": [...] }`) |
| `POST` | `/notifications/read-all` |

Mutations are scoped by `userId` as well as id — a client cannot mark someone else's notification read by guessing a UUID.

---

## Admin

Every route declares the exact permission it needs. There is no "is admin" check.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/admin/metrics?days=30` | `analytics:read` |
| `GET` | `/admin/users` | `user:read` |
| `GET` | `/admin/users/:id` | `user:read` — **the read itself is audit-logged** |
| `PATCH` | `/admin/users/:id/suspend` | `user:suspend` — requires `reason`; revokes sessions |
| `PATCH` | `/admin/users/:id/reinstate` | `user:suspend` |
| `PATCH` | `/admin/users/:id/verify` | `user:verify` |
| `GET` | `/admin/transactions` | `transaction:read` |
| `GET` | `/admin/reconciliation` | `transaction:read` — sorted by age |
| `GET` | `/admin/providers/health` | `provider:read` — includes circuit state |
| `POST` | `/admin/announcements` | `announcement:create` |
| `GET` | `/admin/audit-logs` | `audit:read` |

Admin user records return `hasBvn`/`hasNin` booleans. Support has no business seeing the values.

Suspension revokes every session immediately — a status column that leaves the user signed in is a suspension in name only.

---

## Webhooks

### `POST /webhooks/:providerSlug`

Signature verified against the **raw** request body with a constant-time comparison. Re-serialising parsed JSON changes byte ordering and breaks the HMAC, which is why the app enables `rawBody`.

A webhook is only ever a hint that something happened. Amount and status are **re-fetched from the provider by reference** before any wallet is credited. Trusting the payload's `amount` field means anyone who can POST to the endpoint can mint money.

Events are deduplicated on `(providerSlug, externalId)`. Always returns `200` on receipt — a non-2xx triggers vendor retry storms.

---

## Status codes

| Code | Meaning here |
|---|---|
| `200` `201` `202` `204` | Success |
| `400` | Validation failed — `details.fields` maps field → messages |
| `401` | Not authenticated, or session revoked |
| `403` | Authenticated but lacking permission (logged as `DENIED`) |
| `404` | Not found, or not visible to this user |
| `409` | Conflict — insufficient funds, already subscribed, frozen wallet |
| `422` | Idempotency key reused with a different body |
| `429` | Rate limited or account locked |
| `503` | All providers unavailable — retry |

`500` never carries internal detail. Prisma error strings leak table and column names; stack traces leak file paths. Both go to logs with the request id.
