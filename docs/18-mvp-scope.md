# MVP scope and future enhancements

---

## The shape of the MVP

The MVP is built around one bet: **high-frequency utility earns the attention that high-value products need.**

People buy airtime fifteen times a month and check their pension twice a year. So the MVP ships airtime, data and cable as genuinely excellent — faster than the bank app they use today — and puts health and retirement in front of them every time they open it.

Cutting either half breaks the model. Ship only the services and it is a commodity VTU app competing on price. Ship only health and retirement and nobody opens it.

---

## In scope

### Identity ✅
Signup with email verification · phone OTP · Argon2id passwords · JWT with rotation and reuse detection · TOTP 2FA with recovery codes · device recognition and step-up · remember me · device management · password reset that ends all sessions · RBAC

### Wallet
Fund by card, transfer and USSD · exact append-only ledger · full statement · automatic refunds · hide balance

**Not in scope: withdrawal to a bank account.** Money out changes our regulatory position materially, and the MVP does not need it.

### Digital services ✅
Airtime on all four networks · data bundles · DStv, GOtv and Startimes · network auto-detection · saved recipients and favourites · full history · **three-state delivery with automatic reconciliation**

### Health ✅
Three plans (Basic, Family, Premium) · full benefits **and exclusions** · enrolment with dependants · hospital network search by state and city · renewal reminders · auto-renew and cancellation · masked member numbers

### Retirement ✅
Voluntary savings account · manual and auto-debit contributions · balance, contributed and growth as three separate figures · monthly chart · investment allocation · RSA linking · pension balance with employee/employer split · statements · provenance labelling throughout

### Profile and notifications
Full profile with state/LGA validation · avatar · password and phone change · per-channel and per-category preferences · quiet hours · in-app, email and SMS

### Admin ✅
Metrics · user management with granular permissions · suspend and reinstate · KYC verification · transaction browser · **reconciliation queue** · provider health · announcements · support tickets · audit log browser

*(✅ = designed and substantially implemented in this repository)*

---

## Explicitly out of scope

| Excluded | Why |
|---|---|
| Wallet withdrawal | Changes the regulatory position; not needed to prove the model |
| Card issuing, lending | Different product, different licence |
| Insurance beyond health | Focus |
| Investment marketplace | Focus, and a materially different compliance surface |
| Cryptocurrency | Regulatory uncertainty; no user need |
| Bill splitting, social features | Every fintech planning session produces these; none of them serve the thesis |
| USSD | Real and large market, but a different product — not a responsive breakpoint |
| Native mobile app | The web app installs as a PWA. Native comes when the model is proven. |
| Multi-currency | Nigeria only |
| Local-language UI | Planned for Q1, not launch |
| Claims submission | Health MVP is enrolment and visibility; claims needs deeper HMO integration |
| Employer/group plans | B2B is a different motion |

The pattern: **anything that dilutes "one place for health, retirement and everyday services" is out**, however easy it would be to build.

---

## Launch criteria

A feature list is not a launch bar. These are:

**Correctness**
- [ ] Zero double-spends under concurrent load testing
- [ ] Every UNKNOWN provider outcome resolves or refunds within SLA
- [ ] Idempotency proven under concurrent duplicate submission
- [ ] Money invariants hold: every balance change has an explaining ledger entry

**Security**
- [ ] External penetration test passed, findings closed
- [ ] No user can access another user's data by guessing identifiers
- [ ] Refresh-token replay revokes the chain
- [ ] Suspension terminates sessions immediately

**Compliance**
- [ ] **CBN position resolved** *(blocker)*
- [ ] **HMO partner NHIA-accredited** *(blocker)*
- [ ] NDPC registration; DPIA signed off
- [ ] Data export and erasure tested end to end

**Experience**
- [ ] Repeat airtime purchase ≤10s, ≤3 taps
- [ ] Dashboard p95 < 800ms on simulated 3G
- [ ] Zero axe violations across all screens, both themes
- [ ] Works at 200% zoom and via keyboard alone

**Operations**
- [ ] Runbooks written **and rehearsed**
- [ ] Backup restore drilled and timed
- [ ] Alerting verified by deliberately triggering each alert
- [ ] On-call rotation staffed

---

## Post-MVP

**Q1 — depth on what exists**
PWA install and offline shell · Yoruba, Hausa and Igbo · claims submission · electricity bills (the enum, schema and adapter contract already accommodate it) · referrals · savings goals

**Q2 — breadth**
Second VTU aggregator so failover is real rather than architectural · recurring auto-payments · household sub-accounts · React Native app sharing `@evas/contracts` · richer analytics for users

**Q3+ — new surface area**
Wallet withdrawal *(gated on the CBN position)* · insurance beyond health · employer portal for group plans · financial education content · an open API for partners

---

## What the architecture already anticipates

Several post-MVP items need no structural change, because the groundwork is in the schema and the interfaces:

| Future feature | Already supported by |
|---|---|
| Electricity bills | `ServiceType.ELECTRICITY`, and the adapter contract is service-agnostic |
| A fourth health plan | Plans and benefits are rows; nothing branches on tier |
| A new VTU aggregator | `VtuAdapter` + a `providers` row; zero domain changes |
| A new payment processor | `PaymentAdapter`; Flutterwave already seeded at lower priority |
| Push notifications | `NotificationChannel.PUSH` and the delivery table exist |
| More granular staff roles | Permissions are rows; guards check permissions, not role names |
| Multi-region data residency | Nothing in the codebase assumes a region |
| Pass-through payments if the wallet licence fails | `WalletService` is a single isolated seam |

That last row is the one worth noting. The highest-severity risk in the [PRD](./01-prd.md) has an architectural answer already in place — not because it was predicted precisely, but because the wallet was kept behind one interface instead of spread across the service layer.
