/**
 * SSI FastConnect v3 integration units — date parsing, stream ingestion
 * reducer, and RSA-XML order signing.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import { parseFcDate, fcDay, fcDayTime, fcNum, FC_INDEX_CANONICAL } from "../providers/ssi-fastconnect";
import { parseSsiXmlPrivateKey, signSsiPayload } from "../providers/ssi-trading";
import { createFcStreamData, fcStreamIngest } from "../realtime/ssi-fc-stream";

/* ------------------------------ date parsing ------------------------------ */

test("parseFcDate: daily YYYY/MM/DD → VN end-of-session timestamp", () => {
  const t = parseFcDate("2026/09/10", true);
  assert.equal(t, Date.parse("2026-09-10T15:00:00+07:00"));
});

test("parseFcDate: intraday YYYY/MM/DD HH:mm:ss → +07 instant", () => {
  const t = parseFcDate("2026/09/10 09:15:32");
  assert.equal(t, Date.parse("2026-09-10T09:15:32+07:00"));
});

test("parseFcDate: tolerates legacy dd/MM/yyyy", () => {
  const t = parseFcDate("10/09/2026");
  assert.equal(t, Date.parse("2026-09-10T15:00:00+07:00"));
});

test("parseFcDate: invalid → null", () => {
  assert.equal(parseFcDate(""), null);
  assert.equal(parseFcDate(null), null);
  assert.equal(parseFcDate("not-a-date"), null);
});

test("fcDay / fcDayTime produce VN-local strings", () => {
  const at = new Date("2026-09-10T17:30:00Z"); // = 2026-09-11 00:30 +07
  assert.equal(fcDay(at), "2026/09/11");
  assert.match(fcDayTime(at), /^2026\/09\/11 00:30:00$/);
});

test("fcNum parses stringified numbers with commas", () => {
  assert.equal(fcNum("1,234.5"), 1234.5);
  assert.equal(fcNum("45.30"), 45.3);
  assert.equal(fcNum(""), null);
  assert.equal(fcNum(null), null);
});

test("FC_INDEX_CANONICAL maps SSI codes to platform codes", () => {
  assert.equal(FC_INDEX_CANONICAL.HNXINDEX, "HNX");
  assert.equal(FC_INDEX_CANONICAL.UPCOMINDEX, "UPCOM");
  assert.equal(FC_INDEX_CANONICAL.VN30, "VN30");
});

/* --------------------------- stream ingestion ----------------------------- */

test("fcStreamIngest: market bands + trade tick → quote with change vs ref", () => {
  const state = createFcStreamData();
  const now = Date.now();

  // market.<board> seeds ceiling/floor/ref for SSI
  fcStreamIngest(state, {
    channel: "DATA",
    topic: "market.hose",
    data: { s: "SSI", b: "HOSE", t: "2026/09/10", ce: "48.50", fl: "42.10", ref: "45.30" },
  }, now);
  assert.deepEqual(state.marketInfo.get("SSI"), { ceiling: 48.5, floor: 42.1, ref: 45.3, board: "HOSE" });

  // trade tick applies price + computed change
  const r = fcStreamIngest(state, {
    channel: "DATA",
    topic: "trade.SSI",
    data: { s: "SSI", t: "2026/09/10 09:15:32", p: "45.50", q: "1000", a: "45.35", si: "B", o: "45.00", h: "45.80", l: "44.90", v: "1250000" },
  }, now + 1);
  assert.equal(r?.kind, "trade");
  const q = state.quotes.get("SSI");
  assert.ok(q);
  assert.equal(q.price, 45.5);
  assert.equal(q.open, 45.0);
  assert.equal(q.high, 45.8);
  assert.equal(q.low, 44.9);
  assert.equal(q.volume, 1250000);
  assert.equal(q.ref, 45.3);
  assert.ok(Math.abs((q.change ?? 0) - 0.2) < 1e-9);
  assert.ok(Math.abs((q.changePercent ?? 0) - (0.2 / 45.3) * 100) < 1e-9);
});

test("fcStreamIngest: quote message stores best bid/ask", () => {
  const state = createFcStreamData();
  const now = Date.now();
  fcStreamIngest(state, {
    channel: "DATA",
    topic: "quote.SSI",
    data: {
      s: "SSI",
      t: "2026/09/10 09:15:32",
      bids: [["45.45", "3200"], ["45.40", "1500"]],
      asks: [["45.50", "2800"], ["45.55", "1900"]],
    },
  }, now);
  const q = state.quotes.get("SSI");
  assert.ok(q);
  assert.equal(q.bid, 45.45);
  assert.equal(q.ask, 45.5);
});

