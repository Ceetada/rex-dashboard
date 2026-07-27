# Personas and user journeys

Three primary personas and one staff persona. Each is drawn from the MVP target in the [PRD](./01-prd.md) §3, and each exists to settle specific design arguments — the "what this persona settles" line is the reason the persona is in this document at all.

---

## Persona 1 — Chidinma, 31, Lagos

**Marketing manager at a mid-sized fintech. Lagos Mainland → Victoria Island commute.**

- Android (Samsung A-series), 6GB monthly data plan she watches carefully
- Salary ₦850k/month, paid on the 25th
- Company HMO through her employer; has never read the plan document
- RSA with a large PFA; last checked the balance "maybe two years ago"
- Buys airtime 3–4× a month and a 10GB bundle monthly, through her bank app
- Also tops up her mother's line in Enugu, roughly monthly

**What she actually wants:** to stop thinking about small admin. She is not looking for a financial planning tool.

**What frustrates her:** her bank app takes six taps to buy airtime and logs her out constantly. She once paid for data that never arrived and spent 40 minutes on a support line.

**What this persona settles:**
- Repeat purchase must be ≤10s and ≤3 taps → saved recipients are a MUST, not a nice-to-have
- "Remember me" with a 30-day session → she should not re-authenticate weekly
- The failed-purchase experience must be automatic and visible → she should never have to call anyone
- No auto-refetch on focus → her data allowance is finite and she notices

---

## Persona 2 — Emeka, 42, Abuja

**Civil servant, married, three children (14, 11, 6). Owns his home.**

- Android, moderate data literacy, uses WhatsApp heavily
- Statutory RSA plus a small voluntary savings habit
- Pays for a family HMO plan himself; renewal is an annual phone call he dreads
- DStv Compact, renewed monthly, occasionally late
- Cautious with anything financial online; has heard of enough fraud to be wary

**What he actually wants:** confidence that his family is covered and his retirement is on track. He will read the detail.

**What frustrates him:** not knowing whether a hospital near his children's school is in-network without calling the HMO. Not knowing what his pension is worth.

**What this persona settles:**
- Hospital network search by state and city → a MUST, and the second-most-used health feature
- Plan pages must show exclusions → he will read them, and discovering one at a counter would end his trust permanently
- Pension figures must be labelled as PFA-sourced and timestamped → he will notice if a number is stale and assume we are hiding something
- Auto-renew with clear renewal dates → the annual dread is the problem to remove
- Every security notification matters → he wants to know when anything touches his account

---

## Persona 3 — Tolu, 27, Port Harcourt

**Freelance designer. Irregular income. No employer, therefore no employer HMO and no employer pension contributions.**

- iPhone (older model), reasonable data plan
- No health cover at all — has been meaning to sort it for two years
- No RSA. Nobody has ever set one up for him
- Buys airtime and data constantly, across two lines
- Income arrives in lumps; saves when a project pays

**What he actually wants:** health cover he can afford, and some structure for retirement that does not require an employer.

**What frustrates him:** every HMO he has looked at assumes a corporate buyer. Pension products assume a salary.

**What this persona settles:**
- Individual plans must be purchasable without an employer → the Basic plan exists for him
- Voluntary retirement savings must work standalone, with no RSA linked → this is why savings and pension are separate modules rather than one
- Manual contribution must be as easy as auto-debit → his income is lumpy, so a fixed monthly debit does not fit
- Wallet top-up must accept bank transfer → he does not always want to use a card

---

## Persona 4 — Ngozi, staff

**Support agent, 26. Handles ~60 tickets a day from a shared office.**

- Desktop, Chrome, dual monitors
- Needs context fast; users describe problems vaguely ("my money didn't enter")
- Has no business seeing anyone's BVN

**What this persona settles:**
- Permissions must be granular → she needs `user:read` and `support:respond`, not `user:suspend`
- Transactions must carry a human reference users can read aloud → `EVS-8F3K2M9Q`, no ambiguous characters
- Support must see whether a BVN is on file, never its value → `hasBvn: boolean` in the admin API
- Her reads are audit-logged → this protects users, and protects her when she is accused of something she did not do
- The reconciliation queue must sort by age → the oldest stuck money is the angriest customer

---

## Journey 1 — Chidinma buys airtime for her mother

**Trigger:** WhatsApp message from her mother, "my line has finished".
**Success:** airtime delivered, ≤10 seconds, ≤3 taps.

```
Open app (already signed in — 30-day session)
   │
   ▼
Dashboard. Balance visible. "Buy airtime" card.        ── tap 1
   │
   ▼
Airtime screen
   · saved recipients row: [Mum · 0803•••4567]         ── tap 2
   · number fills; network auto-detects MTN
   · quick amounts: ₦500 pre-selected from last time
   │
   ▼
"Buy ₦500 airtime"                                     ── tap 3
   │
   ├─ idempotency key generated at mount, reused on retry
   │
   ▼
Receipt: "Airtime delivered" + reference
   │
   ▼
Push + in-app notification
```

**Where this journey can go wrong, and what happens:**

