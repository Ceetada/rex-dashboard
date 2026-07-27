# Product Requirements Document

**Product:** Evas
**Version:** 1.0 · MVP definition
**Status:** Approved for build

---

## 1. The problem

A Nigerian professional managing their own affairs currently holds:

- An HMO plan, administered through a portal they log into once a year, if it exists at all. Renewal is a phone call. Checking whether a hospital is in-network means calling the HMO.
- An RSA with a Pension Fund Administrator, whose balance they see on a quarterly PDF statement or via a portal they have forgotten the password to.
- A bank app for airtime and data, which works but treats these as an afterthought buried three screens deep.
- Nothing that connects any of this.

The result is that people under-engage with the two things that matter most for their long-term security — health cover and retirement — while over-engaging with the trivial one. Airtime gets bought fifteen times a month. A pension balance gets checked twice a year.

**The opportunity is not to build another VTU app.** It is to use the high-frequency utility of airtime and data as the reason someone opens the app weekly, and to put health and retirement in front of them when they do.

That framing drives most of the product decisions in this document.

## 2. What we are building

A single account through which a Nigerian can:

| Capability | Frequency of use | Why it is here |
|---|---|---|
| Buy airtime | Several times a month | The habit-forming hook. Must be faster than the bank app. |
| Buy data | Weekly to monthly | Same. Higher value per transaction. |
| Cable TV subscription | Monthly | Predictable, recurring, high-value. |
| Health plans | Monthly awareness, annual decision | Core value. Where retention is earned. |
| Retirement savings | Monthly contribution | Core value. Where lifetime value is earned. |
| Pension benefits | Quarterly check | Mirrored from the PFA. Trust-building. |
| Wallet | Underpins everything | Removes a card entry from every purchase. |

## 3. Who it is for

Detailed personas are in [03-personas-and-journeys.md](./03-personas-and-journeys.md). In summary, the MVP targets **salaried urban Nigerians aged 26–45**, in Lagos, Abuja and Port Harcourt first, who:

- Are already on a company or personal HMO plan, or are actively considering one.
- Have an RSA through their employer, and could not tell you its balance.
- Buy airtime and data through a bank app today.
- Own an Android phone (roughly 75% of the Nigerian smartphone market) on a metered data plan.

Explicitly **not** the MVP audience: unbanked users, feature-phone users, and users whose primary need is a USSD flow. Those are real and large markets, and serving them well requires a different product, not a responsive breakpoint.

## 4. Goals and non-goals

### Goals

**G1 — Make everyday services genuinely faster than the incumbent.**
Buying airtime for a saved number should take under 10 seconds from app open. If it does not beat the bank app, nothing else in this product gets used.

**G2 — Make health cover legible.**
A user should be able to answer "what am I actually covered for?" and "is this hospital in my network?" without calling anyone.

**G3 — Make retirement visible.**
A user should see their pension balance without hunting for a PFA password, and should be able to add to voluntary savings in three taps.

**G4 — Be trusted with money.**
No double charges. No silent failures. Every naira accounted for. This is a precondition, not a feature — see §7.

### Non-goals for the MVP

- **We are not becoming a bank.** No current account, no card issuing, no lending. The wallet is a stored-value balance for buying things on this platform.
- **We are not building an HMO.** We distribute plans from licensed HMO partners.
- **We are not becoming a PFA.** We mirror RSA data with the user's consent. The PFA remains the system of record.
- **No cryptocurrency, no investment marketplace, no bill-splitting.** These come up in every fintech planning session and every one of them dilutes the proposition.

## 5. Success metrics

The metric that matters is not registrations. It is whether the high-frequency hook actually converts to the high-value products.

| Metric | Target (6 months post-launch) | Why this number |
|---|---|---|
| Weekly active / monthly active | ≥ 40% | Below this, the utility hook is not working and nothing else will follow. |
| Airtime/data purchase success rate | ≥ 98.5% | Aggregator reality makes 100% impossible. Below 98% users lose trust fast. |
| Median time to complete a repeat airtime purchase | ≤ 10s | The direct test of G1. |
| % of MAU with a health plan | ≥ 12% | The conversion that justifies the whole model. |
| % of MAU with linked RSA | ≥ 25% | Cheaper conversion than health; a leading indicator. |
| Unreconciled transactions older than 24h | 0 | Not a target, a hard constraint. See §7. |
| Support tickets per 1,000 transactions | ≤ 3 | Above this, the reconciliation design has failed. |

Deliberately **not** a target: total transaction volume. It is trivially gamed by discounting airtime, and it tells us nothing about whether the product works.

## 6. Functional requirements

Requirements are stated as user-observable behaviour. Implementation lives in [12-api-specification.md](./12-api-specification.md).

### 6.1 Identity and access

