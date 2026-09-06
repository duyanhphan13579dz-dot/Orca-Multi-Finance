/**
 * CRYPTO ORDER BOOK (Phase 6) — Binance depth adapter + service.
 * - validation: NaN/negative/zero levels rejected, best-bid ordering
 * - provider fail → service null → route 502 JSON (không fake)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getOrderBook } from "../providers/binance";
import { getCryptoOrderBook } from "../services/crypto-orderbook";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(fn: (url: string) => Response): void {
  const orig = globalThis.fetch;
  (globalThis as { __origFetch?: typeof fetch }).__origFetch = orig;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(fn(url));
  }) as typeof fetch;
}

function restoreFetch(): void {
  const orig = (globalThis as { __origFetch?: typeof fetch }).__origFetch;
  if (orig) globalThis.fetch = orig;
}

test("getOrderBook: normalises + sorts; filters NaN/negative levels", async () => {
  stubFetch(() =>
    jsonResponse({
      lastUpdateId: 12345,
      bids: [
        ["1.0912", "0.5"],
        ["1.0900", "0"],
        ["NaN", "0.3"],
        ["1.0895", "1.2"],
        ["-1", "5"],
      ],
      asks: [
        ["1.0915", "0.25"],
        ["1.0920", "0.75"],
        ["1.0918", "NaN"],
        ["0", "9"],
      ],
    }),
  );
  try {
    const book = await getOrderBook("EURUSDT", 20);
    assert.equal(book.symbol, "EURUSDT");
    assert.equal(book.lastUpdateId, 12345);
    // bids: only 1.0912/0.5 + 1.0895/1.2 remain; best bid first
    assert.deepEqual(
      book.bids.map((b) => b.price),
      [1.0912, 1.0895],
    );
    // asks: only 1.0915/0.25 + 1.0920/0.75; ascending
    assert.deepEqual(
      book.asks.map((a) => a.price),
      [1.0915, 1.092],
    );
  } finally {
    restoreFetch();
  }
});

test("getOrderBook: empty/one-sided depth → ProviderError (không fake)", async () => {
  stubFetch(() => jsonResponse({ lastUpdateId: 1, bids: [], asks: [["1.1", "1"]] }));
  try {
    await assert.rejects(() => getOrderBook("BTCUSDT", 20), /binance/);
  } finally {
    restoreFetch();
  }
});

test("getCryptoOrderBook: provider fail → null (route 502 JSON an toàn)", async () => {
  stubFetch(() => jsonResponse({ error: "down" }, 502));
  try {
    const r = await getCryptoOrderBook("BTCUSDT", 20);
    assert.equal(r, null);
  } finally {
    restoreFetch();
  }
});
