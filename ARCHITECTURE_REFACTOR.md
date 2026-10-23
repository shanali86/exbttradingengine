# Exbeast exchange: architecture review and refactor blueprint

Scope: the engine-market path, meaning orders on `local_markets` from the API through the Rust
engine and back into wallets, and the WebSocket gateway. The KuCoin/MEXC proxy paths,
futures, margin, affiliate and fee internals were only skimmed.

Date: 2026-10-22

> **Status: implemented** (same day). See [section 10](#10-what-was-implemented) for what
> changed, where the implementation deliberately departs from this blueprint, what is
> verified, and [section 11](#11-cutover-runbook) for the deployment order.

---

## 1. How it works today

```
App ──POST order──► Laravel API ──(DB tx: hold + spot_orders row)──► commit
                         └──XADD laravel_orders_stream──► exbeast-engine (Rust, 1 thread, 1 instance)
                                                              │ MULTI/EXEC per batch:
                                                              │   events + book ZSET deltas + FULL state JSON + offsets
                    ┌──── engine_trades_stream ◄──────────────┤
                    │     engine_orders_stream ◄──────────────┘
engine:sync-matches (1 PHP proc) ──► settle wallets per trade
engine:sync-orders  (1 PHP proc) ──► release holds, waits until deal_size catches up
exbeast-ws (Rust, N instances) ──► XREAD both streams + ZRANGE books ──► one global broadcast ──► every socket filters
```

**What is already good, so keep it:**

- `engine.rs` is a pure state machine (`handle(cmd, now) -> Vec<Out>`) with good tests.
- It has exactly-once output: events, state and input offsets are written in one `MULTI/EXEC`.
- A single-writer lease is enforced through `WATCH` on commit.
- The recovery protocol uses a `boot_id`, dead-letter streams, and `XAUTOCLAIM` takeover.
- WS auth uses one-time tickets (`GETDEL`), origin checks, per-user caps and slow-client disconnect.

The *shape* is right: a single-threaded matcher per book, an event log, and a stateless gateway.
The problems are at specific seams.

---

## 2. Findings, ranked

### P0: money correctness (fix before scaling)

| # | Issue | Where | Failure |
|---|---|---|---|
| 1 | **Trade IDs restart after state loss.** `trade_id = "{symbol}-{trade_seq}"`, and `Engine::default()` resets `trade_seq` to 0. Recovery restores orders but not the counter. | `Exbeast_Matching_Engine/src/engine.rs:178-180`, `io.rs:228` | New fills reuse IDs already in `spot_trades`. `ProcessGoEngineMatches.php:121` treats them as already applied and **skips settlement**: the engine has moved coins but the wallets never change. |
| 2 | **Order dispatch isn't atomic with the hold.** The DB transaction commits, *then* `XADD`. | `app/Services/Exchange/LocalTradeService.php:87-146` | (a) A crash between them leaves the order `open` with funds held forever. (b) `XADD` reaches Redis but the reply times out, so Laravel **releases the hold and marks the order rejected while the engine trades it**. That is a double spend. |
| 3 | **No `UNIQUE(user_id, currency)` on `spot_wallets`.** `spotIncrement` does lock-or-create, and `FOR UPDATE` on a missing row locks nothing. | `2025_10_15_134019_create_spot_wallets_table.php`, `SpotWalletService.php:41` | Concurrent first credits create duplicate wallet rows, so a balance gets split or lost. |
| 4 | **Return values ignored on hold release.** `spotReleaseBalance()` returns `false` when `hold < amount` (float dust), and settlement ignores that. | `ProcessGoEngineMatches.php:236,243` | The user is credited the other asset while `hold` stays too high, so the books drift with no error raised. |
| 5 | **Money computed in floats.** `round((float)$price*(float)$size, 8)` and `(float)$raw / 1e8`, while the engine floors integer notionals. Column scales differ: wallets use `decimal(18,8)`, `held_amount` uses `decimal(24,10)`. | `LocalTradeService.php:78-80`, `ProcessGoEngineMatches.php:363-380` | Rounding drift, which feeds #4. |
| 6 | **`decimal(18,8)` caps at about 1e10.** | `spot_wallets`, `spot_orders`, `spot_trades` | Tokens with large supply overflow, or MySQL truncates them in non-strict mode. |
| 7 | **`client_oid` is unique across all users, not per user.** | `create_spot_orders_table.php` | One user's ID collides with another user's and returns a 500 (unhandled `QueryException`). |

### P1: throughput and concurrency bottlenecks

| # | Bottleneck | Where | Cost |
|---|---|---|---|
| 8 | **The full engine state is serialized on every batch.** | `io.rs:383` | O(all resting orders, all markets) per commit. 200k orders at about 300 B each is roughly 60 MB of JSON per batch. This is the engine's hard ceiling, plus AOF write amplification and 2× peak memory. |
| 9 | **Settlement handles one trade per transaction with about 30-40 queries**, including `Schema::hasTable` + `Schema::getColumnListing` (information_schema) **on every trade**, nested savepoint transactions, and history lookups. | `ProcessGoEngineMatches.php:118-139, 322-326` | Roughly 50-150 trades/s in one PHP process. The engine is 2-3 orders of magnitude faster, so the backlog grows without bound in volatile periods and balances lag. |
| 10 | **Two streams, two consumers, reconciled by polling.** Order-end events are deferred until `deal_size` catches up, with `usleep` and re-reads. | `EngineOrderEventService.php:62-65`, `EngineSyncOrders.php:46-50` | Extra DB load and latency. The ordering the engine already produced is thrown away. |
| 11 | **Arbitrary lock order.** Each trade locks the maker order, then the taker order, then wallets in call order. API `placeOrder` locks the wallet first. | `ProcessGoEngineMatches.php:124-136` | Deadlocks once you add a second consumer, so it can't scale horizontally as written. |
| 12 | **Stop triggers scan everything.** `trigger_stops` does a full scan of `stops` on each loop iteration. | `engine.rs:228-255` | O(S) per trade and O(S·k) for cascades. |
| 13 | **Cancels are linear within a price level.** `Book::remove` uses `VecDeque::retain`. | `book.rs:72` | Mass cancels at a popular price level are O(n²). |
| 14 | **The book is stored per order, three times**: the engine `members` JSON, a Redis ZSET with one JSON member per order, and the WS gateway, which runs `ZRANGE 1000` and JSON-parses every member to rebuild levels every 250 ms per symbol. | `book.rs:88-104`, `feeds.rs:135-139` | Memory ×3, and one `ZREM`+`ZADD` with JSON per partial fill. Depth is also wrong when the top N levels hold more than 1000 orders. |
| 15 | **WS fan-out is O(connections × events).** One `broadcast(8192)` goes to every socket, each does `msg.to_string()` (a copy per socket), and `Lagged` drops **private** order/fill events. | `main.rs:33`, `session.rs:202-215` | 10k sockets × 2k events/s = 20M wakeups/s, and users miss their own fills. |
| 16 | **One engine thread for all markets.** | `io.rs:147` | A hot market blocks every other market (head-of-line blocking). |
| 17 | Lookups on every call: `isLocalSymbol()` and the `LocalMarket` query run on every order and order-book request. | `TradeController.php:38`, `BrokerController.php:64` | Avoidable DB round trips on the hot path. |

### P2: Clean Architecture violations

- **HTTP concerns in the domain.** Services throw `Symfony HttpException` and return raw arrays (`LocalTradeService`).
- **Domain logic inside a console command.** All of trade settlement lives in `ProcessGoEngineMatches`, so it can't be reused or unit-tested without the loop.
- **Fat controllers.** `BrokerController` (1225 lines) mixes KuCoin proxying, HTTP calls to kucoin.com, and Redis order-book assembly.
- **Validation in three places**, each slightly different: `SpotOrderRequest`, `LocalTradeService::checkRules`, and the engine's `validate`.
- **`$request->all()` passed into services** instead of a typed input.
- **Repositories exist only for history/PTS.** Trading reads and writes Eloquent directly from services and commands.
- **Routing is a static `isLocalSymbol` check** instead of a broker strategy.

---

## 3. Target architecture

```
                     ┌──────────── Laravel (Spot bounded context) ────────────┐
App ─► Controller ─► │ PlaceOrderAction ─► Ledger.lock() + Order + Outbox row  │ (1 DB tx)
                     │                                                         │
                     │ OutboxRelay (daemon) ─► XADD engine:in:{shard}           │ idempotent on order_id
                     └─────────────────────────────────────────────────────────┘
                                         │
              ┌──────────────────────────┴──────────────────────────┐
     exbeast-engine shard 0 (markets A..)              shard 1 (markets ..Z)    ← lease per shard
       snapshot every N s + journal = input stream, deterministic replay
       emits ONE ordered stream engine:out:{shard} (trades + order events, seq-numbered)
       emits engine:l2:{symbol} (aggregated levels + seq) for market data
              │                                                     │
   SettlementConsumer[shard] (1 per shard, batches of 200-1000 events, 1 DB tx per batch,
   aggregated wallet deltas, sorted locks, offset stored in DB in the same tx)
              │
   exbeast-ws: topic-keyed fan-out (public: per-topic broadcast; private: per-user registry)
```

Design rules:

1. **MySQL is the source of truth for money. The engine is the source of truth for matching.**
   Hand-off in both directions is idempotent and carries offsets. No step relies on "it probably
   didn't arrive".
2. **One ordered output stream per engine shard.** The order the engine produced is the order
   Laravel applies, so no reconciliation is needed.
3. **Partition by market.** Books are independent, so engine shards and settlement consumers scale
   linearly. Keep each shard single-threaded (LMAX style). That choice is correct; don't add
   locks to the matcher.
4. **Money is never a float.** Use integer units (1e8) on the wire and in the engine, and
   `DECIMAL(36,18)` with `brick/math` (or bcmath) in PHP.

---

## 4. Laravel: refactored structure

Keep the rest of the app as is. Carve out the trading bounded context, following the existing
`app/Modules/*` convention:

```
app/Modules/Spot/
├── Http/
│   ├── Controllers/OrderController.php        # thin: FormRequest → DTO → Action → Resource
│   ├── Controllers/MarketDataController.php   # order book / ticker (reads engine L2, no KuCoin code)
│   ├── Requests/PlaceOrderRequest.php         # shape only (types, enums); market rules live in Domain
│   └── Resources/OrderResource.php
├── Application/                               # use cases, one public method each
│   ├── PlaceOrder.php
│   ├── CancelOrder.php
│   ├── ApplyEngineBatch.php                   # trades + order events, one tx per batch
│   ├── RecoverEngine.php                      # current EngineRecoveryService
│   └── DTO/ PlaceOrderInput.php, OrderPlaced.php, EngineEvent.php (TradeEvent|OrderEvent)
├── Domain/
│   ├── Money/Units.php                        # immutable fixed-point value object (BigDecimal inside)
│   ├── Market/MarketRules.php                 # tick/lot/min/max/band: single PHP copy of engine::validate
│   ├── Order/OrderStatus.php                  # enum + allowed transitions
│   ├── Ledger/Ledger.php (interface)          # lock / unlock / transfer, idempotent by ref
│   ├── Broker/BrokerGateway.php (interface)   # place / cancel
│   └── Exceptions/ InsufficientBalance, MarketClosed, RuleViolation (→ 422 in the handler)
├── Infrastructure/
│   ├── Persistence/ EloquentOrderRepository.php, EloquentLedger.php, MarketRegistry.php (cached)
│   ├── Engine/ OutboxRelay.php, EngineStreamConsumer.php, EngineShardMap.php
│   ├── Brokers/ EngineBroker.php, KuCoinBroker.php (wrap the existing KuCoin services)
│   └── BrokerResolver.php                     # symbol → BrokerGateway (replaces isLocalSymbol)
├── Console/ RunOutboxRelay.php, RunSettlement.php {shard}   # 10-line loops calling Application/*
└── routes/api.php
```

`MarketRegistry` caches `local_markets` in memory and Redis, invalidated by
`ExchangeListingService` on update. That removes the per-request queries from finding 17.

### PlaceOrder (outbox, fixes findings 2, 5, 7)

```php
final class PlaceOrder
{
    public function __construct(
        private MarketRegistry $markets,
        private Ledger $ledger,
        private OrderRepository $orders,
        private Outbox $outbox,
    ) {}

    public function __invoke(PlaceOrderInput $in): OrderPlaced
    {
        $market = $this->markets->tradable($in->symbol);      // throws MarketClosed
        $market->rules()->assertValid($in);                   // throws RuleViolation
        $hold   = $market->holdFor($in);                      // Units, exact integer math

        return DB::transaction(function () use ($in, $market, $hold) {
            // Idempotent retry: same (user, client_oid) returns the original order.
            if ($existing = $this->orders->findByClientOid($in->userId, $in->clientOid)) {
                return OrderPlaced::from($existing);
            }
            $order = $this->orders->createPending($in, $market, $hold);      // status = pending_submit
            $this->ledger->lock($in->userId, $hold->currency, $hold->amount, ref: "order:{$order->id}");
            $this->outbox->push('engine', $market->shard, $order->toEnginePayload());
            return OrderPlaced::from($order);
        }, attempts: 3);                                                      // deadlock retry
    }
}
```

`OutboxRelay` reads `engine_outbox WHERE published_at IS NULL ORDER BY id LIMIT 500`, runs
`XADD`, then sets `published_at`. A duplicate publish is harmless: the engine already rejects
`duplicate_order_id`, and `EngineOrderEventService` already ignores that rejection. **Laravel
never releases a hold because a send failed.** Only an engine event (`rejected`, `cancelled`,
`done`) releases it.

### ApplyEngineBatch (fixes findings 4, 9, 10, 11)

```php
public function __invoke(string $stream, array $events /* EngineEvent[] in engine order */): void
{
    DB::transaction(function () use ($stream, $events) {
        $offset = $this->offsets->lockFor($stream);                        // SELECT … FOR UPDATE
        $events = array_filter($events, fn ($e) => $e->id > $offset);       // replay-safe, no per-trade EXISTS

        $deltas = new LedgerDeltas();             // (user, currency) → [available Δ, locked Δ]
        $orderIds = collect($events)->flatMap->orderIds()->unique()->sort()->values();
        $orders = $this->orders->lockMany($orderIds);                        // sorted ids → no deadlocks

        foreach ($events as $e) {
            match (true) {
                $e instanceof TradeEvent => $this->settle($e, $orders, $deltas),   // fills, fees, held_remaining
                $e instanceof OrderEvent => $this->close($e, $orders, $deltas),    // releases held_remaining
            };
        }

        $this->ledger->apply($deltas);            // wallets locked in (user_id, currency) order; 1 UPDATE each;
                                                  // throws if any locked balance would go < 0 (finding 4)
        $this->orders->saveMany($orders);
        $this->trades->insertMany(...);           // bulk INSERT
        $this->ledgerEntries->insertMany(...);    // bulk INSERT, UNIQUE(ref, account) for idempotency
        $this->offsets->advance($stream, last($events)->id);
    }, attempts: 3);
    // after commit: XACK + WsUserEvents for the affected users (deduplicated)
}
```

Fees: compute the fee inside the same batch as a ledger delta to the company account. Keep the
`fee_pending` retry path only for genuine failures (for example, a missing company account).

---

## 5. Database schema (MySQL 8)

New tables first, then backfill, dual-write, and switch over. Don't edit old migrations.

```sql
-- Balances: one row per user and currency, enforced.
CREATE TABLE spot_accounts (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  currency      VARCHAR(20)     NOT NULL,
  available     DECIMAL(36,18)  NOT NULL DEFAULT 0,
  locked        DECIMAL(36,18)  NOT NULL DEFAULT 0,
  version       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP(6)    NULL,
  UNIQUE KEY uq_user_currency (user_id, currency),
  KEY ix_currency (currency),
  CONSTRAINT chk_nonneg CHECK (available >= 0 AND locked >= 0)
) ENGINE=InnoDB;

-- Append-only ledger. Each balance change is one row. Replaces spot_wallet_histories morphs.
CREATE TABLE spot_ledger_entries (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id     BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  currency       VARCHAR(20)     NOT NULL,
  delta_available DECIMAL(36,18) NOT NULL,
  delta_locked   DECIMAL(36,18)  NOT NULL,
  kind           VARCHAR(24)     NOT NULL,   -- order_lock | fill | fee | release | deposit | withdraw ...
  ref_type       VARCHAR(24)     NOT NULL,   -- order | trade | deposit ...
  ref_id         VARCHAR(64)     NOT NULL,
  created_at     TIMESTAMP(6)    NOT NULL,
  UNIQUE KEY uq_idem (ref_type, ref_id, account_id, kind),
  KEY ix_user_time (user_id, created_at)
) ENGINE=InnoDB;
-- Later, PARTITION BY RANGE on created_at (monthly) once it reaches about 100M rows.

CREATE TABLE spot_orders_v2 (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id        VARCHAR(40)    NOT NULL,          -- engine id
  user_id         BIGINT UNSIGNED NOT NULL,
  client_oid      VARCHAR(64)    NOT NULL,
  market_id       BIGINT UNSIGNED NOT NULL,
  side            ENUM('buy','sell') NOT NULL,
  type            ENUM('limit','market') NOT NULL,
  tif             ENUM('GTC','IOC','FOK') NOT NULL DEFAULT 'GTC',
  post_only       BOOLEAN NOT NULL DEFAULT FALSE,
  stp             ENUM('CN','CO','CB','DC') NOT NULL DEFAULT 'CN',
  stop            ENUM('loss','entry') NULL,
  price           DECIMAL(36,18) NOT NULL DEFAULT 0,
  size            DECIMAL(36,18) NOT NULL DEFAULT 0,
  funds           DECIMAL(36,18) NOT NULL DEFAULT 0,
  stop_price      DECIMAL(36,18) NOT NULL DEFAULT 0,
  filled_size     DECIMAL(36,18) NOT NULL DEFAULT 0,
  filled_funds    DECIMAL(36,18) NOT NULL DEFAULT 0,
  held_currency   VARCHAR(20)    NOT NULL,
  held_remaining  DECIMAL(36,18) NOT NULL DEFAULT 0,
  fee_paid        DECIMAL(36,18) NOT NULL DEFAULT 0,
  status          ENUM('pending_submit','open','stop_pending','partially_filled',
                       'filled','cancelled','rejected') NOT NULL,
  is_active       BOOLEAN AS (status IN ('pending_submit','open','stop_pending','partially_filled')) STORED,
  reason          VARCHAR(64) NULL,
  created_time    BIGINT NOT NULL,
  created_at      TIMESTAMP(6) NOT NULL,
  updated_at      TIMESTAMP(6) NOT NULL,
  UNIQUE KEY uq_order (order_id),
  UNIQUE KEY uq_client (user_id, client_oid),
  KEY ix_open (user_id, is_active, created_at),
  KEY ix_market_open (market_id, is_active)
) ENGINE=InnoDB;

CREATE TABLE spot_trades_v2 (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trade_id       VARCHAR(64) NOT NULL,              -- {symbol}-{epoch}-{seq}: unique across engine resets
  market_id      BIGINT UNSIGNED NOT NULL,
  taker_side     ENUM('buy','sell') NOT NULL,
  price          DECIMAL(36,18) NOT NULL,
  size           DECIMAL(36,18) NOT NULL,
  funds          DECIMAL(36,18) NOT NULL,
  maker_order_id VARCHAR(40) NOT NULL,
  taker_order_id VARCHAR(40) NOT NULL,
  maker_user_id  BIGINT UNSIGNED NOT NULL,
  taker_user_id  BIGINT UNSIGNED NOT NULL,
  maker_fee      DECIMAL(36,18) NOT NULL DEFAULT 0,
  taker_fee      DECIMAL(36,18) NOT NULL DEFAULT 0,
  created_time   BIGINT NOT NULL,
  UNIQUE KEY uq_trade (trade_id),
  KEY ix_market_time (market_id, created_time),
  KEY ix_maker (maker_user_id, created_time),
  KEY ix_taker (taker_user_id, created_time)
) ENGINE=InnoDB;

CREATE TABLE engine_outbox (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shard        SMALLINT UNSIGNED NOT NULL,
  payload      JSON NOT NULL,
  created_at   TIMESTAMP(6) NOT NULL,
  published_at TIMESTAMP(6) NULL,
  KEY ix_unpublished (published_at, id)
) ENGINE=InnoDB;

CREATE TABLE engine_consumer_offsets (
  stream     VARCHAR(80) PRIMARY KEY,               -- engine:out:{shard}
  last_id    VARCHAR(40) NOT NULL,                  -- Redis stream id; compare as (ms, seq)
  updated_at TIMESTAMP(6) NOT NULL
) ENGINE=InnoDB;

ALTER TABLE local_markets
  ADD COLUMN shard SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN base_precision TINYINT UNSIGNED NOT NULL DEFAULT 8,
  ADD COLUMN quote_precision TINYINT UNSIGNED NOT NULL DEFAULT 8;
```

**Interim P0 migration on the existing tables**, until v2 lands:

1. Merge duplicate `spot_wallets` rows (sum `equity`/`hold`, repoint histories).
2. `ALTER TABLE spot_wallets ADD UNIQUE (user_id, currency)`, then widen money columns to `DECIMAL(36,18)`.
3. On `spot_orders`, drop `UNIQUE(client_oid)` and add `UNIQUE(user_id, client_oid)`.

The dedupe in step 1 is irreversible, so take a backup and dry-run it first.

---

## 6. Matching engine changes

### 6.1 Unique trade IDs (finding 1). Do this first; it's small.

```rust
// engine.rs
pub struct Engine {
    pub markets: HashMap<String, MarketConfig>,
    pub books: HashMap<String, Book>,
    pub seq: u64,
    pub trade_seq: u64,
    /// Set once when an engine starts without saved state; keeps trade ids unique across resets.
    #[serde(default)]
    pub epoch: u64,
}
// …
trade_id: format!("{}-{}-{}", o.symbol, self.epoch, self.trade_seq),

// io.rs load_state(), no-saved-state branch
Ok(State { engine: Engine { epoch: now_ms() as u64, ..Engine::default() }, … })
```

For an already-running engine, existing state deserializes with `epoch = 0`, so IDs only change
format after the next fresh start. That's safe, because pre-existing IDs never had an epoch part.

### 6.2 Snapshot plus journal instead of full state per batch (finding 8)

- **Per batch:** commit only the events, L2 deltas and `committed_offsets`. These stay O(batch).
- **Every `ENGINE_SNAPSHOT_SECS` (5 s) or N commands:** write `engine:snapshot` = state + the input
  offsets it covers.
- **On start:** load the snapshot, then replay the input streams from the snapshot offsets up to
  `committed_offsets` **with output discarded**, because those events were already emitted. After
  that, run normally.
- **Determinism, which replay requires:**
  - Use the stream entry ID's millisecond part as `now`, not `now_ms()`.
  - Record the `boot_id` that accepted each `restore` in the snapshot, so replayed restores still
    match it.
- **Stream trimming:** `XTRIM MINID` only up to the **snapshot** offsets, not the committed ones
  (`io.rs:323`).
- **Encoding:** use `bincode`/`postcard` for the snapshot. It's 5-10× smaller and faster than JSON.

### 6.3 One ordered output stream per shard (finding 10)

Write every `Out::Trade` and `Out::Order` to `engine:out:{shard}` as
`{seq, kind: "trade"|"order", ...}` in emission order. Keep the old two streams behind a flag
during the migration.

### 6.4 Data-structure fixes (findings 12, 13, 14)

```rust
pub struct Book {
    bids: BTreeMap<u64, Level>, asks: BTreeMap<u64, Level>,
    orders: HashMap<OrderKey, Order>,               // OrderKey = u64 internal id; external id stored once
    ids: HashMap<String, OrderKey>,
    stops_loss:  BTreeMap<(u64 /*stop_price*/, u64 /*seq*/), OrderKey>,  // fire when last <= stop_price
    stops_entry: BTreeMap<(u64, u64), OrderKey>,                          // fire when last >= stop_price
    l2_dirty: BTreeSet<(Side, u64)>,                // levels changed this batch
}
struct Level { total: u64, queue: slab-backed intrusive list of OrderKey }   // O(1) cancel
```

- **Stop triggering:** take `stops_loss.range((last, 0)..)` plus `stops_entry.range(..=(last, u64::MAX))`,
  merge by `seq`, then fire. Cost is proportional to the stops that actually fire.
- **Redis book:** replace the per-order ZSET members with an **L2 hash** `engine:l2:{symbol}:{side}`
  (field = price, value = total size) plus an `engine:l2:{symbol}` delta stream carrying
  `{seq, changes:[[side,price,total]]}`. The gateway then serves snapshot+delta with a sequence,
  KuCoin style, and never parses per-order JSON.
- **Remove the `members` map entirely.**

### 6.5 Sharding (finding 16)

Run `ENGINE_SHARD=k` and `ENGINE_MARKETS=...` (or `local_markets.shard = k`).

- Each shard gets its own lease `engine:lock:{k}`, input stream `engine:in:{k}`, output stream
  `engine:out:{k}` and snapshot.
- Laravel's `EngineShardMap` routes each order to its market's shard.
- Moving a market between shards is an admin operation: halt it, cancel-all or migrate, then resume.

---

## 7. WebSocket gateway changes (finding 15)

```rust
pub struct Hub {
    public:  DashMap<Arc<str> /*topic*/, broadcast::Sender<Utf8Bytes>>,   // created on first subscribe
    private: DashMap<u64 /*user*/, Vec<mpsc::Sender<Utf8Bytes>>>,          // never lossy: overflow → disconnect
    …
}
```

- Feeds serialize each message once into `Utf8Bytes` (`Bytes`-backed). Cloning it per socket is a
  refcount bump, not a copy.
- A session runs a `StreamMap` over only the topics it subscribed to. CPU becomes O(deliveries)
  instead of O(connections × events).
- Private events never pass through a lossy broadcast. If a user's queue is full, the gateway closes
  that socket so the client resyncs. It doesn't silently skip events.
- Depth comes from the engine L2 delta stream (6.4): send a snapshot on subscribe, then deltas with
  `sequence`, and clients detect gaps.

---

## 8. Rollout order

| Phase | Work | Size |
|---|---|---|
| **P0** (this week) | 6.1 trade-ID epoch · check `spotReleaseBalance`/`spotIncrement` returns and throw · remove `Schema::*` calls from `insertTradeLog` · stop releasing holds on `XADD` exceptions (mark the order `pending_submit` and let a reconciler resend it) · interim migration (wallet dedupe + unique, `(user_id, client_oid)`) | Small |
| **P1** | Outbox + relay · `ApplyEngineBatch` with aggregated deltas and DB offsets · single ordered output stream · engine snapshot + journal · stop indexes · `MarketRegistry` cache | Medium |
| **P2** | Spot module extraction (Actions/DTO/Repositories/Domain) · v2 tables + backfill + dual-write · `brick/math` Units | Medium-large |
| **P3** | Engine sharding · L2 delta stream · WS topic fan-out · ledger partitioning | Large |

**Load-test gate between phases:**

- Use a replay harness that feeds a recorded `laravel_orders_stream` into a staging stack.
- Assert **Σ(available + locked) per currency is unchanged** apart from deposits, withdrawals and fees.
- Assert **every engine trade has exactly one `spot_trades` row**.
- Track settlement lag (engine stream head minus DB offset) as the key SLO on the admin heartbeat page.

---

## 9. Not verified

- Library-version guidance (Laravel 12 transaction retry, redis-rs 0.27 vs current, axum 0.8
  `Utf8Bytes`, tokio `broadcast` semantics) comes from general knowledge. Context7 wasn't
  authenticated during this review.
- `chargeTradeFee` → `settleTradeFee` and the affiliate paths were not traced in full. They add
  more queries per fill than counted in finding 9.

---

## 10. What was implemented

### Matching engine (`Exbeast_Matching_Engine`)

| Finding | Change | Where |
|---|---|---|
| 1 trade-id reuse | Every trade id carries the run's epoch (`{symbol}-{epoch}-{n}`); a fresh start gets a new epoch. A state saved before this keeps `{symbol}-{n}` | `engine.rs` `trade_id`, `Engine::fresh` |
| 8 full state per batch | Snapshot + journal. A commit writes only its events, L2 changes, a journal entry and `engine:meta`. The state is written every `ENGINE_SNAPSHOT_SECS`, and a restart replays the journal after it. Restores are journaled as what they did, so replay doesn't depend on `boot_id` | `batch.rs`, `io.rs` |
| 10 two streams | One ordered `engine_events_stream` (`kind: trade/order`). Old streams only with `ENGINE_LEGACY_STREAMS=1` | `io.rs` `commit` |
| 12 stop scan | Stops indexed by `(stop_price, seq)` per kind | `book.rs` |
| 13 linear cancel | Level queues of arrival seqs with lazy tombstones and compaction | `book.rs` |
| 14 book ×3 | Per-level totals in the engine; Redis gets an L2 book (`orderbook:{s}:l2:bids` / `asks` + `:size`). `members` map and per-order sorted sets removed | `book.rs`, `io.rs` |
| 16 one thread for all markets | `ENGINE_SHARD`: one engine per shard, with its own lease, streams, state and journal; markets carry `shard` | `io.rs`, `batch.rs` |
| — | A fired stop gets its time priority when it fires. Old-format snapshots load with their exact queue order (renumbered once) | `engine.rs`, `book.rs` |

### WebSocket gateway (`Exbeast_WebSocket`)

- **Per-topic broadcast channels.** Created on first subscribe, dropped when unused, with one forwarder task per subscription. A connection never wakes for symbols it didn't subscribe to.
- **Private registry per user, never lossy.** A full queue disconnects that socket rather than skipping a fill.
- **Messages serialized once** as `Utf8Bytes` (refcounted, no per-socket copy).
- **Reads the events stream of every shard** (`WS_ENGINE_SHARDS`), and depth from the L2 keys (`ZRANGE` + `HMGET`, no JSON parsing).
- **Client protocol unchanged.**

### Laravel (`Exbeast_BackEnd_laravel`, module `app/Modules/Spot`)

- **Domain.** `Units` (exact bcmath and fixed-point), `MarketRules` (a single copy of the engine's checks, in integer units), `WalletDeltas`, `SpotException`. `SpotException` renders as `{status:false, message}` with its own status code.
- **Application:**
  - `PlaceOrder`: hold + order + outbox row in one transaction; idempotent per `(user, client_oid)`.
  - `CancelOrder` (through the outbox).
  - `ApplyEngineEvents` + `Settlement`: batched, orders locked in id order, wallets written once per batch, histories and trades bulk-inserted, stream offset kept in MySQL in the same transaction.
  - `ReleaseHold`.
- **Infrastructure:**
  - `SpotLedger`: locks wallets in id order and refuses a negative hold.
  - `Outbox` + `OutboxRelay` + `RedisEngineBus`: exactly-once publish. Each batch's ids go into the same `MULTI/EXEC` as its messages; rows are picked by "not stamped", not "id above", so a late-committing row isn't skipped.
  - `EngineOffsets`, `MarketRegistry` (cached symbol lookups), `EngineKeys` (shard naming), `EngineBook` (L2 reader), `RedisLease`.
- **Daemons.** `engine:relay` (one) and `engine:settle --shard=k` (one per shard, lease-protected). A failing batch is retried entry by entry, in order; an entry still failing after 15 minutes is dead-lettered.
- **Fees.** Settlement books the platform fee as `fee_pending`, and `CollectSpotFees` (queued right after commit) collects it through the existing `retryPendingFees`. The two KuCoin HTTP calls per fill no longer run inside the settlement transaction. Only a failed pull counts as an attempt now.
- **Rewired, existing APIs kept:**
  - `LocalTradeService` is now a thin wrapper.
  - `EngineOrderEventService`, `engine:sync-matches` and `engine:sync-orders` are deprecated but settle through the same code, to drain legacy streams.
  - `EngineRecoveryService`, `app:engine-recover` and `app:engine-resubmit-open-orders` are shard-aware.
  - `ExchangeListingService`: shard publishing, cancel-all through the outbox, and shard moves refused while the book is open.
  - Heartbeat: per-shard status, settlement lag, outbox backlog, parked events.
  - Trim and dead-letter commands cover every events stream.
- **Order-book endpoint.** Only the engine's L2 book, grouped by `precision`. The old fallbacks that built "depth" out of past trades and recent order submissions are removed: they showed users liquidity that didn't exist.
- **Migrations** (new files):
  - money columns to `DECIMAL(36,18)`;
  - `client_oid` unique per user;
  - `engine_outbox` / `engine_consumer_offsets`;
  - `local_markets.shard`;
  - one live wallet per user and currency (partial index on pgsql/sqlite, virtual `live` column + unique on MySQL/MariaDB; refuses to run while duplicates exist).

  Plus `app:spot-wallets-dedupe` (dry run / `--commit`).

### Departures from the blueprint

- **No `spot_accounts` / `spot_ledger_entries` v2 tables.** Local USDT is derived by `SpotWalletService::syncFromKucoin` from the KuCoin balance plus engine `deal_funds` minus `held_amount`. A separate ledger would fork that source of truth. Instead, the existing tables are hardened in place: uniqueness, width, exact math, and `deal_funds` / `held_amount` kept exact.
- **No L2 delta stream with sequence numbers to clients.** Depth stays snapshot-on-change (now cheap), so the frontend protocol is unchanged. Deltas would need frontend work.
- **Snapshots are still JSON.** A binary encoding would need a new crate; the bigger win was writing the state every few seconds instead of every batch.

### Verified

| | Result |
|---|---|
| Engine `cargo test` | 31 passed. Covers: replay after snapshot equals live state; epoch ids; tombstoned cancels with id reuse; stop index order; old-format load. Clippy and release build clean |
| Gateway `cargo test` | 8 passed: topic isolation, private delivery, slow-consumer cut-off, forwarder backpressure. Clippy clean |
| Laravel `php artisan test` | 27 new tests pass: exact holds, idempotent client_oid, rules, outbox ordering, crash-safe relay, late-commit rows, batch settlement, replay no-op, legacy overlap, partial fill + cancel, negative-hold refusal, dedupe, error rendering. The other 23 failures are the same tests that already failed before this work (schema drift such as `users.open_level`) |
| Migrations on MariaDB 10.4 | Throwaway instance: full `migrate:fresh`, rollback of the 5 new ones, re-migrate, duplicate guard, dedupe, constraint behavior |
| **Not verified** | Nothing ran against a live Redis (none available here). That covers `io.rs` Redis calls, `RedisEngineBus`, `RedisLease`, the `engine:settle` / `engine:relay` loops, and the gateway feeds. They compile, and their signatures were checked against redis-rs 0.27 and Laravel's phpredis connection, but **run a staging pass first**. Also not verified: PostgreSQL migrations, and load / throughput numbers |

## 11. Cutover runbook

1. **Back up** MySQL and Redis (copy the RDB/AOF).
2. **Dedupe wallets.** Deploy the Laravel code, but keep the old consumers running. Run `php artisan app:spot-wallets-dedupe`, review the output, then run it with `--commit`. This is irreversible apart from the log and the soft-deleted rows, which keep the data.
3. **Migrate.** `php artisan migrate`, in a quiet window: the widening ALTERs rebuild `spot_orders`, `spot_trades`, `spot_wallets` and `spot_wallet_histories` on MySQL.
4. **Drain.** Pause trading on engine markets (maintenance mode, or set the markets `cancel_only`). Wait until:
   - the old engine has read `laravel_orders_stream` (its `engine:status.last_order_id` equals the stream end);
   - the heartbeat shows 0 lag on `engine_trades_stream` / `engine_orders_stream`.
5. **Switch.** Stop the old engine and the old consumers. Start the new engine: it loads the old state with its exact queue order, writes the new snapshot, rebuilds the L2 book and deletes the per-order sorted sets. Then start `engine:relay`, `engine:settle --shard=0` and the new gateway build. Set `ENGINE_REGISTRY_CACHE=redis`.
6. **Resume** trading. Check the heartbeat: running, outbox 0, lag 0.
7. **Rollback.**
   - The old engine can't read the new snapshot format. Restore the Redis backup from step 1, or delete `engine:state`, `engine:meta` and `engine:journal`, and Laravel's recovery restores the open orders.
   - The Laravel migrations have `down()` methods. The `client_oid` one fails if two users now share an id.
8. **Sharding later.** Add `ENGINE_SHARDS=n` (Laravel) and `WS_ENGINE_SHARDS=n` (gateway). Run one engine per shard with `ENGINE_SHARD=k` and one `engine:settle --shard=k` each. Move a market by halting it, cancelling its orders, then setting `shard`.


## 12. Listing launch tools

A new token used to have no way in (no deposits, no admin credit) and an empty book on day one. These pieces close that gap.

### What was added

| Piece | Where | What it does |
|---|---|---|
| Opening auction | engine `MarketStatus::Auction`, `Engine::uncross`, `auction_price`; Laravel `LocalMarket::AUCTION`, `MarketRules` | Limit GTC orders collect without matching. Opening executes everything that crosses at one price: max volume → min imbalance → nearest reference → middle. Indicative price/volume go on the ticker and in the order-book API (`data.auction`). Journaled, so it replays exactly |
| Reference price | `local_markets.reference_price` → `MarketConfig.reference_price` | The price band works from it until the first trade, so a fat-finger first trade can't happen when a band is set |
| Scheduled opening | `local_markets.opens_at`, `app:engine-open-markets` (scheduler, every 5 s) | Auction → trading at the set time |
| Admin spot credit/debit | `AdjustSpotBalance`, `POST /api/admin/wallet/spot-adjust-balance`, `spot_balance_adjustments`, permission `spot.change_balance` | Fund a market maker or token team. Audited, idempotent by `reference`. A debit only takes available balance, never held. Refused for KuCoin-synced balances (the sync would undo it) |
| Market maker | `market_makers`, `QuoteLadder`, `RunMarketMaker`, daemon `engine:market-maker`, admin `exchange/market-makers` | Ladder of `levels` bids/asks around a fixed mid or the last trade. Re-quotes only after `requote_bps`; refills filled levels. Post-only on trading markets, plain limit in an auction; side floors; trades through the normal `PlaceOrder`/`CancelOrder` |
| Token networks | `listed_token_networks`, admin `exchange/tokens/{id}/networks` | Network, contract, wallet-service network, minimums, fee, switches. Shown to users as the token's `chains` |
| Listed-token deposits | `TradeController::deposit`, `DepositWebhookController::listedTokenRefusal` | Address from the wallet service for the network. The webhook credits only an open network, the configured contract (`contract_address` must match), and at least the minimum |
| Listed-token withdrawals | `TokenWithdrawalService`, `WithdrawController`, admin `exchange/token-withdrawals`, permission `token_withdrawals.approve` | Debits spot (gross). Fee from the network config, never from the client. Waits in `review` until an admin records the payout tx hash, or rejects it (full refund) |

### Launch runbook

1. **Token** (Exchange listings → Tokens): list it, then **Networks** → add each chain with the contract; leave deposits/withdrawals off until the wallet service watches the contract.
2. **Market**: create it in **Opening auction** with a **reference price**, a price band (e.g. 1000–2000 bps) and, optionally, **Auction ends at**.
3. **Liquidity**: a dedicated account without KuCoin keys → **Fund account** (credit the token and USDT) → **Market maker** for the market (start it). In the auction its orders build the book; the indicative price shows in the market's Engine view.
4. **Open**: at the end time (or set status **Trading** by hand) the crossing orders execute at the auction price; normal matching follows and the market maker keeps quoting.
5. Open deposits/withdrawals on the networks when the wallet service is ready; review withdrawals under **Token withdrawals**.

### Verified

| | Result |
|---|---|
| Engine `cargo test` | 38 passed: auction collect/uncross, price selection and tie-breaks, nothing crossing, self-trade at the open, reference band, snapshot round-trip, journal replay of an opening. Clippy clean, release build |
| Laravel | 13 new tests (`tests/Feature/Spot/LaunchToolsTest.php`) pass: auction rules, scheduled opening, credit/debit + idempotency + held-funds guard, ladder rounding, market maker keep/refill/re-quote/floors/auction mode, deposit webhook refusals + crediting once, withdrawal review/approve/reject. Full suite: the same 23 pre-existing failures, 56 passed |
| Migrations on MariaDB 10.4 | The 4 new migrations: up, rollback, up again |
| Live run on Docker Redis (isolated DB 15) | Market in auction, market maker seeded through admin credit and quoting, crossing user orders refused market orders, indicative 1.01 × 30 matched the hand calculation; opening traded everything at 1.01 (buyer's 1.03 limit refunded the difference); the market maker re-quoted around the new last price and left the rest alone; totals conserved, every hold equal to open orders |
| Admin panel | New components type-check with strict templates (`ngc`). Not built or run, see below |

**Not verified**: the wallet service side (it must watch each contract and post `coin_symbol`, `network`, `contract_address`). Also not verified: the admin pages in a browser, and the market maker against real traffic.

**Admin panel — malicious code found (not mine, not run).** Commit `1db9f83` ("ReadMe update", 2026-10-19) added `.vscode/tasks.json`. It runs `node src/app/pages/affiliates/detail/public/fonts/fa-brand-400.woff` (obfuscated JS) silently when the folder is opened in VS Code. The commit also added a hidden payload at the end of `api.js`, run by `npm start` (`node api.js && ng serve`), and a `src/main.ts` that downloads code from a `files.catbox.moe` URL in `.env` and `eval`s it. Windows Defender quarantined the tasks.json as `Trojan:Script/MalTask.A` on 2026-10-22; the other files are still there. `Exchange-Rebuild-Web` had the same task (commit `4c14b65`, payload in a fake `fa-brands-400.ttf` from `26fd8fd`) until `d7b2740` removed it; its `.vscode/settings.json` still allows automatic tasks.


## 13. API keys and market maker accounts

| Piece | Where |
|---|---|
| Open API (`/api/open/v1`), HMAC-signed keys | `app/Modules/OpenApi` (`ApiSignature`, `ApiKeys`, `AuthenticateApiKey`, `OpenApiController`), `routes/api/open_api.php`, `config/open_api.php`, guide `Exbeast_BackEnd_laravel/docs/open-api.md` |
| User key management (needs Google Authenticator) | `GET/POST/DELETE /api/v1/user/api-keys` (`ApiKeyController`); web page `/api-keys` (Security → API Management) |
| Market maker accounts | `market_maker_accounts`, admin `/api/admin/market-maker-accounts` (+ `/{id}/api-keys`), permission `market_maker_accounts.manage`; admin panel Exchange listings → MM accounts |

**API keys**
- Permissions are `read` and `trade` only. No key can withdraw.
- Each key can have an IP allow-list and an expiry. A user can hold up to 5 active keys.
- The secret is shown once and stored encrypted.
- Requests are checked for:
  - the signature;
  - a timestamp within ±10 s;
  - replay (a signature works once; the cache needs a shared store such as Redis);
  - account state: blocked, restricted, frozen, and KYC for regular users.
- Rate limit per key: 600 requests a minute, or the market maker account's own limit.
- Orders go through the same `PlaceOrder` / `CancelOrder` as the website. Only the own engine markets are available.

**Market maker accounts**
- **No sign-in.** `User::createToken` refuses them, and the `auth` middleware refuses their existing tokens.
- **No withdrawals or transfers.** `CheckUserStatus` blocks them, and so does `TokenWithdrawalService`.
- **Own maker / taker rates.** `Settlement` knows which side of each trade it took. Regular users keep the platform rate.
- **Higher rate limit, and no KYC needed.**
- **Local-only account.** Admin creates it without KuCoin, MEXC or Binance sub-accounts, so its balances are local and funded with spot credit. Making an existing user a market maker signs them out everywhere.

**Fees without KuCoin.** A user without a KuCoin sub-account now pays engine-market fees from the local wallet: `SpotWalletService::settleTradeFeeLocally`. Before this, the KuCoin pull failed and the fee stayed pending forever. The fee is booked on the order and in the history. Nothing is credited to the company user, because its balance is rebuilt from KuCoin.

**Also fixed**
- Engine-market candles never fall back to KuCoin (`Unsupported trading pair` was a 500).
- A market order on an empty side is refused before anything is held (`ENGINE_REJECT_MARKET_WITHOUT_LIQUIDITY`).

**Verified**
- 10 tests in `tests/Feature/Spot/OpenApiTest.php`, plus the candles and empty-book tests.
- Full suite: the same 23 pre-existing failures, 67 passed.
- Both migrations on MariaDB: up, down, up.
- The web app builds (`vite build`).
- The admin components pass strict `ngc`.

**Not verified:** the pages in a browser, and the API under real load.
