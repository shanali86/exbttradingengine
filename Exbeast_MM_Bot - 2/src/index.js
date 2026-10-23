// exbeast-mm-bot: keeps a ladder of buy and sell orders around a mid price
// on one Exbeast engine market, from a market maker account's API key.
//
//   npm run check     connectivity, key, balances and market rules; changes nothing
//   npm run dry-run   prints what it would place / cancel each round; changes nothing
//   npm start         runs (Ctrl+C / SIGTERM cancels its orders, unless MM_CANCEL_ON_EXIT=false)
import { ApiError, ExbeastClient } from './client.js';
import { loadConfig } from './config.js';
import { buildLadder } from './ladder.js';
import { absDiff, fromUnits, notional, toUnits } from './units.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BATCH = 20;

const cfg = loadConfig();
const api = new ExbeastClient({ baseUrl: cfg.baseUrl, key: cfg.key, secret: cfg.secret });
let stopping = false;
let quotedMid = 0n;

/** Market rules in units, from the public symbol endpoint. */
async function marketRules() {
  const s = await api.symbol(cfg.symbol);
  if (!s?.engine) throw new Error(`${cfg.symbol} is not an engine market`);
  const minSize = s.baseMinSize ? toUnits(s.baseMinSize) : 0n;
  const max = String(s.baseMaxSize ?? '0');
  return {
    status: s.status,
    base: s.baseCurrency,
    quote: s.quoteCurrency,
    tick: toUnits(s.priceIncrement),
    lot: toUnits(s.baseIncrement),
    minSize,
    maxSize: max === '1000000000' ? 0n : toUnits(max),
    minFunds: toUnits(s.minFunds ?? '0'),
    bandBps: s.priceLimitRate ? BigInt(Math.round(Number(s.priceLimitRate) * 10_000)) : 0n,
    reference: s.referencePrice ? toUnits(s.referencePrice) : 0n,
  };
}

/** The market's last trade price (0 before the first one), from the public ticker. */
async function lastTradePrice() {
  const t = await api.ticker(cfg.symbol);
  // The ticker sends a JS number; String() keeps up to its 8 decimals.
  return t?.last ? toUnits(Number(t.last).toFixed(8)) : 0n;
}

async function midPrice(rules, book) {
  const best = (side) => (book[side]?.[0]?.[0] ? toUnits(book[side][0][0]) : 0n);
  if (cfg.midSource === 'book') {
    const [bid, ask] = [best('bids'), best('asks')];
    if (bid > 0n && ask > 0n) return (bid + ask) / 2n;
  }
  if (cfg.midSource === 'last') {
    const last = await lastTradePrice();
    if (last > 0n) return last;
  }
  return cfg.midPrice > 0n ? cfg.midPrice : rules.reference;
}

