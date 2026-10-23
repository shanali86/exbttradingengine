// The orders the bot wants on the book, in engine units (BigInt).
import { absDiff, ceilTo, floorTo, notional, scale } from './units.js';

/**
 * `levels` bids below and asks above `mid`: the innermost spreadBps/2 away,
 * each further one stepBps more. Prices are rounded away from the mid onto
 * the tick, the size down onto the lot. A level is left out when it breaks
 * the market's limits: min / max size, min order value, or the price band
 * (|price - bandRef| <= bandBps of bandRef, when both are set).
 *
 * @returns {{side: 'buy'|'sell', price: bigint, size: bigint}[]} and `skipped` reasons
 */
export function buildLadder({ mid, size, spreadBps, stepBps, levels, rules, bandRef = 0n }) {
  const out = [];
  const skipped = [];
  const lotSize = floorTo(size, rules.lot);
  if (mid <= 0n || lotSize <= 0n) return { orders: out, skipped: ['no mid price or size'] };
  if (lotSize < rules.minSize) return { orders: out, skipped: ['order size is below the market minimum'] };
  if (rules.maxSize > 0n && lotSize > rules.maxSize) return { orders: out, skipped: [`order size is above the market maximum`] };

  const seen = new Set();
  for (let i = 0; i < levels; i++) {
    const away = spreadBps * 50 + i * stepBps * 100; // millionths of the mid
    const bid = floorTo(scale(mid, -away), rules.tick);
    const ask = ceilTo(scale(mid, away), rules.tick);
    for (const [side, price] of [['buy', bid], ['sell', ask]]) {
      const key = `${side}|${price}`;
      if (price <= 0n || seen.has(key) || (side === 'buy' ? price >= mid : price <= mid)) continue;
      if (notional(price, lotSize) < rules.minFunds) { skipped.push(`${side} ${price}: below the minimum order value`); continue; }
      if (rules.bandBps > 0n && bandRef > 0n && absDiff(price, bandRef) * 10_000n > bandRef * rules.bandBps) {
        skipped.push(`${side} level ${i + 1}: outside the market's ${Number(rules.bandBps) / 100}% price band`);
        continue;
      }
      seen.add(key);
      out.push({ side, price, size: lotSize });
    }
  }
  return { orders: out, skipped };
}