| Failure | Behaviour |
|---|---|
| Insufficient balance | Error names the shortfall and offers "Top up your wallet" inline |
| She taps Buy twice | Same idempotency key → server replays the original result. One charge. |
| Aggregator times out | Receipt reads "Confirming your purchase" with the automatic-refund promise. Not a green tick. |
| Aggregator rejects | Immediate refund + notification, before she has left the screen |
| All aggregators down | 503 with "temporarily unavailable, try again shortly" — never a generic 500 |
| Her connection drops mid-request | She retries; idempotency key makes it safe |

---

## Journey 2 — Emeka enrols his family in health cover

**Trigger:** annual renewal approaching; he wants to compare rather than auto-renew.
**Success:** family of five covered, and he understands what is excluded.

```
Dashboard → "Health plans"
   │
   ▼
Catalogue: Basic / Family / Premium side by side
   · premium, dependant allowance, hospital count
   · ✓ inclusions AND − exclusions, both listed
   · "Most popular" on Family — the mid tier, not the dearest
   │
   ▼
He opens Family HMO
   · full benefit list with limits ("₦450,000 per delivery")
   · 30-day waiting period stated before he commits
   · hospital network → filters to Abuja → sees three near the school
   │
   ▼
"Choose Family HMO"
   │
   ▼
Enrolment
   · principal details prefilled from profile
   · add dependants (max 5 enforced by the plan, not hard-coded)
   · choose primary hospital
   · billing cycle: monthly / quarterly / annual
   · pay from wallet, or card
   │
   ▼
Confirmation: renewal date, masked member number
   │
   ▼
Health module now shows active cover + dependants
```

**Design decisions this journey forced:**

- Exclusions on the card, not behind a link. Emeka's trust is the product.
- Waiting period stated at the point of choosing, not in a post-purchase email.
- Hospital search *before* purchase — the network is the deciding factor for him, and asking him to buy first is backwards.
- Max dependants read from the plan row, so a future plan allowing 8 needs no code change.

---

## Journey 3 — Tolu starts saving for retirement

**Trigger:** a project pays ₦400k; he wants to put some away.
**Success:** money saved, and he can see it grow.

```
Dashboard → "Retirement"
   │
   ▼
No account yet → empty state
   "Start saving for retirement. You choose how it is invested,
    and you can see exactly how it grows."
   │
   ▼
Open an account
   · risk profile: Conservative / Balanced / Aggressive
     each with a plain-language explanation, not just a name
   · optional target amount and date
   │
   ▼
Contribute ₦100,000 from wallet
   │
   ▼
Retirement screen
   · Balance / Contributed / Growth as three separate figures
   · chart appears from the first contribution
   · allocation breakdown by instrument
   │
   ▼
Later: sets a ₦50,000 monthly auto-debit (day 28 max, so
       February never silently skips)
```

**Why balance, contributed and growth are three separate numbers:** a single "balance" hides whether the money grew or he simply put more in. For someone building a savings habit, that distinction is the entire feedback loop.

---

## Journey 4 — Ngozi resolves "my money didn't enter"

**Trigger:** ticket, vague description, angry customer.

```
Ticket arrives with a linked transaction reference
   │
   ▼
/admin/users/[id]  ── her read is audit-logged
   · sees wallet balance, recent transactions, health cover, devices
   · sees hasBvn: true — never the BVN itself
   │
   ▼
Transaction EVS-8F3K2M9Q shows REQUIRES_RECONCILIATION
   │
   ▼
/admin/reconciliation
   · order listed, sorted by age (94 minutes)
   · attempt count 4 of 8, provider vtpass
   │
   ▼
She replies with the truth:
   "We're confirming this with MTN. If it didn't go through,
    your wallet is refunded automatically — you don't need to do anything."
   │
   ▼
Job resolves it at attempt 5. User notified automatically. Ticket closes.
```

**What made this resolvable:** the reconciliation queue exists as a first-class admin surface, the status is honest rather than a binary success/fail, and Ngozi could answer without escalating to an engineer. A system that models only success and failure would have shown "failed" here and she would have refunded a delivered top-up.

---

## Accessibility considerations drawn from these personas

| Consideration | Who it serves | What it produces |
|---|---|---|
| ≥44px touch targets | Everyone on a phone; Emeka's presbyopia | Default button height 44px |
| Never disable zoom | Emeka, and anyone over 40 | `maximumScale: 5` |
| Status words, not just colour | ~8% of Nigerian men have some colour vision deficiency | `statusTone()` always returns a label |
| Plain language | Everyone, especially under stress | "Confirming your purchase", never "REQUIRES_RECONCILIATION" |
| Works at 200% zoom | Low vision | Fluid display type, relative units throughout |
| Dark theme that survives sunlight | Everyone outdoors in Lagos | Stepped surfaces, not an inversion |
| Low data mode | Chidinma's 6GB | No focus refetch, aggressive image optimisation |

---

**Next:** [Wireframes](./04-wireframes.md) · [Component inventory](./05-component-inventory.md)
