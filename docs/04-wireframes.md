# Wireframes

Text wireframes for every major screen. Mobile (360px) is drawn first because it is the primary surface; desktop notes follow where the layout differs meaningfully.

Legend: `[ ]` control · `( )` toggle/radio · `▓` filled/primary · `░` skeleton · `★` primary action

---

## 1. Dashboard — mobile 360×640

```
┌────────────────────────────────────┐
│ evas◆                    🔔•  ☰    │  sticky header, blur
├────────────────────────────────────┤
│                                    │
│  Good morning,                     │  body-sm, muted
│  Chidinma                          │  display-sm
│                                    │
│ ┌────────────────────────────────┐ │
│ │▓▓▓▓ green-600, gold diamond ▓▓▓│ │
│ │ WALLET BALANCE       👁         │ │  overline + hide toggle
│ │ ₦124,500.00                    │ │  clamp(1.75→2.5rem), tabular
│ │ ₦2,000 pending                 │ │  only when non-zero
│ │                    [ + Top up ]│ │  gold accent button
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │  ◜75%◝  Account setup          │ │  SVG progressbar, real ARIA
│ │  ◟   ◞  Finish setting up to   │ │
│ │         raise your limits.     │ │
│ │  [ Turn on 2FA            → ]  │ │  ONE next action, not a list
│ └────────────────────────────────┘ │
│                                    │
│  What would you like to do?        │  heading-md
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ♥  Health plans                │ │  icon tile: primary-subtle
│ │    Manage your HMO cover…      │ │
│ │    Family HMO · renews in 24d  │ │  contextual, brand colour
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ 🐖 Retirement                  │ │
│ │    Track your savings…         │ │
│ │    ₦1,240,000 saved            │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ 📱 Buy airtime                 │ │
│ ├────────────────────────────────┤ │
│ │ 📶 Buy data                    │ │
│ ├────────────────────────────────┤ │
│ │ 📺 Cable TV                    │ │
│ └────────────────────────────────┘ │
│                                    │
│  Your accounts                     │
│ ┌──────────────┐┌────────────────┐ │
│ │ RETIREMENT   ││ HEALTH PLANS   │ │
│ │ ₦1,240,000   ││ 1              │ │  numeric token, tabular
│ │ ↗ +8.4%      ││                │ │
│ └──────────────┘└────────────────┘ │
│                                    │
│  Recent activity        [View all] │
│ ┌────────────────────────────────┐ │
│ │ ↗ MTN airtime      −₦500.00    │ │
│ │   2h ago · EVS-8F3K   [Success]│ │  badge: tint + WORD
│ ├────────────────────────────────┤ │
│ │ ↙ Wallet funding  +₦50,000.00  │ │
│ │   yesterday · EVS-2M9Q [Success]│ │
│ ├────────────────────────────────┤ │
│ │ ↗ DStv Compact  −₦19,000.00    │ │
│ │   3d ago · EVS-K4LP [Confirming]│ │  info tone, honest word
│ └────────────────────────────────┘ │
│                                    │
├────────────────────────────────────┤
│  ⬛      ♥      🐖     📱     ⚙    │  bottom tabs, safe-area pad
│ Dash  Health  Retire  Serv  Settings│
└────────────────────────────────────┘
```

**Desktop (≥1024px):** 240px sidebar replaces bottom tabs. Balance card and setup card sit side by side at `1.4fr 1fr`. Feature cards go to a 3-column grid. Summaries and activity share a `1fr 1.2fr` row.

**Constraint:** nothing may push the balance below the fold at 360×640. This is the smallest common Android viewport in Nigeria and it is checked in the e2e suite.

---

## 2. Buy airtime — mobile

