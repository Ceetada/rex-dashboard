# Frontend folder structure

```
apps/web/
├── src/
│   ├── app/                          Next.js 15 App Router
│   │   ├── layout.tsx                theme script (pre-paint), skip link
│   │   ├── globals.css               imports generated theme.css
│   │   ├── page.tsx                  → /dashboard
│   │   │
│   │   ├── (auth)/                   route group — no app chrome
│   │   │   ├── login/ signup/ forgot-password/ reset-password/
│   │   │   ├── verify-email/ verify-phone/ two-factor/
│   │   │
│   │   ├── (app)/                    route group — AppShell
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/
│   │   │   ├── health/               [id]/ · subscribe/[slug]/ · hospitals/
│   │   │   ├── retirement/           contribute/ · pension/link/
│   │   │   ├── services/
│   │   │   │   ├── airtime/          page.tsx (server) + airtime-form.tsx (client)
│   │   │   │   ├── data/ cable/ recipients/ history/
│   │   │   ├── wallet/ transactions/ notifications/ settings/ support/
│   │   │
│   │   └── (admin)/                  route group — AdminShell, denser
│   │       └── admin/                users/ transactions/ reconciliation/ …
│   │
│   ├── components/
│   │   ├── ui/                       primitives — NO domain imports
│   │   │   ├── button.tsx input.tsx card.tsx badge.tsx theme-toggle.tsx
│   │   ├── layout/                   app-shell.tsx (+ Wordmark)
│   │   ├── dashboard/                balance-card · feature-cards ·
│   │   │                             recent-activity · verification-ring
│   │   ├── services/                 network-picker · plan-list · smartcard
│   │   ├── health/  retirement/      domain components
│   │   └── providers.tsx             React Query, tuned for Nigerian networks
│   │
│   ├── lib/
│   │   ├── api.ts                    the ONLY fetch wrapper; shared refresh
│   │   ├── queries.ts                server-side loaders, cookie forwarding
│   │   ├── format.ts                 naira, dates, relative time, greeting
│   │   └── cn.ts
│   │
│   └── hooks/
│
├── e2e/                              Playwright
├── tailwind.config.ts                bound to semantic CSS variables
└── next.config.mjs                   security headers
```

## Rules

**Route groups, not nested layouts by URL.** `(auth)`, `(app)` and `(admin)` give three genuinely different chromes without polluting the URL.

**Server components by default.** `'use client'` only for interaction state, browser APIs or animation. `FeatureCards` and `RecentActivity` ship zero JavaScript; `BalanceCard` is a client component solely because of the hide toggle.

**Page + form split.** `services/airtime/page.tsx` is a server component that loads saved recipients; `airtime-form.tsx` is the client island. This keeps the data fetch on the server and the interactivity minimal.

**One fetch wrapper.** Nothing calls `fetch` directly. `lib/api.ts` centralises credentials, error shaping and — critically — a **single shared in-flight refresh**, so six concurrent 401s trigger one refresh rather than six that trip the reuse detector.

**Server loads forward cookies explicitly.** Session cookies are HttpOnly, so a server component cannot rely on the browser to attach them. Everything authenticated is `cache: 'no-store'` — a cached wallet balance shown to the wrong user is the worst bug this product could ship.

**Styling is semantic tokens only.** `dark:` should not appear anywhere; if it does, a token is missing.

## Performance choices

- One aggregate dashboard call, not six parallel ones — request count dominates payload size on Nigerian 3G
- `refetchOnWindowFocus: false` — metered data
- No automatic mutation retries — a silent retry hides failure from the user
- Recharts is dynamically imported (it is ~100KB, and only the retirement route needs it)
- Theme resolved pre-paint via an inline script, so dark-mode users never see a white flash
