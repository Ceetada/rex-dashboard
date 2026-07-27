<div align="center">

<img src="brand/evas-logo.jpg" alt="Evas" width="320" />

**Healthcare, retirement and everyday digital services for Nigeria — in one account.**

</div>

---

## What this is

A production-oriented platform where Nigerians manage their health plans, retirement savings and pension benefits alongside the everyday services they already buy weekly — airtime, data and cable TV.

The product bet is stated plainly in the [PRD](docs/01-prd.md): **high-frequency utility earns the attention that high-value products need.** People buy airtime fifteen times a month and check their pension twice a year. So the services module is built to be genuinely faster than the bank app they use today, and health and retirement sit in front of them every time they open it.

## The constraint that shapes the system

Paying for something and receiving it are two separately-failing events.

When a user buys ₦500 of airtime, we debit their wallet and ask an aggregator to credit their line. That second step can succeed, fail, or **not answer** — and the third case is common, particularly at month-end. Both naive readings lose money:

- Treat a timeout as failure → refund a top-up that was delivered → give away product.
- Treat a timeout as success → charge for airtime that never arrived → defraud the user.

So the system models three outcomes, not two. An unknown outcome is parked, requeried with backoff, and resolved. Only after repeated failures does it refund — deliberately in the user's favour, flagged for a human, and audit-logged so the cost is measured rather than hidden.

Everything else follows: the append-only ledger, idempotency keys on every purchase, `Transaction` separated from `ServiceOrder`, and a UI that says "Confirming your purchase" instead of showing a green tick it cannot stand behind.

## Repository

```
apps/
  api/          NestJS · Prisma · PostgreSQL · Redis
  web/          Next.js 15 · React 18 · Tailwind
packages/
  design-tokens/  colour system generated from the logo, contrast-gated
  contracts/      Zod schemas + Nigerian primitives, shared by both apps
docs/           18 deliverables — PRD through compliance
infra/          Docker, CI
brand/          the source logo
```

## The design system is derived, not invented

Sampling `brand/evas-logo.jpg` gives three colours accounting for ~78% of the artwork: the wordmark green `#006634`, the diamond gold `#FCCF02`, and the paper beneath them. Every ramp is generated from those seeds in OKLCH so lightness steps are perceptually even and hue holds constant, with each seed **pinned verbatim at its anchor stop** so the brand colour reaches the UI byte-for-byte rather than as a near-miss interpolation.

Accessibility is a build gate. `contrast.test.ts` asserts all 45 foreground/background pairings the system actually ships, across both themes, on every CI run. It caught two real failures during construction: muted text tuned against white that failed on the canvas it actually sits on, and a semantic success green that collided with the brand green on solid fills. Both were fixed before a single component existed.

Full rationale in [docs/06-design-system.md](docs/06-design-system.md).

## Running it

Verified from a clean clone against an empty database — install, migrate, seed, sign in, dashboard.

**You need:** Node 20.11+, pnpm, and Docker.

```bash
pnpm install            # also builds the workspace packages and the Prisma client
pnpm setup              # writes .env files with real generated secrets
pnpm docker:up          # Postgres + Redis

pnpm db:migrate         # creates the tables
pnpm db:seed            # roles, states, providers, 3 health plans, catalogues
pnpm db:seed:demo       # one fully-onboarded user with a plausible history

pnpm dev                # web :3000 · api :4000 · docs :4000/api/docs
```

Open **http://localhost:3000** and sign in:

```
chidinma@example.com
Correct-Horse7-Battery
```

The first sign-in from a new device triggers a real step-up challenge — that is the
security design working, not a bug. Outside production the code is printed to the
**API terminal**:

```
WARN [AuthService] [dev] OTP for +234803•••67 (DEVICE_TRUST): 170823
```

There is no bypass and no weakened check; the code is simply logged instead of being
sent by SMS to a number that, in local development, nobody can receive.

### What each step is doing

