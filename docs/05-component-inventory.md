# UI component inventory

Components are grouped by whether they are generic (could ship in any product), domain-aware (encode Evas business rules), or compositional (page-level shells). The distinction matters: **generic components must never import from `@evas/contracts`**, and domain components are where product rules are allowed to live.

Status: `✅ built` · `◻ specified`

---

## 1. Primitives

| Component | Status | Variants / props | Notes on the decisions inside |
|---|---|---|---|
| `Button` | ✅ | `primary · secondary · ghost · accent · danger · link`; `sm · md · lg · icon`; `loading`, `fullWidth`, `asChild` | 44px default height. `loading` also sets `disabled` and `aria-busy` — a loading button that stays clickable turns one purchase into three on a slow connection. `accent` (gold) is rationed to one per screen. |
| `Input` | ✅ | `label` **required**, `hint`, `error`, `leading`, `trailing`, `hideLabel` | `label` is a required prop, not optional. A placeholder is not a label, and requiring the prop is the only reliable way to stop unlabelled fields shipping. Errors wire through `aria-describedby` + `role="alert"`. |
| `AmountInput` | ✅ | extends `Input` | `inputMode="decimal"` for the Android numeric keypad; ₦ is a static adornment, never part of the value, so users never delete a currency symbol. |
| `Card` + `CardHeader/Title/Description/Content/Footer` | ✅ | `interactive` | Elevation from border + surface step; shadow is an accent. `interactive` adds a 2px lift on hover. |
| `Badge` | ✅ | `neutral · brand · success · warning · danger · info · accent` | Paired with `statusTone()` — the single mapping from domain status → tone **and word**. Status is never colour alone. |
| `ThemeToggle` | ✅ | light / dark / **system** | Three options. A two-way toggle strands anyone who taps once and then wants their OS preference back. |
| `Select` | ◻ | Radix Select | Native `<select>` on mobile; Radix on desktop. Native pickers are better on Android than any custom listbox. |
| `Checkbox` / `Switch` | ◻ | Radix | Switch for instant-effect settings; Checkbox for form fields committed on submit. |
| `Dialog` / `Sheet` | ◻ | Radix Dialog | Sheet (bottom) on mobile, centred Dialog on desktop. Focus trap and restore come from Radix. |
| `Tooltip` | ◻ | Radix | Never the only carrier of information — touch devices have no hover. |
| `Tabs` | ◻ | Radix | Arrow-key navigation required. |
| `Progress` | ◻ | linear | Ring variant is `VerificationRing`. |
| `Skeleton` | ✅ | CSS class | Shimmer is deliberately slow and low-contrast; an aggressive one competes with real content. |
| `Toast` | ◻ | `success · error · info` | `aria-live="polite"`; errors `assertive`. Auto-dismiss never applies to errors. |
| `Avatar` | ◻ | with initials fallback | Initials derived from profile name. |
| `EmptyState` | ◻ | icon + title + body + action | Never renders "No data" alone. |
| `ErrorState` | ◻ | + `requestId` | Always surfaces the request id so users can quote it to support. |

## 2. Domain components

These encode business rules and may import `@evas/contracts`.