```
┌────────────────────────────────────┐
│ ←  Buy airtime                     │
├────────────────────────────────────┤
│  Buy airtime                       │  display-sm
│  Top up any Nigerian number.       │
│                                    │
│  Recent numbers                    │
│  (Mum 0803•••4567)(Me 0806•••1122) │  chips, tap to fill
│                                    │
│  Phone number                      │
│ ┌────────────────────────────────┐ │
│ │ ☎  0803 123 4567               │ │  inputMode=numeric
│ └────────────────────────────────┘ │
│  We accept 0803…, +234803… or 803… │  hint
│                                    │
│  Network — detected from the number│  legend states detection
│ ┌─────┐┌─────┐┌─────┐┌─────┐       │
│ │(MTN)││Airtl││ Glo ││9mob │       │  radiogroup, arrow keys
│ │  ✓  ││     ││     ││     │       │  ✓ + ring, not colour alone
│ └─────┘└─────┘└─────┘└─────┘       │  network brand colours here
│                                    │
│ ┌──────┐┌──────┐┌──────┐           │
│ │ ₦100 ││ ₦200 ││ ₦500 │           │  quick amounts
│ ├──────┤├──────┤├──────┤           │  aria-pressed
│ │₦1,000││₦2,000││₦5,000│           │
│ └──────┘└──────┘└──────┘           │
│                                    │
│  Or enter an amount                │
│ ┌────────────────────────────────┐ │
│ │ ₦  0                           │ │  static ₦ adornment
│ └────────────────────────────────┘ │
│  Between ₦50 and ₦50,000           │
│                                    │
│  ☐ Save this number for next time  │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ★  Buy ₦500 airtime            │ │  label states the amount
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

**Error state (insufficient funds):**

```
│ ┌────────────────────────────────┐ │
│ │ ⚠ Your wallet balance is too   │ │  role="alert"
│ │   low for this transaction     │ │
│ │   [Top up your wallet]         │ │  inline recovery
│ │   Reference: 8f3c-91ab         │ │  request id for support
│ └────────────────────────────────┘ │
```

**Receipt — three states, not two:**

```
   DELIVERED              CONFIRMING (unknown)
┌──────────────┐       ┌──────────────────────┐
│      ✓       │       │         ✓            │  info tone, not success
│  green tint  │       │      info tint       │
│              │       │                      │
│   Airtime    │       │ Confirming your      │
│  delivered   │       │ purchase             │
│              │       │                      │
│ The airtime  │       │ We are confirming    │
│ has been     │       │ this with the        │
│ credited.    │       │ network. If it did   │
│              │       │ not go through, we   │
│ EVS-8F3K2M9Q │       │ will refund your     │
│              │       │ wallet automatically │
│ [History][OK]│       │ — you do not need to │
└──────────────┘       │ do anything.         │
                       │                      │
                       │ EVS-8F3K2M9Q         │
                       │ [History]   [Done]   │
                       └──────────────────────┘
```

The right-hand state is the one most products get wrong. It is neither a success tick nor a failure — because we genuinely do not yet know.

---

## 3. Buy data

```
┌────────────────────────────────────┐
│  Buy data                          │
│                                    │
│  (Mum)(Me)(Sister)                 │  saved recipients
│  [ ☎ 0803 123 4567             ]   │
│                                    │
│  ┌───┐┌───┐┌───┐┌───┐              │  network first — plans
│  │MTN││Air││Glo││9mo│              │  depend on it
│  └───┘└───┘└───┘└───┘              │
│                                    │
│  Choose a plan            ★Favourites│
│ ┌────────────────────────────────┐ │
│ │ 1GB Weekly              ₦500   │ │  radio list
│ │ 7 days                    ( )  │ │
│ ├────────────────────────────────┤ │
│ │ 2GB Monthly           ₦1,000   │ │
│ │ 30 days                   (•)  │ │
│ ├────────────────────────────────┤ │
│ │ 10GB Monthly          ₦3,500 ★ │ │  ★ = user favourite
│ │ 30 days                   ( )  │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ★ Buy 2GB Monthly · ₦1,000     │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

