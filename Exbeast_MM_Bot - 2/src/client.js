// Exbeast open API client: HMAC-signed requests (docs/open-api.md in the backend).
//   EX-API-SIGN = base64(HMAC_SHA256(secret, timestamp + METHOD + path + body))
import crypto from 'node:crypto';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(`${status}: ${message}`);
    this.status = status;
    this.body = body;
  }
}

export class ExbeastClient {
  constructor({ baseUrl, key, secret, timeoutMs = 10_000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.key = key;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
    /** server time - local time, ms (EX-API-TIMESTAMP must be within the server's window). */
    this.clockOffset = 0;
  }

  async syncTime() {
    const t0 = Date.now();
    const r = await this.request('GET', '/api/open/v1/time', null, false);
    const t1 = Date.now();
    this.clockOffset = Number(r.serverTime) - Math.round((t0 + t1) / 2);
    return this.clockOffset;
  }

  // ---- public market data ----
  symbol(symbol) {
    return this.request('GET', `/api/v1/market/symbol/${encodeURIComponent(symbol)}`, null, false);
  }

  /** {last, high, low, volume, changeRate} of the market (last = 0 before its first trade). */
  ticker(symbol) {
    return this.request('GET', `/api/v1/market/ticker/${encodeURIComponent(symbol)}`, null, false);
  }

  async book(symbol, depth = 20) {
    const r = await this.request('GET', `/api/v1/user/trading-account/order/book?symbol=${encodeURIComponent(symbol)}&depth=${depth}`, null, false);
    return r?.data ?? { bids: [], asks: [] };
  }

  // ---- signed ----
  balances() { return this.request('GET', '/api/open/v1/account/balances'); }
  openOrders(symbol) { return this.request('GET', `/api/open/v1/orders?symbol=${encodeURIComponent(symbol)}&status=active&limit=500`); }
  fills(symbol, limit = 1) { return this.request('GET', `/api/open/v1/fills?symbol=${encodeURIComponent(symbol)}&limit=${limit}`); }
  placeBatch(orders) { return this.request('POST', '/api/open/v1/orders/batch', { orders }); }
  cancel(orderId) { return this.request('DELETE', `/api/open/v1/orders/${encodeURIComponent(orderId)}`); }
  cancelAll(symbol) { return this.request('DELETE', `/api/open/v1/orders?symbol=${encodeURIComponent(symbol)}`); }

  /** Returns `data` of the {status, message, data} envelope; throws ApiError otherwise. */
  async request(method, path, body = null, signed = true) {
    const content = body === null ? '' : JSON.stringify(body);
    const headers = { Accept: 'application/json' };
    if (content) headers['Content-Type'] = 'application/json';
    if (signed) {
      const ts = String(Date.now() + this.clockOffset);
      headers['EX-API-KEY'] = this.key;
      headers['EX-API-TIMESTAMP'] = ts;
      headers['EX-API-SIGN'] = crypto.createHmac('sha256', this.secret).update(ts + method + path + content).digest('base64');
    }
    const res = await fetch(this.baseUrl + path, { method, headers, body: content || undefined, signal: AbortSignal.timeout(this.timeoutMs) });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || json?.status === false) {
      throw new ApiError(res.status, json?.message ?? res.statusText, json);
    }
    return json?.data;
  }
}
