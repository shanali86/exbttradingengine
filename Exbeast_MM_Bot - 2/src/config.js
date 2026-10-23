// Settings from the environment (.env next to package.json; see .env.example).
import { toUnits } from './units.js';

const num = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
const str = (name, def = '') => (process.env[name] ?? def).trim();

export function loadConfig(argv = process.argv.slice(2)) {
  const c = {
    baseUrl: str('EXBEAST_API_URL', 'https://newapi.thinkoworkspace.com'),
    key: str('EXBEAST_API_KEY'),
    secret: str('EXBEAST_API_SECRET'),
    symbol: str('MM_SYMBOL', 'EXBT-USDT').toUpperCase(),
    // fixed: around MM_MID_PRICE; last: around the last trade (MM_MID_PRICE, then the
    // market's reference price, until there is one); book: middle of the best bid / ask.
    midSource: str('MM_MID_SOURCE', 'last').toLowerCase(),
    midPrice: toUnits(str('MM_MID_PRICE', '0')),
    spreadBps: num('MM_SPREAD_BPS', 100),
    stepBps: num('MM_STEP_BPS', 50),
    levels: num('MM_LEVELS', 5),
    orderSize: toUnits(str('MM_ORDER_SIZE', '0')),
    requoteBps: num('MM_REQUOTE_BPS', 25),
    refreshMs: num('MM_REFRESH_MS', 5000),
    // Keep at least this much free (base / quote); 0 = use everything.
    minBase: toUnits(str('MM_MIN_BASE_BALANCE', '0')),
    minQuote: toUnits(str('MM_MIN_QUOTE_BALANCE', '0')),
    cancelOnExit: str('MM_CANCEL_ON_EXIT', 'true') !== 'false',
    dryRun: argv.includes('--dry-run') || str('MM_DRY_RUN', 'false') === 'true',
    checkOnly: argv.includes('--check'),
  };

  const errors = [];
  if (!c.key || !c.secret) errors.push('EXBEAST_API_KEY and EXBEAST_API_SECRET are required');
  if (!['fixed', 'last', 'book'].includes(c.midSource)) errors.push('MM_MID_SOURCE must be fixed, last or book');
  if (c.midSource === 'fixed' && c.midPrice <= 0n) errors.push('MM_MID_PRICE is required with MM_MID_SOURCE=fixed');
  if (!c.checkOnly && c.orderSize <= 0n) errors.push('MM_ORDER_SIZE (base per level) is required');
  if (c.spreadBps < 1 || c.stepBps < 1) errors.push('MM_SPREAD_BPS and MM_STEP_BPS must be at least 1');
  if (c.levels < 1 || c.levels > 50) errors.push('MM_LEVELS must be 1..50');
  if (c.refreshMs < 1000) errors.push('MM_REFRESH_MS must be at least 1000');
  if (errors.length) throw new Error('Bad configuration:\n  - ' + errors.join('\n  - '));

  return c;
}
