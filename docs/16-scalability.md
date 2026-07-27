# Scalability

Targets: launch at 10k MAU, plan to 1M. The constraint that binds first is **not** request throughput — it is database write contention on hot wallet rows, and it appears far earlier than most capacity plans assume.

---

## What breaks, in order

| Users | Bottleneck | Fix |
|---|---|---|
| 10k | None. Single API instance, single database. | — |
| 50k | Read queries competing with writes | Route reads to a replica |
| 100k | Connection exhaustion | PgBouncer, transaction pooling |
| 250k | `transactions` and `audit_logs` table size | Monthly partitioning |
| 500k | Reconciliation job serial processing | Parallel workers, `SKIP LOCKED` |
| 1M | Single-primary write ceiling | Shard by `userId`, or move the ledger to dedicated infrastructure |

## The real constraint

Every purchase takes `SELECT … FOR UPDATE` on one wallet row. That serialises all transactions **for that user**, which is correct and necessary — it is what prevents double-spending.

Crucially, it does **not** serialise across users. Two different users transact concurrently without contention. So the ceiling is per-user transaction rate, not global, and a single user cannot realistically exceed a few purchases per second.

What this does mean: **lock duration must stay short**. The provider call therefore happens *outside* the database transaction. Holding a lock across a 30-second aggregator timeout would be catastrophic, and the code is structured specifically to avoid it:

```ts
// Inside the transaction: debit + create order. Milliseconds.
await prisma.$transaction(async (tx) => { … }, { isolationLevel: 'Serializable' });

// Outside: the slow, unreliable part.
const outcome = await adapter.purchaseAirtime(…);
```

Getting this backwards is the single most likely way to take the platform down under load.

## Database

**Read replicas** for the dashboard aggregate, catalogues, history and admin reporting. Never for a read that precedes a write — replica lag would reintroduce the double-spend the row lock prevents.

**Partitioning** at ~250k users, on `createdAt`, monthly:

```sql
CREATE TABLE transactions (…) PARTITION BY RANGE (created_at);
CREATE TABLE transactions_2026_07 PARTITION OF transactions
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

Same for `audit_logs` and `ledger_entries`. Most queries filter by recent date and touch one partition; old partitions detach to cold storage after the retention window.

**Connection pooling.** Each API instance holds a pool; ten instances at 20 connections each exhausts a standard Postgres. PgBouncer in transaction mode multiplexes hundreds of clients onto tens of server connections.

## Caching

| Data | TTL | Invalidation |
|---|---|---|
| Health plan catalogue | 1h | On admin edit |
| Service products | 15m | On catalogue sync |
| States and LGAs | 24h | Never changes |
| Hospital network | 1h | On sync |
| **Wallet balance** | **never** | — |
| **Transaction history** | **never** | — |

Balances and history are never cached. A stale balance shown to a user, or worse a cached response served to the wrong user, is the worst bug this product could produce. The performance win is not worth the class of bug.

Cache keys include a version prefix (`v1:plans:all`) so a schema change invalidates everything by bumping one constant.

## Background jobs

Reconciliation is the job that grows with transaction volume. At scale it moves from a serial loop to parallel workers:

```sql
SELECT * FROM service_orders
WHERE status = 'REQUIRES_RECONCILIATION'
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;   -- workers claim disjoint batches
```

`SKIP LOCKED` lets N workers process without coordination or duplicate work.

Announcement fan-out is already a job rather than a request, because writing a Notification row per user inline would time out on any real audience. At 1M users it batches at 10k per chunk.

## Frontend

- One aggregate dashboard call, not six — request count dominates payload on Nigerian 3G
- Server components ship zero JavaScript for static sections
- Recharts (~100KB) dynamically imported; only the retirement route pays for it
- `refetchOnWindowFocus: false` — metered data is a real cost to users
- Static assets on Cloudflare, immutable, hashed filenames

## Provider capacity

VTU aggregators impose their own rate limits, and at scale they become the ceiling rather than our infrastructure. Mitigations, in order of preference:

1. **Multiple aggregators**, load-balanced by priority — the registry already supports this
2. **Request coalescing** for catalogue syncs
3. **Queueing with backpressure** — if the provider is saturated, queue rather than fail, and tell the user honestly

The circuit breaker already sheds load from a failing provider. What it does not do is queue, which is the next step if a provider becomes a sustained bottleneck.

## Load testing

Before launch, k6 against staging at 10× projected traffic:

| Scenario | Target |
|---|---|
| Dashboard load | p95 < 800ms at 500 rps |
| Airtime purchase | p95 < 2s at 100 rps |
| Concurrent debits, same wallet | **zero double-spends** |
| Provider timeout under load | all orders reconcile correctly |

The third row is a correctness assertion, not a performance one, and it is the one that must never be waived.