Plans are fetched per network, so the network selector precedes the plan list rather than sitting beside it. Price comes from the product id server-side — the client never sends an amount.

---

## 4. Cable TV — two-step by necessity

```
STEP 1 — validate                STEP 2 — confirm & pay
┌──────────────────────────┐   ┌──────────────────────────┐
│  Cable TV                │   │  Confirm                 │
│                          │   │                          │
│  Provider                │   │ ┌──────────────────────┐ │
│ ┌─────┐┌─────┐┌────────┐ │   │ │ ✓ EMEKA OKAFOR       │ │
│ │DStv ││GOtv ││Startim │ │   │ │ 1234•••789           │ │
│ │ (•) ││ ( ) ││  ( )   │ │   │ │ Current: Compact     │ │
│ └─────┘└─────┘└────────┘ │   │ │ Due: 12 Aug 2026     │ │
│                          │   │ └──────────────────────┘ │
│  Smartcard / IUC number  │   │                          │
│ ┌──────────────────────┐ │   │  Package                 │
│ │ 1234567890           │ │   │ ┌──────────────────────┐ │
│ └──────────────────────┘ │   │ │ Padi        ₦4,400 ()│ │
│  10–11 digits            │   │ │ Yanga       ₦6,000 ()│ │
│                          │   │ │ Confam     ₦11,000 ()│ │
│ ┌──────────────────────┐ │   │ │ Compact    ₦19,000(•)│ │
│ │  Check smartcard     │ │   │ │ Premium    ₦44,000 ()│ │
│ └──────────────────────┘ │   │ └──────────────────────┘ │
└──────────────────────────┘   │                          │
                               │ ☐ Save this decoder      │
                               │                          │
                               │ ┌──────────────────────┐ │
                               │ │ ★ Pay ₦19,000        │ │
                               │ └──────────────────────┘ │
                               └──────────────────────────┘
```

**Why two steps are non-negotiable:** money sent to a stranger's decoder cannot be recovered, and mistyping one digit of an 11-digit number is common. Showing the customer name before payment is the only defence. The server re-validates at purchase rather than trusting the name echoed back.

---

## 5. Health plans — catalogue

