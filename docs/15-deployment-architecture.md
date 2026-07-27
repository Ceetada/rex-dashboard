# Deployment architecture

---

## Topology

```
                     ┌─────────────────────────────┐
                     │        Cloudflare           │
                     │  DNS · WAF · DDoS · CDN     │
                     │  Rate limiting at the edge  │
                     └──────────┬──────────────────┘
              ┌─────────────────┴─────────────────┐
              │                                   │
   ┌──────────▼───────────┐          ┌────────────▼────────────┐
   │       Vercel         │          │   Railway / AWS ECS     │
   │  Next.js — edge SSR  │──REST──▶ │   NestJS API            │
   │  static at 300+ PoPs │          │   2+ instances, HPA      │
   │  Lagos PoP present   │          │   stateless              │
   └──────────────────────┘          └────────────┬────────────┘
                                                  │
                          ┌───────────────────────┼──────────────────┐
                          │                       │                  │
              ┌───────────▼──────────┐  ┌─────────▼────────┐  ┌──────▼──────┐
              │  PostgreSQL 16       │  │  Redis 7         │  │  Worker     │
              │  primary (Multi-AZ)  │  │  sessions·cache  │  │  pool       │
              │  + read replica      │  │  rate limits     │  │  (same img, │
              │  PITR · daily backup │  │  job queue       │  │   no HTTP)  │
              └──────────────────────┘  └──────────────────┘  └─────────────┘
                          │
              ┌───────────▼──────────┐
              │   AWS S3 (eu-west-1) │  documents, statements, avatars
              │   SSE-KMS · private  │  signed URLs only, short TTL
              └──────────────────────┘
```

## Why this shape

**Vercel for the frontend.** Next.js 15 SSR at the edge, with a Lagos point of presence — meaningful when the median user is on 3G in Lagos or Abuja.

**A separate API host.** The API is stateless and horizontally scalable, but it holds long-lived database connections and runs scheduled jobs, neither of which fits serverless well.

**Workers run the same image as the API**, with HTTP disabled. One build, one deploy, no drift between the code that serves requests and the code that reconciles them.

**Region: eu-west-1 (Ireland).** No AWS region in Nigeria. Ireland has the lowest latency to Lagos of the mature regions, and adequacy for data transfers. Data residency implications are covered in [17-compliance.md](./17-compliance.md) — if Nigerian residency becomes mandatory, a local provider replaces this tier without an application change.

## Environments

| | Purpose | Data | Access |
|---|---|---|---|
| **Local** | Development | Docker Compose, seeded | Everyone |
| **Preview** | Per-PR | Ephemeral, seeded | Everyone |
| **Staging** | Pre-production | Anonymised copy | Engineering |
| **Production** | Live | Real | Break-glass only |

Staging uses **anonymised** data, never a production copy. A production dump on a staging host is a breach that has not been noticed yet.

## Container

```dockerfile
# Multi-stage: build with the full toolchain, ship without it
FROM node:22-alpine AS builder
# … install, prisma generate, nest build

FROM node:22-alpine AS runner
RUN addgroup -S evas && adduser -S evas -G evas
USER evas                       # never root
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
HEALTHCHECK CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/main.js"]
```

Non-root, no build toolchain in the runtime image, health check for the orchestrator.

## Migrations

```
build → migrate (prisma migrate deploy) → rolling deploy → smoke → done
                        │
                        └─ fails → abort, no deploy
```

Migrations run **before** the new code, which forces every migration to be backwards-compatible with the currently-running version. A column rename is therefore a three-deploy sequence: add, backfill and dual-write, then drop.

Rollback: `railway rollback` (or an ECS task-definition revert) reverts code in ~30s. Migrations are **not** auto-rolled-back — a down-migration on live data is more dangerous than the bug it undoes, so the fix is a forward migration.

## Secrets

Never in the image, never in the repository, never in an env file on a host.

| Environment | Store | Injection |
|---|---|---|
| Local | `.env` (gitignored) | dotenv |
| Preview | Platform secrets | At runtime |
| Staging / Production | AWS Secrets Manager | At boot, via IAM role |

`ENCRYPTION_KEYS` is versioned (`1:base64,2:base64`) so rotation is additive: add key 2, new writes use it, a background job re-wraps old envelopes, then key 1 retires. No flag day.

Rotation cadence: JWT and cookie secrets quarterly; encryption keys annually; provider credentials per vendor policy or immediately on suspicion.

## Observability

| Concern | Tool | What it must answer |
|---|---|---|
| Logs | Structured JSON (pino) → Datadog | "What happened to request `8f3c91ab`?" |
| Metrics | Prometheus → Grafana | Latency, error rate, saturation, per-provider success rate |
| Traces | OpenTelemetry | "Where did those 4 seconds go?" |
| Errors | Sentry, source-mapped | |
| Uptime | External, Lagos probe | Availability as a Nigerian user experiences it |

**Never logged:** passwords, tokens, OTPs, BVN/NIN, decrypted anything, full card data. The audit service field-filters; the logger has a redaction list. Both, because either alone eventually fails.

### Alerts that page

| Condition | Threshold |
|---|---|
| API 5xx rate | >1% over 5 min |
| p95 latency | >2s over 5 min |
| Unreconciled orders older than 1h | >10 |
| Provider circuit open | >5 min |
| Failed logins from one IP | >100/min |
| Audit write failure | any |
| Database connections | >80% of pool |

The unreconciled-orders alert is the important one. It means user money is in limbo, and it is the earliest signal that a provider integration has broken.

## Backups and recovery

| | Target |
|---|---|
| Database backup | Daily full + continuous WAL |
| Retention | 30 days PITR, 7 years for compliance archives |
| **RPO** | ≤5 minutes |
| **RTO** | ≤1 hour |
| Restore drill | Quarterly, to a scratch environment, timed |

An untested backup is a hypothesis. The quarterly drill is what turns it into a plan.

## Cost at launch

| | Monthly |
|---|---|
| Vercel Pro | ~$20 |
| API hosting (2 instances) | ~$40 |
| PostgreSQL (Multi-AZ + replica) | ~$120 |
| Redis | ~$25 |
| S3 + CloudFront | ~$15 |
| Cloudflare Pro | ~$25 |
| Datadog / Sentry | ~$100 |
| **Total** | **~$345** |

Roughly $2,000/month at 100k MAU, dominated by the database tier.