async function round() {
  const rules = await marketRules();
  if (!['trading', 'post_only', 'auction'].includes(rules.status)) {
    log(`${cfg.symbol} is ${rules.status}: not quoting`);
    return;
  }
  const [book, open, balances] = await Promise.all([api.book(cfg.symbol), api.openOrders(cfg.symbol), api.balances()]);
  const mid = await midPrice(rules, book);
  if (mid <= 0n) {
    log('no mid price: set MM_MID_PRICE or the market reference price');
    return;
  }
  // Re-centre only after a real move, so resting orders keep their queue place.
  const requote = quotedMid === 0n || absDiff(mid, quotedMid) * 10_000n >= quotedMid * BigInt(Math.max(1, cfg.requoteBps));
  const center = requote ? mid : quotedMid;
  // The engine bands limit prices around the last trade, or the reference price before one.
  const bandRef = (await lastTradePrice()) || rules.reference;
  const { orders: want, skipped } = buildLadder({
    mid: center, size: cfg.orderSize, spreadBps: cfg.spreadBps, stepBps: cfg.stepBps, levels: cfg.levels, rules, bandRef,
  });

  const wanted = new Map(want.map((o) => [`${o.side}|${o.price}`, o]));
  const keep = new Set();
  const cancels = [];
  for (const o of open ?? []) {
    const key = `${o.side}|${toUnits(o.price)}`;
    if (wanted.has(key) && !keep.has(key)) keep.add(key);
    else cancels.push(o);
  }

  const free = new Map((balances ?? []).map((b) => [b.currency, toUnits(b.available)]));
  let quoteLeft = (free.get(rules.quote) ?? 0n) - cfg.minQuote;
  let baseLeft = (free.get(rules.base) ?? 0n) - cfg.minBase;
  const places = [];
  const short = new Set();
  for (const [key, o] of wanted) {
    if (keep.has(key)) continue;
    const cost = o.side === 'buy' ? notional(o.price, o.size) : o.size;
    if ((o.side === 'buy' ? quoteLeft : baseLeft) < cost) { short.add(o.side === 'buy' ? rules.quote : rules.base); continue; }
    if (o.side === 'buy') quoteLeft -= cost; else baseLeft -= cost;
    places.push({
      symbol: cfg.symbol, side: o.side, type: 'limit', price: fromUnits(o.price), size: fromUnits(o.size),
      // Post-only adds liquidity, never takes it; an opening auction accepts plain limit orders only.
      postOnly: rules.status !== 'auction', clientOid: `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    });
  }

  const summary = `mid ${fromUnits(mid)}${requote ? '' : ` (quoted ${fromUnits(quotedMid)})`} | want ${want.length} | keep ${keep.size} | cancel ${cancels.length} | place ${places.length}`;
  if (skipped.length) log('skipped:', [...new Set(skipped)].join('; '));
  if (short.size) log(`not enough ${[...short].join(' / ')} for some levels`);
  if (cfg.dryRun) {
    log('[dry run]', summary);
    for (const o of cancels) log('  would cancel', o.side, o.price, o.size, o.orderId);
    for (const o of places) log('  would place ', o.side, o.price, o.size);
    quotedMid = center;
    return;
  }
  if (!cancels.length && !places.length) {
    quotedMid = center;
    return;
  }
  log(summary);

  for (const o of cancels) {
    try { await api.cancel(o.orderId); } catch (e) { log('cancel failed', o.orderId, e.message); }
  }
  for (let i = 0; i < places.length; i += BATCH) {
    const results = await api.placeBatch(places.slice(i, i + BATCH));
    for (const r of results ?? []) {
      if (!r.success) log('  refused', places[i + r.index].side, places[i + r.index].price, '-', r.message);
    }
  }
  quotedMid = center;
}

async function check() {
  log(`API ${cfg.baseUrl}, market ${cfg.symbol}`);
  log(`clock offset ${await api.syncTime()} ms`);
  const rules = await marketRules();
  log('market:', { status: rules.status, tick: fromUnits(rules.tick), lot: fromUnits(rules.lot), minSize: fromUnits(rules.minSize),
    maxSize: rules.maxSize ? fromUnits(rules.maxSize) : 'none', minFunds: fromUnits(rules.minFunds),
    priceBand: rules.bandBps ? `${Number(rules.bandBps) / 100}%` : 'off', reference: fromUnits(rules.reference) });
  const last = await lastTradePrice();
  log(`last trade: ${last ? fromUnits(last) : 'none'} (the engine bands limit prices around ${last ? 'it' : 'the reference price'})`);
  const balances = await api.balances();
  log('balances:', (balances ?? []).filter((b) => b.available !== '0' || b.hold !== '0').map((b) => `${b.currency} ${b.available} (+${b.hold} held)`).join(', ') || 'empty');
  const open = await api.openOrders(cfg.symbol);
  log(`open orders on ${cfg.symbol}: ${open?.length ?? 0}`);
  if (rules.bandBps > 0n && rules.bandBps < BigInt(Math.ceil(cfg.spreadBps / 2))) {
    log(`WARNING: the market's price band (${Number(rules.bandBps) / 100}%) is narrower than half the spread (${cfg.spreadBps / 200}%): every level will be outside it. Widen price_band_bps in the admin panel.`);
  }
}

async function main() {
  if (cfg.checkOnly) return check();
  await api.syncTime();
  log(`exbeast-mm-bot on ${cfg.symbol}${cfg.dryRun ? ' (dry run)' : ''}: ${cfg.levels} levels x ${fromUnits(cfg.orderSize)}, spread ${cfg.spreadBps / 100}%, step ${cfg.stepBps / 100}%, mid from ${cfg.midSource}`);
  let failures = 0;
  let lastSync = Date.now();
  while (!stopping) {
    try {
      if (Date.now() - lastSync > 10 * 60_000) { await api.syncTime(); lastSync = Date.now(); }
      await round();
      failures = 0;
    } catch (e) {
      failures++;
      log(`round failed (${failures}):`, e.message);
      if (e instanceof ApiError && e.status === 401) await api.syncTime().catch(() => {});
      if (e instanceof ApiError && e.status === 403) log('the key or account is not allowed to trade; check it in the admin panel');
    }
    await sleep(Math.min(cfg.refreshMs * 2 ** Math.min(failures, 4), 60_000));
  }
}

async function shutdown(signal) {
  if (stopping) process.exit(1);
  stopping = true;
  log(`${signal}: stopping`);
  if (cfg.cancelOnExit && !cfg.dryRun && !cfg.checkOnly) {
    try { await api.cancelAll(cfg.symbol); log('cancel sent for all open orders'); } catch (e) { log('cancel-all failed:', e.message); }
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((e) => { log(e.message); process.exit(1); });
