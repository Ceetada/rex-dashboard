# Backend folder structure

```
apps/api/
├── prisma/
│   ├── schema.prisma          37 models — see docs/08, docs/09
│   ├── seed.ts                idempotent; safe to re-run in production
│   └── migrations/
│
├── src/
│   ├── main.ts                bootstrap: helmet, CORS allowlist, cookies,
│   │                          request id, body limit, rawBody for webhooks
│   ├── app.module.ts          config validation at boot, global guards,
│   │                          throttler tiers, module wiring
│   │
│   ├── common/                cross-cutting. No business logic.
│   │   ├── prisma/            PrismaService (@Global)
│   │   ├── crypto/            EncryptionService — AES-256-GCM, blind index,
│   │   │                      IP hashing, versioned keys
│   │   ├── audit/             AuditService — append-only, field-filtered
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts       deny-by-default + live status check
│   │   │   └── permissions.guard.ts    RBAC; logs denials
│   │   ├── decorators/        @Public @RequirePermissions @CurrentUser @Idempotent
│   │   ├── pipes/             ZodValidationPipe — shares schemas with the web app
│   │   ├── filters/           HttpExceptionFilter — never leaks internals
│   │   └── exceptions/        TooManyRequestsException (Nest ships no 429)
│   │
│   └── modules/               one folder per bounded context
│       ├── auth/              AuthService · TokenService · AuthController
│       ├── users/             profile, dashboard aggregate, preferences
│       ├── wallet/            WalletService — the ledger. + spec
│       ├── health/            plans, subscriptions, dependants, hospitals
│       ├── retirement/        savings + pension (two aggregates, one module)
│       ├── services/          VtuService · ReconciliationJob · controller
│       ├── notifications/     multi-channel fan-out
│       ├── admin/             metrics, users, reconciliation queue, audit
│       └── providers/
│           ├── provider.types.ts     the interfaces the domain depends on
│           ├── provider.registry.ts  resolution + circuit breaker
│           └── adapters/
│               ├── vtpass.adapter.ts     reference VTU adapter
│               └── paystack.adapter.ts   reference payment adapter
│
├── test/                      integration + e2e (real Postgres via testcontainers)
├── vitest.config.ts
└── tsconfig.json
```

## Rules

**Dependencies point inward.** A service may import `provider.types.ts`; it may never import an adapter class. This is what makes swapping a VTU aggregator a database row change rather than a refactor.

**Controllers do three things:** validate with Zod, delegate to a service, shape the response. Any `if` statement expressing a business rule in a controller is a bug.

**Services own transaction boundaries.** `WalletService.debit()` takes a `Prisma.TransactionClient` rather than opening its own transaction, because the debit and the thing being paid for must commit atomically.

**One module per bounded context**, not per entity. Retirement holds both savings and pension because they are one user-facing concern with two aggregates.

**Everything in `common/` is domain-free.** If it knows what a health plan is, it belongs in a module.

## Guard order

```
ThrottlerGuard  →  JwtAuthGuard  →  PermissionsGuard
```

All three are registered globally in `app.module.ts`, so a new controller is protected the moment it is written and must opt out explicitly with `@Public()`. Opt-in guards mean the one endpoint someone forgets to annotate is the one that leaks.

## Configuration

Validated with Zod at boot in `app.module.ts`. A missing `ENCRYPTION_KEYS` stops the process immediately rather than surfacing three hours later as a 500 the first time someone saves a BVN.
