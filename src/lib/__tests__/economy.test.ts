/** Standalone regression suite; run `npm run test:economy`. Never calls a live provider. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ECONOMIC_DATASETS,
  economicChange,
  economicFrequency,
  filterEconomicIndicators,
  normalizeEconomicText,
  type EconomicDataset,
  type EconomicSnapshot,
} from "../economic-data";
import { ECONOMIC_PROVIDERS, fetchVietnambizEconomy, parseEconomicValue, parseVietnambizEconomy } from "../providers/vietnambiz-economy";
import { ECONOMIC_CACHE_KEYS, ECONOMIC_STALE_MS, ECONOMIC_TTL_MS, economicMeta, getEconomicData } from "../services/economy";
import { invalidate } from "../cache";
import { getProviderHealth } from "../health";
import { GET as macroGET } from "../../app/api/v1/macro-economic/route";
import { GET as currencyGET } from "../../app/api/v1/currency-interest-rate/route";

const macroHtml = readFileSync("test/fixtures/vietnambiz-macro.html", "utf8");
const currencyHtml = readFileSync("test/fixtures/vietnambiz-currency.html", "utf8");
const headers = ["Chỉ tiêu", "Kỳ công bố", "Kỳ hiện tại", "Kỳ trước", "Ngày công bố tiếp theo"];
const cells = ["Tăng trưởng GDP (YoY)", "Quý 2/2026", "8.39%", "7.94%", "Ngày 29 tháng cuối cùng của quý"];
const rowHtml = (values: string[]) => `<tr>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`;
const tableHtml = (rows: string[][], columns = headers) => `<table><thead><tr>${columns.map((name) => `<th>${name}</th>`).join("")}</tr></thead><tbody>${rows.map(rowHtml).join("")}</tbody></table>`;

function snapshot(dataset: EconomicDataset = "macro-economic"): EconomicSnapshot {
  return {
    dataset,
    sourceUrl: ECONOMIC_DATASETS[dataset].sourceUrl,
    fetchedAt: new Date().toISOString(),
    ...parseVietnambizEconomy(dataset === "macro-economic" ? macroHtml : currencyHtml, dataset),
  };
}

async function resetCaches() {
  await Promise.all(Object.values(ECONOMIC_CACHE_KEYS).map(invalidate));
}

test("macro: reads the public SSR table, ignores styles/navigation/measurement rows", () => {
  const result = parseVietnambizEconomy(macroHtml, "macro-economic");
  assert.equal(result.rows.length, 7);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.rows[0].name, "Tăng trưởng GDP (YoY)");
  assert.equal(result.rows[0].period, "Quý 2/2026");
  assert.equal(result.rows[0].nextRelease, "Ngày 29 tháng cuối cùng của quý");
  assert.equal(result.rows[0].frequency, "quarter");
  assert.deepEqual(result.rows[0].current, { text: "8.39%", value: 8.39, isPercent: true });
  assert.equal(result.rows[1].period, "Năm 2023"); // Not overwritten with a recent date.
  assert.equal(result.rows[4].name, "Bán lẻ HH&DV (YoY)");
  assert.equal(result.rows[5].current.value, -113.21);
  assert.equal(result.rows[5].previous.value, -3568.88);
  assert.equal(result.rows[6].current.value, 102345.32);
  assert.ok(result.rows.every((row) => !row.name.includes("padding")));
});

test("currency: keeps daily/monthly periods, policy dates and source units without inventing release dates", () => {
  const result = parseVietnambizEconomy(currencyHtml, "currency-interest-rate");
  assert.equal(result.rows.length, 7);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.rows.every((row) => row.nextRelease === null));
  const centralRate = result.rows.find((row) => row.name === "Tỷ giá trung tâm")!;
  assert.equal(centralRate.frequency, "day");
  assert.equal(centralRate.period, "Ngày 07/09/2026");
  assert.deepEqual(centralRate.current, { text: "25,611", value: 25611, isPercent: false });
  const discount = result.rows.find((row) => row.name === "Lãi suất chiết khấu")!;
  assert.equal(discount.period, "Ngày 03/02/2025");
  assert.equal(discount.current.text, "3"); // Don't add a percent sign the source didn't display.
  assert.equal(result.rows[0].frequency, "month");
});

test("numbers: preserve zero, negative values, decimals, percent and comma grouping", () => {
  for (const [text, value] of [["0", 0], ["0%", 0], ["−3.5%", -3.5], ["-1,078", -1078], ["+2,355.20", 2355.2], ["5.91 %", 5.91]] as const) {
    assert.equal(parseEconomicValue(text).value, value, text);
  }
  for (const text of ["", " ", "—", "N/A", "null", "NaN", "Infinity", "12,34", "1.2.3", "4.5abc", "false", "1e10", "1 2"]) {
    assert.equal(parseEconomicValue(text).value, null, text);
  }
  assert.equal(parseEconomicValue("9".repeat(500)).value, null);
});

test("HTML normalization: encoded Unicode, split percent spans, CSS, SVG and comments", () => {
  const html = tableHtml([[
    "T&#x103;ng tr&#432;&#7903;ng GDP&nbsp; (YoY)", "Quý&nbsp;2/2026",
    '<style>.x{width:99px}</style><span>8.39</span><!-- --> <span>&percnt;</span><svg><title>up</title></svg>',
    "7.94%", "Ngày 29<br/>tháng cuối cùng của quý",
  ]]);
  const result = parseVietnambizEconomy(html, "macro-economic");
  assert.equal(result.rows[0].name, "Tăng trưởng GDP (YoY)");
  assert.equal(result.rows[0].current.value, 8.39);
  assert.equal(result.rows[0].nextRelease, "Ngày 29 tháng cuối cùng của quý");
  assert.doesNotThrow(() => parseVietnambizEconomy(html.replace("GDP", "GDP &#999999999999;"), "macro-economic"));
});

test("columns are selected by their labels, not fixed positions", () => {
  const reordered = [4, 3, 1, 0, 2];
  const html = tableHtml([reordered.map((i) => cells[i])], reordered.map((i) => headers[i]));
  const result = parseVietnambizEconomy(html, "macro-economic");
  assert.equal(result.rows[0].name, cells[0]);
  assert.equal(result.rows[0].current.value, 8.39);
  assert.equal(result.rows[0].previous.value, 7.94);
  assert.equal(result.rows[0].nextRelease, cells[4]);
});

test("duplicate responsive tables dedupe by indicator; conflicting copies are disclosed", () => {
  const one = tableHtml([cells]);
  const same = parseVietnambizEconomy(one + one, "macro-economic");
  assert.equal(same.rows.length, 1);
  assert.deepEqual(same.warnings, []);
  const different = tableHtml([[...cells.slice(0, 2), "99%", ...cells.slice(3)]]);
  const conflict = parseVietnambizEconomy(one + different, "macro-economic");
  assert.equal(conflict.rows[0].current.value, 8.39);
  assert.match(conflict.warnings[0], /không nhất quán/);
});

test("partial data retains missing values as null and discloses malformed rows", () => {
  const result = parseVietnambizEconomy(tableHtml([
    cells,
    ["Chỉ tiêu thiếu số", "Tháng 08/2026", "—", "N/A", ""],
    ["Thiếu kỳ trước", "Tháng 08/2026", "0%", "", ""],
    ["Dòng hỏng", "Tháng 08/2026"],
  ]), "macro-economic");
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[1].current.value, null);
  assert.equal(result.rows[1].previous.value, null);
  assert.equal(result.rows[1].nextRelease, null);
  assert.equal(result.rows[2].current.value, 0);
  assert.equal(economicChange(result.rows[2]), null);
  assert.equal(result.warnings.length, 2);
});

test("empty/invalid pages or a different dataset fail closed, never yield an empty successful board", () => {
  for (const html of ["", "<html>Access denied</html>", tableHtml([]), tableHtml([[...cells.slice(0, 2), "N/A", "—", ""]]), tableHtml([cells], headers.map((h) => h === "Kỳ hiện tại" ? "Unknown" : h))]) {
    assert.throws(() => parseVietnambizEconomy(html, "macro-economic"), /không có dữ liệu hợp lệ/);
  }
  assert.throws(() => parseVietnambizEconomy(currencyHtml, "macro-economic"));
  assert.throws(() => parseVietnambizEconomy(macroHtml, "currency-interest-rate"));
  assert.throws(() => parseVietnambizEconomy(`<script>${tableHtml([cells])}</script>`, "macro-economic"));
  assert.throws(() => parseVietnambizEconomy(`<!-- ${tableHtml([cells])} -->`, "macro-economic"));
});

test("period frequency is classification only, never a fabricated publication timestamp", () => {
  assert.equal(economicFrequency("Ngày 07/09/2026"), "day");
  assert.equal(economicFrequency("Tháng 08/2026"), "month");
  assert.equal(economicFrequency("Quý 2/2026"), "quarter");
  assert.equal(economicFrequency("Năm 2023"), "year");
  assert.equal(economicFrequency("Không cố định"), "other");
});

test("Vietnamese search works without accents, combines with period filters and can return an empty result", () => {
  assert.equal(normalizeEconomicText("  ĐẦU   TƯ  "), "dau tu");
  const macro = snapshot().rows;
  assert.equal(filterEconomicIndicators(macro, "can can thuong mai", "month").length, 1);
  assert.equal(filterEconomicIndicators(macro, "gdp", "year").length, 1);
  assert.equal(filterEconomicIndicators(macro, "gdp", "day").length, 0);
  assert.equal(filterEconomicIndicators(macro, "khong-ton-tai", "all").length, 0);
  assert.equal(filterEconomicIndicators(macro, "", "all").length, 7);
  assert.equal(filterEconomicIndicators(snapshot("currency-interest-rate").rows, "ty gia", "day").length, 2);
});

test("changes use percentage points, not relative percentages; zero and negative previous values are valid", () => {
  const base = snapshot().rows[0];
  assert.deepEqual(economicChange(base), { value: 0.45, isPercentagePoint: true });
  assert.deepEqual(economicChange(snapshot().rows[5]), { value: 3455.67, isPercentagePoint: false });
  assert.deepEqual(economicChange({ ...base, current: parseEconomicValue("0%"), previous: parseEconomicValue("0%") }), { value: 0, isPercentagePoint: true });
  assert.deepEqual(economicChange({ ...base, current: parseEconomicValue("1"), previous: parseEconomicValue("0") }), { value: 1, isPercentagePoint: false });
  assert.equal(economicChange({ ...base, previous: parseEconomicValue("7.94") }), null);
  assert.equal(economicChange({ ...base, previous: parseEconomicValue("—") }), null);
});

test("unit mismatches are marked partial instead of computing a misleading comparison", () => {
  const result = parseVietnambizEconomy(tableHtml([[...cells.slice(0, 3), "7.94", cells[4]]]), "macro-economic");
  assert.equal(result.warnings.length, 1);
  assert.equal(economicChange(result.rows[0]), null);
});

test("metadata: no LIVE or fake source time; retrieval time doesn't change on cache hits", () => {
  const data = snapshot();
  const meta = economicMeta(data, { cached: true, stale: false }, 123);
  assert.equal(meta.freshness, "FRESH");
  assert.equal(meta.sourceTimestamp, null);
  assert.equal(meta.ageMs, null);
  assert.equal(meta.ingestedAt, data.fetchedAt);
  assert.equal(meta.providerReceivedAt, data.fetchedAt);
  assert.equal(meta.cached, true);
  assert.equal(meta.stale, false);
  assert.equal(meta.latencyMs, 123);
  assert.match(meta.note!, /không phải kỳ số liệu/);
  assert.equal(economicMeta(data, { cached: true, stale: true }, 0).freshness, "STALE");
  assert.equal(economicMeta({ ...data, warnings: ["missing"] }, { cached: false, stale: false }, 0).freshness, "DEGRADED");
});

test("adapter fetches only the two fixed HTTPS source URLs, via the shared resilient HTTP client", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    calls.push(String(url));
    assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal);
    assert.match((options?.headers as Record<string, string>).Accept, /text\/html/);
    return new Response(String(url).endsWith("macro-economic") ? macroHtml : currencyHtml);
  });
  const results = await Promise.all([fetchVietnambizEconomy("macro-economic"), fetchVietnambizEconomy("currency-interest-rate")]);
  assert.deepEqual(calls.sort(), Object.values(ECONOMIC_DATASETS).map((c) => c.sourceUrl).sort());
  assert.ok(results.every((r) => r.data.rows.length === 7 && r.latencyMs >= 0));
  assert.notEqual(ECONOMIC_PROVIDERS["macro-economic"], ECONOMIC_PROVIDERS["currency-interest-rate"]);
  assert.ok(Object.values(ECONOMIC_PROVIDERS).every((p) => p !== "vietnambiz-data"));
});

test("cache: request dedup, per-dataset isolation, refresh, stale fallback, then 24h expiry", async (t) => {
  await resetCaches();
  t.after(resetCaches);
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 7, 10) });
  let failMacro = false;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls++;
    const macro = String(url).endsWith("macro-economic");
    return new Response(macro && failMacro ? "<html>schema changed</html>" : macro ? macroHtml : currencyHtml);
  });
  const [first, duplicate, money] = await Promise.all([getEconomicData("macro-economic"), getEconomicData("macro-economic"), getEconomicData("currency-interest-rate")]);
  assert.ok(first && duplicate && money);
  assert.equal(calls, 2);
  assert.equal(first.data.dataset, "macro-economic");
  assert.equal(money.data.dataset, "currency-interest-rate");
  assert.deepEqual(first, duplicate);
  const hit = await getEconomicData("macro-economic");
  assert.equal(calls, 2);
  assert.equal(hit?.meta.cached, true);
  assert.equal(hit?.data.fetchedAt, first.data.fetchedAt);

  t.mock.timers.tick(ECONOMIC_TTL_MS + 1);
  const fresh = await getEconomicData("macro-economic");
  assert.ok(fresh);
  assert.equal(calls, 3);
  assert.equal(fresh.meta.cached, false);
  assert.notEqual(fresh.data.fetchedAt, first.data.fetchedAt);

  failMacro = true;
  t.mock.timers.tick(ECONOMIC_TTL_MS + 1);
  const stale = await getEconomicData("macro-economic");
  assert.ok(stale);
  assert.equal(stale.meta.freshness, "STALE");
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.cached, true);
  assert.equal(stale.meta.sourceTimestamp, null);
  assert.deepEqual(stale.data, fresh.data); // A failed refresh never overwrites the valid cache.
  const stillMoney = await getEconomicData("currency-interest-rate");
  assert.equal(stillMoney?.meta.freshness, "FRESH");
  assert.equal(stillMoney?.data.dataset, "currency-interest-rate");

  t.mock.timers.tick(ECONOMIC_STALE_MS + 1);
  assert.equal(await getEconomicData("macro-economic"), null);
});

test("API contracts: success envelope, attribution, source timestamp and no-store headers", async (t) => {
  await resetCaches();
  t.after(resetCaches);
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => new Response(String(url).endsWith("macro-economic") ? macroHtml : currencyHtml));
  for (const [handler, dataset] of [[macroGET, "macro-economic"], [currencyGET, "currency-interest-rate"]] as const) {
    const response = await handler();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.success, true);
    assert.equal(body.data.dataset, dataset);
    assert.equal(body.data.sourceUrl, ECONOMIC_DATASETS[dataset].sourceUrl);
    assert.equal(body.data.rows.length, 7);
    assert.equal(body.meta.freshness, "FRESH");
    assert.match(body.meta.source, /WiGroup/);
    assert.equal(body.meta.sourceTimestamp, null);
  }
});

test("API partial-data response is explicitly DEGRADED, not a silently complete board", async (t) => {
  await resetCaches();
  t.after(resetCaches);
  t.mock.method(globalThis, "fetch", async () => new Response(macroHtml.replace("7.94%", "N/A")));
  const response = await macroGET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.meta.freshness, "DEGRADED");
  assert.equal(body.meta.partial, true);
  assert.equal(body.data.rows[0].previous.value, null);
  assert.equal(body.data.warnings.length, 1);
});

test("API upstream failure is 502/UNAVAILABLE; rates and existing commodity health are unaffected", async (t) => {
  await resetCaches();
  t.after(resetCaches);
  const commoditiesBefore = getProviderHealth().find((p) => p.provider === "vietnambiz-data");
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) =>
    String(url).endsWith("macro-economic") ? new Response("private upstream details", { status: 404 }) : new Response(currencyHtml),
  );
  const response = await macroGET();
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.success, false);
  assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(body.meta.freshness, "UNAVAILABLE");
  assert.equal(body.meta.sourceTimestamp, null);
  assert.ok(!JSON.stringify(body).includes("private upstream details"));
  const rates = await currencyGET();
  assert.equal(rates.status, 200);
  assert.equal((await rates.json()).meta.freshness, "FRESH");
  assert.deepEqual(getProviderHealth().find((p) => p.provider === "vietnambiz-data"), commoditiesBefore);
});
