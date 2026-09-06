/**
 * COMMODITY PROVIDER — parse strict tests.
 * Fixtures are reconstructions of the REAL server-rendered text of the public
 * Simplize pages fetched 2026-09-06 (WTI / gold world / natural gas / HRC).
 * No invented values: every number below was published on the live page.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseSimplizePage, defByKeyOrSymbol, COMMODITY_CATALOG, MSN_KEY_BY_KEY, currencyForUnit } from "../providers/commodities";

/** stripped-text (as produced by parseSimplizePage's stripTags) — WTI page, real values */
const WTI_TEXT = [
  "Trang chủ > Hàng hóa > Dầu thô WTI",
  "LIVELIVE WTI",
  "Giá hiện tại: 91.48 +0.18 0.20%",
  "Giá đóng cửa hôm trước 91.30 Giá mở cửa 91.67",
  "Biên độ ngày 88.72 - 92.17 Biên độ 52 tuần 54.98 - 119.4",
  "Đơn vị tính USD/Bbl",
  "% 7D 9.69% % 1M 21.62% % 3M 1.04% % YTD 59.32% % 1Y 44.11% % 5Y 32.02%",
  "Biến động giá trong vòng 1 năm",
  "Cổ phiếu liên quan",
  "GAS (HOSE) 3.5 1.2% PLX (HOSE) 4.1 0.4% BSR (HOSE) 6.2 -1.1%",
  "PVD (HOSE) 1.1 0.0% PVS (HNX) 0.9 2.3%",
  "Tin tức hàng hoá 20/08/2026 | Giá dầu tăng phiên thứ ba liên tiếp",
].join(" ");

test("parseSimplizePage: WTI — price, change, % change, day range, unit, perf keys", () => {
  const p = parseSimplizePage(WTI_TEXT);
  assert.ok(p);
  assert.equal(p.price, 91.48);
  assert.equal(p.change, 0.18);
  assert.equal(p.changePercent, 0.2);
  assert.equal(p.previousClose, 91.3);
  assert.equal(p.open, 91.67);
  assert.equal(p.high, 92.17);
  assert.equal(p.low, 88.72);
  assert.equal(p.unit, "USD/Bbl");
  assert.equal(p.perf["1W"], 9.69);
  assert.equal(p.perf["1M"], 21.62);
  assert.equal(p.perf["3M"], 1.04);
  assert.equal(p.perf.YTD, 59.32);
  assert.equal(p.perf["1Y"], 44.11);
  assert.equal(p.perf["5Y"], 32.02);
  assert.deepEqual(p.relatedStocks, ["GAS", "PLX", "BSR", "PVD", "PVS"]);
});

test("parseSimplizePage: percent labels on the gold-page use 'Từ đầu năm'/'1 năm'", () => {
  const GOLD_TEXT =
    "Giá hiện tại: 4476.00 -63.30 -1.39% Giá đóng cửa hôm trước 4539.30 Giá mở cửa 4530.50 " +
    "Biên độ ngày 4450.00 - 4500.00 Biên độ 52 tuần 3595.00 - 5626.00 Đơn vị tính USD/oz " +
    "% 7D 0.44% % 1M 1.87% % 3M 2.11% Từ đầu năm 3.12% 1 năm 24.12% % 5Y 56.91% " +
    "Cập nhật lúc 12:24:17, ngày 06/09/2026 " +
    "Cổ phiếu liên quan BID (HOSE) ACB (HOSE) PNJ (HOSE) VCB (HOSE) CTG (HOSE) " +
    "Tin tức";
  const p = parseSimplizePage(GOLD_TEXT);
  assert.ok(p);
  assert.equal(p.perf.YTD, 3.12);
  assert.equal(p.perf["1Y"], 24.12);
  assert.ok(p.timestamp != null);
  // parsed in local (sandbox ICT/UTC) tz — deterministic comparison
  assert.equal(p.timestamp, new Date(2026, 8, 6, 12, 24, 17).getTime());
  assert.deepEqual(p.relatedStocks, ["BID", "ACB", "PNJ", "VCB", "CTG"]);
});

test("parseSimplizePage: change renders as '-' → change=0 (published flat), percent still parsed", () => {
  const T = "Giá hiện tại: 18.07 - 0.00% Giá đóng cửa hôm trước 18.07 Giá mở cửa 18.01 Đơn vị tính USd/Lbs";
  const p = parseSimplizePage(T);
  assert.ok(p);
  assert.equal(p.change, 0);
  assert.equal(p.changePercent, 0);
  assert.equal(p.price, 18.07);
});

test("parseSimplizePage: returns null when no 'Giá hiện tại' (404/structure changed) — never guesses", () => {
  assert.equal(parseSimplizePage("404 Not Found — Trang bạn tìm không tồn tại"), null);
  assert.equal(parseSimplizePage(""), null);
});

test("defByKeyOrSymbol: maps key and symbol, uppercase-insensitive", () => {
  assert.equal(defByKeyOrSymbol("wti")?.key, "wti");
  assert.equal(defByKeyOrSymbol("CL")?.key, "wti");
  assert.equal(defByKeyOrSymbol("XAUUSD")?.key, "gold");
  assert.equal(defByKeyOrSymbol("unknown-xyz"), null);
});

test("catalog: every Simplize-path commodity has verified path; gold uses /gia-vang/the-gioi", () => {
  const gold = COMMODITY_CATALOG.find((d) => d.key === "gold");
  assert.equal(gold?.simplizePath, "/gia-vang/the-gioi");
  // brent/wheat/aluminum/zinc: no Simplize page (verified 404) → no simplizePath
  for (const key of ["brent", "wheat", "aluminum", "zinc"]) {
    const d = COMMODITY_CATALOG.find((x) => x.key === key);
    assert.equal(d?.simplizePath, undefined, `${key} must not claim a fake Simplize page`);
  }
});