| Component | Status | Where the rule lives |
|---|---|---|
| `BalanceCard` | ✅ | Hide-balance preference persists to localStorage. The value is **masked in the DOM**, not blurred — a CSS blur still exposes the number to anything that reads text. Pending amount renders only when non-zero. |
| `StatTile` | ✅ | Optional trend arrow; tabular figures mandatory. |
| `VerificationRing` | ✅ | SVG with real `role="progressbar"` and ARIA values, rather than a conic-gradient wedge that assistive tech cannot read. |
| `FeatureCards` | ✅ | Modules declared as **data**, so a sixth module reflows the grid with no layout change. Single brand tint for all icon tiles — five differently-coloured cards is what makes a dashboard look like a toy. |
| `RecentActivity` | ✅ | Inbound/outbound derived from transaction type. Own empty state. |
| `NetworkPicker` | ✅ | The **only** place third-party brand colour is permitted. `role="radiogroup"` with arrow-key support; selection shown by checkmark + ring, never by colour alone. |
| `ContributionChart` | ✅ | Two series only — the gap between balance and contributions *is* the growth, so a third line restates the same information. Compact axis, exact tooltip. Colours from CSS variables so it re-themes. |
| `PlanCard` | ✅ | Renders **exclusions as well as inclusions**. `maxDependants` read from the plan row, never hard-coded, so a future plan needs no code change. Mid tier is highlighted, not the dearest. |
| `ActiveSubscriptionCard` | ✅ | Renewal ≤30 days escalates to warning tone. Member number always masked. |
| `AirtimeForm` | ✅ | Idempotency key generated **once at mount** and reused across retries. Network auto-detected but always overridable — ported numbers exist. Validated with the exact server schema. |
| `PurchaseReceipt` | ✅ | **Three states**, not two. Unknown outcomes read "Confirming your purchase" with the automatic-refund promise. |
| `DataPlanList` | ◻ | Fetched per network; favourites float to the top. |
| `SmartcardValidator` | ◻ | Two-step by design; customer name confirmed before payment. |
| `DependantForm` | ◻ | Count enforced against the plan's allowance. |
| `HospitalSearch` | ◻ | State → city, then text. A flat search across 774 LGAs is unusable. |
| `RecipientChips` | ◻ | Favourites first, then most recently used. |
| `TransactionRow` | ◻ | Shared by history, statement and admin. |
| `OtpInput` | ◻ | Six boxes, one logical input, `autocomplete="one-time-code"` so Android autofills from SMS. Paste of a full code distributes across boxes. |
| `KycTierBadge` | ◻ | Shows the tier and what it unlocks, not just a label. |

## 3. Layout

| Component | Status | Notes |
|---|---|---|
| `AppShell` | ✅ | Sidebar ≥`lg`, bottom tab bar below. Two distinct patterns rather than one responsive compromise — a hamburger adds a tap to every navigation on the surface this product is actually used from. Safe-area padding for the iPhone home indicator. |
| `Wordmark` | ✅ | Set in **type**, not an image: crisp at any size, recolours in dark mode, zero network requests. The gold diamond is a rotated square over the `a`, matching the logo's construction. |
| `Providers` | ✅ | React Query configured for Nigerian conditions — no refetch on focus (metered data), no 4xx retries, **no automatic mutation retries**. |
| `AuthLayout` | ◻ | Centred card, wordmark, no navigation. |
| `AdminShell` | ◻ | Denser: 12px base, table-first. |
| `PageHeader` | ◻ | Title + description + actions. |

## 4. Composition rules

**Dependency direction.**
```
Primitives  ←  Domain components  ←  Pages
    │                  │
    └── no domain imports
                       └── may import @evas/contracts
```
A primitive that imports `@evas/contracts` has stopped being a primitive.

**Server vs client.** Default to server components. `'use client'` only for interaction state, browser APIs or animation. `BalanceCard` is a client component solely because of the hide toggle; `FeatureCards` and `RecentActivity` are server components with zero JavaScript shipped.

**Styling.** Semantic tokens only (`bg-surface`, `text-muted`). Arbitrary values are permitted only for CSS variables that Tailwind cannot express as a utility (`ring-[var(--color-ring-focus)]`). **`dark:` should not appear** — if it does, a semantic token is missing.

**Every list component owns four states:** loading (skeleton), empty, error (with request id), and loaded. This is enforced by review, and by the e2e suite exercising the empty path.

## 5. Accessibility checklist per component

Applied to every entry above:

- Interactive elements are real `<button>`/`<a>`, never a `<div>` with a click handler
- Visible `focus-visible` ring, ≥3:1, never removed
- Touch targets ≥44×44px
- Icon-only controls carry `aria-label` **that changes with state** (`"Show wallet balance"` ↔ `"Hide wallet balance"`)
- Decorative graphics are `aria-hidden`
- Form errors: `aria-invalid` + `aria-describedby` + `role="alert"`
- Custom controls carry correct roles (`radiogroup`, `progressbar`) with full keyboard support
- Colour is never the sole carrier of meaning
- Animation respects `prefers-reduced-motion`

---

**Next:** [Design system](./06-design-system.md) · [Frontend structure](./11-frontend-structure.md)