| ID | Requirement | Priority |
|---|---|---|
| A1 | A user can register with email, phone and password, and must explicitly consent to terms and privacy policy. | MUST |
| A2 | Email must be confirmed before the account leaves PENDING_VERIFICATION. | MUST |
| A3 | Phone must be verified by OTP before any transaction is permitted. | MUST |
| A4 | A user can enable TOTP-based 2FA and receives 10 single-use recovery codes. | MUST |
| A5 | Sign-in from an unrecognised device triggers a step-up challenge **even when 2FA is off**, and notifies the user. | MUST |
| A6 | "Remember me" extends the session to 30 days; without it, 12 hours. Idle timeout applies regardless. | MUST |
| A7 | A user can see every device with an active session and revoke any of them. | MUST |
| A8 | A password reset ends every existing session. | MUST |
| A9 | The system must not reveal whether an email address is registered. | MUST |

A9 is not paranoia. A login form that returns "no account with that email" is a free list of your customers for anyone who wants one, and in a market with active SIM-swap fraud that list has direct value.

### 6.2 Wallet and payments

| ID | Requirement | Priority |
|---|---|---|
| W1 | A user can fund the wallet by card, bank transfer or USSD via a payment provider. | MUST |
| W2 | Wallet balance is always exact. Every change has a corresponding ledger entry. | MUST |
| W3 | A user can view a complete statement of every credit and debit. | MUST |
| W4 | A failed purchase is refunded to the wallet automatically. | MUST |
| W5 | Wallet balance can be hidden from the screen, and the preference persists. | SHOULD |
| W6 | Withdrawal to a bank account. | WON'T (MVP) |

W6 is deliberately excluded. Allowing money out changes our regulatory position materially — see [17-compliance.md](./17-compliance.md) — and the MVP does not need it.

### 6.3 Digital services

| ID | Requirement | Priority |
|---|---|---|
| S1 | A user can buy airtime on MTN, Airtel, Glo or 9mobile. | MUST |
| S2 | The network is detected from the number, and remains manually overridable. | MUST |
| S3 | A user can buy a data bundle on any of the four networks. | MUST |
| S4 | A user can subscribe to DStv, GOtv or Startimes. | MUST |
| S5 | A smartcard number is validated and the customer name shown **before** payment. | MUST |
| S6 | A user can save recipients with a label and mark favourites. | MUST |
| S7 | Full purchase history, filterable by service. | MUST |
| S8 | A purchase whose outcome is unknown shows as "confirming", not as success or failure. | MUST |
| S9 | Adding a new provider or biller must not require a code change to the domain layer. | MUST |

S5 exists because the failure it prevents is unrecoverable. Money sent to a stranger's decoder cannot be clawed back, and mistyping one digit of an 11-digit number is common.

S8 is the honest-UI requirement corresponding to the reconciliation design in §7.

### 6.4 Health plans

| ID | Requirement | Priority |
|---|---|---|
| H1 | A user can browse all available plans with premium, benefits, exclusions and hospital count. | MUST |
| H2 | Plan pages must show what is **not** covered, not only what is. | MUST |
| H3 | A user can subscribe, adding dependants where the plan allows. | MUST |
| H4 | A user can see their member number (masked), renewal date and covered dependants. | MUST |
| H5 | A user can search the hospital network by state and city. | MUST |
| H6 | A user can turn off auto-renewal; cover continues to the end of the paid period. | MUST |
| H7 | Adding a fourth plan must require no frontend or backend code change. | MUST |
| H8 | Claims submission. | SHOULD (post-MVP) |

H2 is a trust decision. Discovering an exclusion at a hospital counter is the single worst experience an HMO product can produce, and it is entirely avoidable at the point of sale.

H7 is the extensibility requirement stated as an acceptance test rather than an aspiration.

### 6.5 Retirement

| ID | Requirement | Priority |
|---|---|---|
| R1 | A user can open a voluntary retirement savings account and choose a risk profile. | MUST |
| R2 | A user can contribute manually, and can set up a monthly auto-debit. | MUST |
| R3 | Balance, total contributed and growth are shown separately. | MUST |
| R4 | A monthly chart shows balance and contributions over time. | MUST |
| R5 | A user can link their RSA and see balance, contributions split by employee/employer, and returns. | MUST |
| R6 | All PFA-sourced data must be labelled as such and timestamped. | MUST |
| R7 | A user can download pension statements. | MUST |
| R8 | Estimated retirement benefit shown with its assumptions stated. | SHOULD |

R6 is not a disclaimer for its own sake. We mirror PFA data on a sync schedule; a user making a decision on a three-week-old number needs to know that.

R8's requirement to state assumptions follows the same logic: an unqualified projection reads as a promise.

### 6.6 Profile and notifications