```
┌────────────────────────────────────┐
│  Health plans                      │
│  Cover for you and the people who  │
│  depend on you.                    │
│                                    │
│  Your cover                        │  only if subscribed
│ ┌────────────────────────────────┐ │
│ │ Family HMO Plan       [Active] │ │
│ │ Member •••••4821               │ │  masked, always
│ │                                │ │
│ │ PREMIUM        RENEWS          │ │
│ │ ₦12,000/month  12 Aug 2026     │ │
│ │                in 24 days      │ │  warning tone ≤30d
│ │                                │ │
│ │ 👥 3 dependants covered        │ │
│ │    — Ada, Chidi, Ngozi         │ │
│ │                                │ │
│ │ [Manage] [Find a hospital]     │ │
│ └────────────────────────────────┘ │
│                                    │
│  Other plans                       │
│ ┌────────────────────────────────┐ │
│ │ Basic HMO Plan                 │ │
│ │ Essential cover for everyday   │ │
│ │ care                           │ │
│ │ ₦3,500/month                   │ │  numeric token
│ │ 340+ hospitals · ₦500,000 cap  │ │
│ │                                │ │
│ │ ✓ Outpatient — Unlimited       │ │
│ │ ✓ Medication — ₦50,000/yr      │ │
│ │ ✓ Diagnostics — ₦40,000/yr     │ │
│ │ ✓ Admission — ₦150,000/yr      │ │
│ │ ✓ Emergency — ₦100,000/yr      │ │
│ │ − Specialist consultations     │ │  ← EXCLUSIONS SHOWN
│ │ − Dental care                  │ │
│ │ − Optical care                 │ │
│ │                                │ │
│ │ [ Choose Basic HMO Plan ]      │ │
│ │ 30-day waiting period applies  │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ [Most popular]        ← ring   │ │  mid tier, not dearest
│ │ Family HMO Plan                │ │
│ │ …                              │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

**Desktop:** 2-up at `md`, 3-up at `xl`. The card is a flex column with the CTA pinned to the bottom, so cards with different benefit counts still align their buttons.

**Exclusions are on the card, not behind a link.** Discovering an exclusion at a hospital counter is the worst failure this product could produce.

---

## 6. Retirement

```
┌────────────────────────────────────┐
│  Retirement                        │
│  Your savings with Evas, and your  │
│  statutory pension.                │
│                                    │
│  Retirement savings   [ Add money ]│
│ ┌──────────┐┌──────────┐┌────────┐ │
│ │ BALANCE  ││CONTRIBUTED││ GROWTH │ │
│ │₦1,240,000││₦1,100,000 ││₦140,000│ │  three separate figures
│ │          ││           ││+12.7%  │ │
│ └──────────┘└──────────┘└────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ Target: ₦10,000,000 by 2041    │ │
│ │                          12%   │ │
│ │ ▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░  │ │  role=progressbar
│ └────────────────────────────────┘ │
│                                    │
│  Balance over time                 │
│ ┌────────────────────────────────┐ │
│ │ ₦1.5M ┤              ╱─────    │ │  solid: balance
│ │ ₦1.0M ┤        ╱────╱          │ │  dashed gold: contributed
│ │ ₦500k ┤   ╱───╱ ─ ─ ─ ─ ─      │ │  the GAP is the growth
│ │     0 ┼───┬───┬───┬───┬───┬─   │ │
│ │      Jan Mar May Jul Sep Nov   │ │  compact axis, exact tooltip
│ └────────────────────────────────┘ │
│                                    │
│  How your money is invested        │
│ ┌────────────────────────────────┐ │
│ │ FGN Bond 2031      ₦620,000    │ │
│ │ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░    50%    │ │
│ │ Money Market Fund  ₦372,000    │ │
│ │ ▓▓▓▓▓▓░░░░░░░░░░░░░░    30%    │ │
│ │ Equity Fund        ₦248,000    │ │
│ │ ▓▓▓▓░░░░░░░░░░░░░░░░    20%    │ │
│ └────────────────────────────────┘ │
│                                    │
│ ═══════════════════════════════════│
│  Pension benefits    [Stanbic IBTC]│
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ℹ These figures come from      │ │  ← ALWAYS PRESENT
│ │   Stanbic IBTC, who administer │ │
│ │   your RSA. Last updated       │ │
│ │   3 days ago.                  │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────┐┌────────┐┌────────┐┌───┐│
│ │RSA BAL ││ YOURS  ││EMPLOYER││RET││
│ │₦8.4M   ││₦3.2M   ││₦4.1M   ││₦1M││
│ │PEN••4821│         ││ MoFA   ││   ││
│ └────────┘└────────┘└────────┘└───┘│
│                                    │
│ ┌────────────────────────────────┐ │
│ │ Estimated benefit at 60        │ │
│ │ ₦42,800,000                    │ │
│ │ A projection based on your     │ │  ← assumptions stated
│ │ current contribution rate and  │ │
│ │ an assumed return. It is not   │ │
│ │ a guarantee.                   │ │
│ └────────────────────────────────┘ │
│                                    │
│  Statements                        │
│ ┌────────────────────────────────┐ │
│ │ 1 Apr – 30 Jun 2026            │ │
│ │ Closing ₦8,400,000  [Download] │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

**Two sections, visually separated,** because savings and pension are legally distinct. The provenance banner is not boilerplate — a user deciding on retirement needs to know how old the number is.

---

## 7. Sign in

