# Information architecture

---

## 1. Sitemap

```
/                                   → redirects to /dashboard or /login
│
├── PUBLIC
│   ├── /login
│   ├── /signup
│   ├── /forgot-password
│   ├── /reset-password?token=
│   ├── /verify-email?token=
│   ├── /verify-phone                    step-up OTP
│   ├── /two-factor                      2FA challenge
│   └── /plans                           health catalogue, indexable
│       └── /plans/[slug]                individual plan
│
├── APP  (authenticated)
│   ├── /dashboard                       ★ landing
│   │
│   ├── /health
│   │   ├── /health                      my cover + catalogue
│   │   ├── /health/[subscriptionId]     manage one plan
│   │   ├── /health/[id]/dependants
│   │   ├── /health/[id]/hospitals       network search
│   │   └── /health/subscribe/[slug]     enrolment flow
│   │
│   ├── /retirement
│   │   ├── /retirement                  savings + pension
│   │   ├── /retirement/open             open savings account
│   │   ├── /retirement/contribute
│   │   ├── /retirement/contributions    full history
│   │   ├── /retirement/settings         risk profile, auto-debit, target
│   │   └── /retirement/pension/link     link an RSA
│   │
│   ├── /services
│   │   ├── /services/airtime            ★
│   │   ├── /services/data               ★
│   │   ├── /services/cable              ★
│   │   ├── /services/recipients         saved beneficiaries
│   │   ├── /services/history
│   │   └── /services/history/[ref]      receipt
│   │
│   ├── /wallet
│   │   ├── /wallet                      balance + statement
│   │   └── /wallet/top-up
│   │
│   ├── /transactions                    unified across all modules
│   ├── /notifications
│   │
│   ├── /settings
│   │   ├── /settings/profile
│   │   ├── /settings/security           password · 2FA · devices
│   │   ├── /settings/identity           BVN/NIN · KYC tier
│   │   ├── /settings/notifications
│   │   └── /settings/privacy            data export · deletion
│   │
│   └── /support
│       ├── /support                     tickets
│       └── /support/[ref]
│
└── ADMIN  (permission-gated)
    ├── /admin                           metrics
    ├── /admin/users  ·  /admin/users/[id]
    ├── /admin/transactions
    ├── /admin/reconciliation            ★ money in limbo
    ├── /admin/health-plans
    ├── /admin/service-products
    ├── /admin/providers                 health + circuit state
    ├── /admin/announcements
    ├── /admin/support
    └── /admin/audit-logs

★ = primary navigation destination
```

## 2. Navigation model

Five primary destinations, on both desktop sidebar and mobile bottom bar:

| | Destination | Why it earns a slot |
|---|---|---|
| 1 | Dashboard | The default landing and the hub |
| 2 | Health | Core value proposition |
| 3 | Retirement | Core value proposition |
| 4 | Services | Highest-frequency use |
| 5 | Settings | Contains security, which must never be buried |

**Wallet is deliberately not in the primary nav.** It is not a destination — it is a balance that appears on the dashboard and a payment step inside other flows. Giving it a tab implies the product is a wallet, which is the positioning we are avoiding.

**Notifications** live in the header bell, not the tab bar. They are an interrupt, not a destination.

### Mobile: bottom tabs, not a hamburger

A hamburger menu adds one tap to *every* navigation. On a product whose primary surface is a phone and whose core loop is "open app → buy airtime → leave", that tax is paid dozens of times a month per user. The bottom bar costs ~56px of vertical space, and that is the cheaper trade.

## 3. Content hierarchy on the dashboard

The dashboard is the most contested screen in the product — every module wants a slot. The ordering is a deliberate hierarchy, not a list of available widgets:

```
1. Greeting + name              identity confirmation, one line
2. Wallet balance               ★ the number people open the app to check
3. Account setup progress       the single next action that unlocks more
4. Five module cards            ★ the actual product
5. Account summaries            retirement balance, health count
6. Recent activity              reassurance
7. Unread notification prompt   only when non-zero
```

Two rules follow from this:

- **Nothing may push the wallet balance below the fold on a 360×640 viewport.** That is the smallest common Android screen in Nigeria.
- **Verification is presented as one next action with a progress ring, not a six-item checklist.** A checklist gets dismissed; a single prompt with visible progress gets completed.

## 4. URL conventions

| Convention | Rule | Rationale |
|---|---|---|
| Resource paths | Plural nouns (`/services`, `/transactions`) | Consistency with the REST API |
| Identifiers in URLs | Human references (`EVS-8F3K2M9Q`), not UUIDs | Users read these aloud to support |
| Filters | Query params (`?status=FAILED`) | Shareable, bookmarkable |
| Flows | Path segments (`/health/subscribe/premium-hmo`) | Back button works correctly |
| Never | Sensitive values in URLs | Query strings land in server logs, browser history and referrer headers |

That last rule is why the enrolment flow uses a plan *slug* rather than any user identifier, and why statements download through a POST-authenticated endpoint rather than a signed GET in the address bar.

## 5. Entity relationships as the user experiences them

```
                        ┌──────────┐
                        │   You    │
                        └────┬─────┘
                             │
      ┌──────────┬───────────┼───────────┬────────────┐
      │          │           │           │            │
 ┌────▼───┐ ┌────▼────┐ ┌────▼────┐ ┌────▼─────┐ ┌────▼─────┐
 │ Wallet │ │  Health │ │Retirement│ │ Services │ │ Profile  │
 └────┬───┘ └────┬────┘ └────┬────┘ └────┬─────┘ └──────────┘
      │          │           │           │
      │     ┌────▼─────┐ ┌───▼────┐ ┌────▼──────┐
      │     │Dependants│ │Pension │ │ Recipients│
      │     │Hospitals │ │(PFA)   │ │ History   │
      │     └──────────┘ └────────┘ └───────────┘
      │
      └──────────── pays for everything above ────────────▶
```

The wallet is drawn as a sibling rather than a parent because that is how it should feel: a payment method, not the centre of the product.

## 6. Search and filtering

| Surface | Mechanism | Notes |
|---|---|---|
| Hospital network | State → city, then text | Two-step because Nigeria has 774 LGAs; a flat search is unusable |
| Transaction history | Filter by type, status, date range | Cursor pagination |
| Saved recipients | Client-side filter | Small enough set (max 50) |
| Admin users | Server search across email, phone, name | Indexed, case-insensitive |
| Admin audit log | Filter by actor, resource, action prefix | Action prefix matching (`admin.user.*`) |

No global search in the MVP. A global search bar on a product with six modules and no content corpus is decoration.

## 7. Empty, loading and error states

Every list surface defines all four states. This is enforced by the component inventory rather than left to each screen:

| State | Treatment |
|---|---|
| **Loading** | Skeleton matching final layout — never a spinner. A spinner discards known layout information and causes a jump when content arrives. |
| **Empty** | Icon + one-line explanation + the action that fills it. Never just "No data". |
| **Error** | What failed, in plain language + a retry + the request id for support. |
| **Partial** | Loaded sections render; failed sections show inline errors. A failed recipients lookup must not block the airtime form. |

That last row is a real behaviour, not a principle: `/services/airtime` catches a recipients failure and renders with an empty list, because saved numbers are a convenience and the purchase is the point.

---

**Next:** [Personas and journeys](./03-personas-and-journeys.md) · [Wireframes](./04-wireframes.md)