| Step | What happens |
|---|---|
| `pnpm install` | Installs dependencies, builds `@evas/design-tokens` and `@evas/contracts`, and generates the Prisma client. Without the last two a clean checkout cannot typecheck or start. |
| `pnpm setup` | Copies both `.env.example` files and fills the four secrets with 32 random bytes each. Idempotent — it never overwrites a value you have already set. |
| `pnpm docker:up` | Starts PostgreSQL 16 and Redis 7. The API waits on Postgres's health check, not merely on the container starting. |
| `pnpm db:migrate` | Applies the migration. Run it again after any schema change. |
| `pnpm db:seed` | Reference data. Idempotent by natural key, so it is also how a new plan or provider is rolled out. |
| `pnpm db:seed:demo` | The demo user, wallet, health cover, retirement and pension history. Never runs with `NODE_ENV=production`. |
| `pnpm dev` | Runs both apps. Output interleaves — the OTP line comes from the API. |

### If something goes wrong

**The API exits immediately with a config error.** That is deliberate: configuration is
validated at boot, so a missing key stops the process rather than surfacing hours later
as a 500 the first time someone saves a BVN. The message names the offending variable.
Re-run `pnpm setup`.

**`docker:up` cannot pull images.** Any PostgreSQL 16 and Redis 7 will do — point
`DATABASE_URL` and `REDIS_URL` in `apps/api/.env` at your own instances.

**Port 3000 or 4000 already in use.** Change `PORT` in `apps/api/.env`, and set
`NEXT_PUBLIC_API_URL` in `apps/web/.env.local` to match.

**No OTP appears.** It goes to the API's output, not the browser. With both apps running
in one terminal the logs interleave — look for the `WARN [AuthService]` line, or run the
API alone in a second terminal with `pnpm --filter @evas/api dev`.

**Sign-in stops asking for a code.** Expected — the device is trusted after the first
successful challenge. Revoke it under Settings → Devices to see the flow again.

## Documentation

| | |
|---|---|
| [01 · PRD](docs/01-prd.md) | Problem, goals, requirements, the constraint |
| [02 · Information architecture](docs/02-information-architecture.md) | Sitemap, navigation, hierarchy |
| [03 · Personas and journeys](docs/03-personas-and-journeys.md) | Four personas, four journeys |
| [04 · Wireframes](docs/04-wireframes.md) | Every major screen, mobile-first |
| [05 · Component inventory](docs/05-component-inventory.md) | Primitives, domain components, rules |
| [06 · Design system](docs/06-design-system.md) | Palette derivation, tokens, accessibility |
| [07 · System architecture](docs/07-system-architecture.md) | Layering, provider abstraction, auth |
| [08 · Database ERD](docs/08-database-erd.md) | Modelling decisions |
| [09 · Prisma schema](docs/09-prisma-schema.md) | 37 models, conventions |
| [10 · Backend structure](docs/10-backend-structure.md) | Folders and rules |
| [11 · Frontend structure](docs/11-frontend-structure.md) | Folders and rules |
| [12 · API specification](docs/12-api-specification.md) | Endpoints, examples, errors |
| [13 · Roadmap](docs/13-roadmap.md) | Seven phases, sequencing rationale |
| [14 · Testing strategy](docs/14-testing-strategy.md) | What is tested, and what deliberately is not |
| [15 · Deployment](docs/15-deployment-architecture.md) | Topology, secrets, observability |
| [16 · Scalability](docs/16-scalability.md) | What breaks, in order |
| [17 · Compliance](docs/17-compliance.md) | NDPA, CBN, NHIA, PenCom |
| [18 · MVP scope](docs/18-mvp-scope.md) | In, out, and launch criteria |

## Extending it

Third-party integrations are the least stable part of this system, so no domain code imports a vendor SDK. Adding a provider is:

1. Write a class implementing `VtuAdapter` / `CableAdapter` / `PaymentAdapter`.
2. List it in `ProvidersModule`.
3. Insert a `providers` row with a category and priority.

The registry resolves by priority with a circuit breaker in front, so failing over from one aggregator to another is a database update rather than a deploy.

Adding a health plan is a database insert — nothing branches on plan tier for presentation. Adding `ELECTRICITY` needs no schema migration; the enum and adapter contract already accommodate it.

## Before this goes live

Two items in [docs/17-compliance.md](docs/17-compliance.md) are hard launch blockers, not checklist entries:

- **CBN.** A stored-value wallet is regulated activity. It requires a licence or a licensed partner. The architecture anticipates a bad answer — `WalletService` is a single isolated seam, so a pass-through model with no stored balance substitutes behind the same interface.
- **NHIA.** Health plans may only be distributed for accredited HMOs.

Neither is an engineering problem, and both have multi-month lead times.