```
┌────────────────────────────────────┐
│                                    │
│           evas◆                    │  wordmark, set in type
│                                    │
│      Welcome back                  │  display-sm
│      Sign in to your account       │
│                                    │
│  Email                             │
│ ┌────────────────────────────────┐ │
│ │ ✉  you@example.com             │ │  autocomplete=username
│ └────────────────────────────────┘ │
│                                    │
│  Password                          │
│ ┌────────────────────────────────┐ │
│ │ 🔒 ••••••••••            👁    │ │  autocomplete=current-password
│ └────────────────────────────────┘ │
│                                    │
│  ☐ Keep me signed in    Forgot?    │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ★  Sign in                     │ │
│ └────────────────────────────────┘ │
│                                    │
│  New to Evas?  Create an account   │
│                                    │
└────────────────────────────────────┘
```

**Error copy is identical for wrong email and wrong password** — "Email or password is incorrect" — and the server does equal work in both cases. A form that says "no account with that email" is a free customer list.

**2FA / step-up:**

```
┌────────────────────────────────────┐
│  Verify it's you                   │
│                                    │
│  We sent a code to 0803•••67       │  masked destination
│                                    │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐          │
│  │ 3││ 9││ 1││  ││  ││  │          │  6 boxes, one input,
│  └──┘└──┘└──┘└──┘└──┘└──┘          │  autocomplete=one-time-code
│                                    │
│  Resend in 0:42                    │  cooldown visible
│                                    │
│  [ Verify ]                        │
│                                    │
│  Use a recovery code instead       │
└────────────────────────────────────┘
```

---

## 8. Admin — reconciliation queue

```
┌──────────────────────────────────────────────────────────────────┐
│ Reconciliation                              12 orders in limbo   │
├──────────────────────────────────────────────────────────────────┤
│ AGE ↓  REFERENCE      USER          SERVICE  AMOUNT   TRIES  PROV│
├──────────────────────────────────────────────────────────────────┤
│ 4h12m  EVS-8F3K2M9Q   chi@mail.com  AIRTIME  ₦500     6/8   vtpass│
│        0803•••4567 · Provider is still processing                 │
│                                          [Requery] [Refund now]   │
├──────────────────────────────────────────────────────────────────┤
│ 1h48m  EVS-K4LP7Q2M   eme@mail.com  CABLE    ₦19,000  3/8   vtpass│
│        1234•••789 · Timeout contacting provider                   │
│                                          [Requery] [Refund now]   │
├──────────────────────────────────────────────────────────────────┤
│ 22m    EVS-9M2XK4LP   tol@mail.com  DATA     ₦1,000   1/8   vtpass│
└──────────────────────────────────────────────────────────────────┘
```

**Sorted by age descending** — the oldest stuck money is the angriest customer. Manual refund requires a reason, which is written to the audit log.

---

## 9. Universal states

```
LOADING (skeleton, matching final layout — never a spinner)
┌────────────────────────────────────┐
│ ░░░░░░░░░░░░  ░░░░░░               │
│ ┌────────────────────────────────┐ │
│ │ ░░░░░░░░░░░░░░░░░              │ │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░       │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘

EMPTY (icon + explanation + the action that fills it)
┌────────────────────────────────────┐
│              ┌───┐                 │
│              │ 🧾│                 │
│              └───┘                 │
│         No activity yet            │
│  Your purchases and payments       │
│      will appear here.             │
└────────────────────────────────────┘

ERROR (what failed + retry + reference)
┌────────────────────────────────────┐
│              ┌───┐                 │
│              │ ⚠ │                 │
│              └───┘                 │
│    We could not load this          │
│  Check your connection and try     │
│           again.                   │
│         [ Try again ]              │
│      Reference: 8f3c-91ab          │
└────────────────────────────────────┘
```

Skeletons rather than spinners because a spinner discards layout information we already have, then causes a jump when content arrives.

---

**Next:** [Component inventory](./05-component-inventory.md) · [Design system](./06-design-system.md)