| ID | Requirement | Priority |
|---|---|---|
| P1 | A user can maintain name, DOB, gender, address, state, LGA and photo. | MUST |
| P2 | State and LGA are validated against each other. | MUST |
| P3 | A user can change their password and their phone number (phone requires re-verification). | MUST |
| P4 | Notification preferences per channel and per category. | MUST |
| P5 | Security notifications cannot be disabled. | MUST |
| P6 | Quiet hours suppress non-urgent notifications. | SHOULD |
| P7 | A user can export their personal data and request account deletion. | MUST |

P5 is a security requirement disguised as a preferences requirement. "Your password was changed" is precisely the message an attacker wants suppressed.

P7 is an NDPA obligation, not a nice-to-have.

### 6.7 Administration

| ID | Requirement | Priority |
|---|---|---|
| M1 | Staff access is governed by granular permissions, not by an "is admin" flag. | MUST |
| M2 | Every privileged action records actor, target, before/after and a reason. | MUST |
| M3 | Reading a customer's full record is itself audit-logged. | MUST |
| M4 | Suspending an account terminates its sessions immediately. | MUST |
| M5 | A reconciliation queue shows every transaction in limbo, sorted by age. | MUST |
| M6 | Provider health and circuit-breaker state are visible. | MUST |
| M7 | Announcements can be sent to a filtered audience. | MUST |
| M8 | Plans, products and providers are manageable without a deploy. | MUST |

M3 answers "which member of staff looked at my data?", which the NDPA entitles a user to ask.

M4 exists because a status column that does not revoke sessions is a suspension in name only.

## 7. The constraint that shapes the system

**Paying for something and receiving it are two separately-failing events.**

When a user buys ₦500 of airtime:

1. We debit their wallet.
2. We ask an aggregator to credit their line.

Step 2 can succeed, fail, or **not answer**. The third case is common — Nigerian VTU aggregators time out regularly, particularly at month-end — and it is where naive implementations lose money in both directions:

- Treat a timeout as failure → refund a top-up that was actually delivered → give away product.
- Treat a timeout as success → charge for airtime that never arrived → defraud the user.

Neither is acceptable, so the system models three outcomes rather than two. An unknown outcome parks the order, requeries with backoff, and resolves it. Only after repeated failures does it refund — in the user's favour, flagged for a human, so the cost is measured rather than hidden.

Everything else follows from this: the append-only ledger, idempotency keys on every purchase, the separation of `Transaction` from `ServiceOrder`, and the "confirming" state in the UI.

**This is the requirement that most distinguishes a production system from a demo,** and it is why §6.3 S8 is a MUST.

## 8. Constraints

### Technical

- **Mobile-first, and mobile-real.** Android on 3G/4G, mid-range hardware. Round-trip count matters more than payload size, which is why the dashboard is a single aggregate call.
- **Metered data.** No auto-refetch on window focus. No video. Images optimised aggressively.
- **Intermittent connectivity.** Every mutation is idempotent. A dropped connection mid-purchase must be safe to retry.

### Regulatory

Detailed in [17-compliance.md](./17-compliance.md). The load-bearing ones:

- **NDPA 2023** — lawful basis, consent records, data subject rights, breach notification within 72 hours.
- **CBN** — the wallet is stored value. Operating it requires either a licence or a licensed partner. **This is a launch blocker and must be resolved before any real money moves.**
- **NHIA** — health plans may only be distributed for accredited HMOs.
- **PenCom** — we do not administer pension funds; we display them with consent.

### Commercial

- VTU margins are thin (2–4%). Volume matters, and provider cost must be tracked per transaction.
- Health plan distribution is where the margin is. This is why the dashboard puts health in front of users who came for airtime.

## 9. Assumptions and risks

| Assumption | If wrong | Mitigation |
|---|---|---|
| Users will link their RSA | Retirement engagement collapses | Voluntary savings works standalone; pension is additive |
| PFAs will provide API access | R5–R7 become manual upload | Design the adapter to accept statement upload as a fallback |
| An HMO partner will accredit us as a distributor | No health module at launch | Partner conversations must precede build completion |
| One VTU aggregator is enough at launch | Outages become downtime | Registry supports failover from day one; second provider before scale |
| CBN partner licence obtainable | Cannot hold user funds | Wallet abstraction allows a pass-through model with no stored balance |

The last row is the highest-severity risk in this document. The wallet is architecturally isolated behind `WalletService` specifically so a pass-through model can be substituted without touching the service layer.

## 10. Out of scope for MVP

Bank transfers out · card issuing · lending · insurance beyond health · investment marketplace · bill splitting · USSD · a native mobile app (the web app is installable as a PWA) · multi-currency · Yoruba/Hausa/Igbo localisation (planned — see [13-roadmap.md](./13-roadmap.md)).

---

**Next:** [Information architecture](./02-information-architecture.md) · [MVP scope](./18-mvp-scope.md)