test("catalog: steel (HRC) has verified Simplize page → not permanently UNAVAILABLE", () => {
  const steel = COMMODITY_CATALOG.find((d) => d.key === "steel");
  assert.equal(steel?.simplizePath, "/hang-hoa/gia-thep-hrc");
  assert.equal(steel?.unit, "USD/T");
});

test("parseSimplizePage: Thép D10 — flat '-' change, multi-token unit 'Nghìn đồng/kg'", () => {
  const T =
    "Hàng Hoá > Thép D10 Giá hiện tại: 14.21 - 0.00% Giá đóng cửa hôm trước 14.21 " +
    "Biên độ 52 tuần 12.99 - 15.43 Đơn vị tính Nghìn đồng/kg " +
    "% 7D - % 1M - % 3M -7.91% % YTD +4.49% % 1Y +9.39% % 5Y -12.34% " +
    "Cổ phiếu liên quan NKG (HOSE) CTCP Thép Nam Kim 10,750 -50 -0.46% " +
    "VCA (HOSE) CTCP Thép VICASA 6,600 0 0.00% HMC (HOSE) CTCP Kim khí TP HCM 10,800 0 0.00% " +
    "HPG (HOSE) CTCP Tập đoàn Hòa Phát 21,700 100 0.46% HSG (HOSE) CTCP Tập đoàn Hoa Sen 10,600 -50 -0.47% " +
    "Tin tức hàng hoá";
  const p = parseSimplizePage(T);
  assert.ok(p);
  assert.equal(p.price, 14.21);
  assert.equal(p.change, 0);
  assert.equal(p.changePercent, 0);
  assert.equal(p.previousClose, 14.21);
  assert.equal(p.unit, "Nghìn đồng/kg");
  assert.equal(p.perf["1Y"], 9.39);
  assert.equal(p.perf["3M"], -7.91);
  assert.deepEqual(p.relatedStocks, ["NKG", "VCA", "HMC", "HPG", "HSG"]);
});

test("parseSimplizePage: heo hơi VN — absolute VND price + positive change + VNĐ/kg unit", () => {
  const T =
    "Giá hiện tại: 59,500 +1,800 3.12% Giá đóng cửa hôm trước 57,700 " +
    "Biên độ 52 tuần 48,100 - 79,100 Đơn vị tính VNĐ/kg " +
    "% 7D +3.12% % 1M -7.47% % 3M -12.24% % YTD -13.64% % 1Y +7.4% % 5Y +22.08% " +
    "Cổ phiếu liên quan DBC (HOSE) CTCP Tập đoàn Dabaco Việt Nam 16,800 -250 -1.47% " +
    "HAG (HOSE) CTCP Hoàng Anh Gia Lai 14,000 -150 -1.06% MML (UPCOM) CTCP Masan MeatLife 28,800 0 0.00% " +
    "BAF (HOSE) Công ty Cổ phần Nông nghiệp BAF Việt Nam 32,550 50 0.15% Tin tức hàng hoá";
  const p = parseSimplizePage(T);
  assert.ok(p);
  assert.equal(p.price, 59_500);
  assert.equal(p.change, 1_800);
  assert.equal(p.changePercent, 3.12);
  assert.equal(p.unit, "VNĐ/kg");
  assert.deepEqual(p.relatedStocks, ["DBC", "HAG", "MML", "BAF"]);
});

test("currencyForUnit: published unit → ISO currency (VNĐ/Nghìn đồng/CNY/JPY/USD)", () => {
  assert.equal(currencyForUnit("VNĐ/kg"), "VND");
  assert.equal(currencyForUnit("Nghìn đồng/lít"), "VND");
  assert.equal(currencyForUnit("CNY/kg"), "CNY");
  assert.equal(currencyForUnit("JPY/kg"), "JPY");
  assert.equal(currencyForUnit("USD/T"), "USD");
  assert.equal(currencyForUnit(null), "USD");
});

test("universe: mọi commodity chính thức có Simplize path + market + currency + unit + vnImpact", () => {
  const OFFICIAL = [
    "gold", "sjc-gold", "silver",
    "copper", "nickel", "iron-ore", "steel", "steel-d10",
    "wti", "natgas", "coal", "gasoline-95", "gasoline-92", "diesel",
    "corn", "soybean", "rice",
    "coffee", "coffee-robusta", "rubber-tsr20", "rubber-rss3", "cotton", "sugar",
    "urea",
    "pig-vn", "pig-cn", "milk-wmp", "milk-smp",
    "shrimp-vn", "pangasius",
  ];
  for (const key of OFFICIAL) {
    const d = COMMODITY_CATALOG.find((x) => x.key === key);
    assert.ok(d, `missing official commodity: ${key}`);
    assert.ok(d.simplizePath && d.simplizePath.startsWith("/"), `${key}: verified Simplize page`);
    assert.ok(d.market === "VN" || d.market === "INTL", `${key}: market`);
    assert.ok(d.currency && d.unit, `${key}: currency/unit`);
    assert.ok(d.vnImpact && d.vnImpact.stocks.length > 0, `${key}: vnImpact + related stocks`);
  }
});

test("MSN_KEY_BY_KEY remains only a fallback map — never primary for chart/change", () => {
  assert.equal(MSN_KEY_BY_KEY.gold, "GOLD");
  assert.equal(MSN_KEY_BY_KEY.wti, "WTI");
});
