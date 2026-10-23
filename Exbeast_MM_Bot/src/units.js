// Exact decimal math in engine units (1.0 = 1e8) with BigInt: no float drift
// in prices or sizes. The exchange works in the same 8-decimal units.

export const SCALE = 100_000_000n;

/** "0.3912" -> 39120000n. Digits past the 8th decimal are dropped. */
export function toUnits(value) {
  const s = String(value ?? '0').trim();
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return 0n;
  const [int, frac = ''] = s.split('.');
  return BigInt(int || '0') * SCALE + BigInt((frac + '00000000').slice(0, 8));
}

/** 39120000n -> "0.3912" */
export function fromUnits(units) {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const frac = (v % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (v / SCALE).toString() + (frac ? '.' + frac : '');
}

/** Quote value of qty base at price, rounded down (the engine's notional). */
export const notional = (price, qty) => (price * qty) / SCALE;

/** value * (1e6 + delta) / 1e6, rounded down; delta in millionths. */
export const scale = (value, millionths) => (value * (1_000_000n + BigInt(millionths))) / 1_000_000n;

export const floorTo = (v, step) => (step > 0n ? (v / step) * step : v);
export const ceilTo = (v, step) => (step > 0n ? ((v + step - 1n) / step) * step : v);
export const absDiff = (a, b) => (a > b ? a - b : b - a);