test("fcStreamIngest: index stream uses seeded prevClose for change", () => {
  const state = createFcStreamData();
  const now = Date.now();
  state.indexRefs.set("VNINDEX", { prevClose: 1600, name: "VN-Index" });

  fcStreamIngest(state, {
    channel: "DATA",
    topic: "trade.VNINDEX",
    data: { s: "VNINDEX", t: "2026/09/10 09:15:32", p: "1605.5", v: "12000000" },
  }, now);
  const idx = state.indices.get("VNINDEX");
  assert.ok(idx);
  assert.equal(idx.value, 1605.5);
  assert.ok(Math.abs((idx.change ?? 0) - 5.5) < 1e-9);
  assert.ok(Math.abs((idx.changePercent ?? 0) - (5.5 / 1600) * 100) < 1e-9);
});

test("fcStreamIngest: session flag captured per board", () => {
  const state = createFcStreamData();
  const now = Date.now();
  fcStreamIngest(state, { channel: "DATA", topic: "market.hose", data: { b: "HOSE", t: "2026/09/10 09:00:00", f: "ATO" } }, now);
  assert.deepEqual(state.marketFlags.get("HOSE"), { flag: "ATO", at: now });
});

test("fcStreamIngest: interval topic (trade.SSI@1m) updates price from close", () => {
  const state = createFcStreamData();
  const now = Date.now();
  const r = fcStreamIngest(state, {
    channel: "DATA",
    topic: "trade.SSI@1m",
    data: { st: "2026/09/10 09:15:00", t: "2026/09/10 09:16:00", s: "SSI", o: "45.4", h: "45.6", l: "45.3", c: "45.55", v: "8000" },
  }, now);
  assert.equal(r?.kind, "interval");
  assert.equal(state.quotes.get("SSI")?.price, 45.55);
});

test("fcStreamIngest: non-DATA/TRADING channels ignored", () => {
  const state = createFcStreamData();
  const r = fcStreamIngest(state, { channel: "HEARTBEAT", data: {} }, Date.now());
  assert.equal(r, null);
});

/* ------------------------------ RSA signing ------------------------------ */

function makeSsiXmlKey(): { xmlB64: string; publicKey: crypto.KeyObject } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = privateKey.export({ format: "jwk" });
  const std = (u?: string) => Buffer.from(u ?? "", "base64url").toString("base64");
  const xml =
    `<RSAKeyValue>` +
    `<Modulus>${std(jwk.n)}</Modulus>` +
    `<Exponent>${std(jwk.e)}</Exponent>` +
    `<P>${std(jwk.p)}</P>` +
    `<Q>${std(jwk.q)}</Q>` +
    `<DP>${std(jwk.dp)}</DP>` +
    `<DQ>${std(jwk.dq)}</DQ>` +
    `<InverseQ>${std(jwk.qi)}</InverseQ>` +
    `<D>${std(jwk.d)}</D>` +
    `</RSAKeyValue>`;
  return { xmlB64: Buffer.from(xml, "utf8").toString("base64"), publicKey };
}

test("parseSsiXmlPrivateKey + signSsiPayload: signature verifies against public key", () => {
  const { xmlB64, publicKey } = makeSsiXmlKey();
  const body = JSON.stringify({ accountNo: "1234561", symbol: "SSI", side: "B", orderType: "LO", quantity: 100, price: "45000" });
  const sigHex = signSsiPayload(body, xmlB64);
  assert.match(sigHex, /^[0-9a-f]{512}$/); // 2048-bit → 256 bytes hex
  const ok = crypto.verify("sha256", Buffer.from(body, "utf8"), publicKey, Buffer.from(sigHex, "hex"));
  assert.equal(ok, true);
});

test("parseSsiXmlPrivateKey: rejects malformed keys", () => {
  assert.throws(() => parseSsiXmlPrivateKey("!!!not-base64!!!"));
  assert.throws(() => parseSsiXmlPrivateKey(Buffer.from("<nothing/>").toString("base64")));
});

test("signSsiPayload: same body + same key is deterministic (PKCS#1 v1.5)", () => {
  const { xmlB64 } = makeSsiXmlKey();
  const body = '{"accountNo":"1234561"}';
  assert.equal(signSsiPayload(body, xmlB64), signSsiPayload(body, xmlB64));
});
