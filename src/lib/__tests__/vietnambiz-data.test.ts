/**
 * VIETNAMBiz DATA PORTAL (WiFeed) — parsers + mapping.
 * Fixtures = HTML bảng giá REAL từ trang data.vietnambiz.vn (fetch 2026-09-06):
 * goods: heo hơi tà 57,833 · tôm thẻ 91,500 · nhôm 24,373 · kẽm 26,633 ·
 * quặng sắt 718.89 · vàng 4,442.4 · SJC 147,600 · bạc 65.48 · đồng 6.58 ·
 * ure Đông 443.25 · than cốc 2,125 · WTI 91.22 · khí 2.94 · HRC 3,388 ·
 * xăng E5 RON92 22.48 · diesel 27.74.
 * macro: GDP 8.39 / CPI 4.89 / PMI 53.3 / xuất khẩu 26.01%.
 * rates: M2 5.28% / tín dụng 17.41% / USD NHTM 26,255 / LNH-ON 6.01.
 * Không giá nào bịa — mọi số là giá công bố trên trang.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { GOODS_HTML, CSS_TEXT_BLOB, junkGoodsHtml } from "./fixtures/vnb-goods";
import {
  parseVnbNum,
  parseVnbDate,
  extractTableRows,
  parseVnbGoodsRows,
  mapVnbGoodsRows,
  matchVnbGoods,
  VNB_GOODS_KEYS,
  parseVnbMacroRows,
  parseVnbRatesRows,
} from "../providers/vietnambiz-data";



const MACRO_HTML = `
<table>
<tr><th>Chỉ tiêu</th><th>Kỳ công bố</th><th>Kỳ hiện tại</th><th>Kỳ trước</th><th>Ngày công bố tiếp theo</th></tr>
<tr><td>Tăng trưởng GDP (YoY)</td><td>Quý 2/2026</td><td>8.39%</td><td>7.94%</td><td>Ngày 29 tháng cuối cùng của quý</td></tr>
<tr><td>Tăng trưởng CPI (YoY)</td><td>Tháng 08/2026</td><td>4.89%</td><td>4.45%</td><td>Ngày 29 hàng tháng</td></tr>
<tr><td>PMI</td><td>Tháng 08/2026</td><td>53.3</td><td>52.9</td><td>Ngày 1 hàng tháng</td></tr>
<tr><td>Xuất khẩu (YoY)</td><td>Tháng 08/2026</td><td>26.01%</td><td>25.01%</td><td>Hai tuần đầu mỗi tháng</td></tr>
<tr><td>Cán cân thương mại (Triệu USD)</td><td>Tháng 08/2026</td><td>-113.21</td><td>-3,572.78</td><td>Hai tuần đầu mỗi tháng</td></tr>
</table>
`;

const RATES_HTML = `
<table>
<tr><th>Chỉ tiêu</th><th>Kỳ công bố</th><th>Kỳ hiện tại</th><th>Kỳ trước</th></tr>
<tr><td>Tăng trưởng cung tiền M2  (YoY)</td><td>Tháng 05/2026</td><td>5.28%</td><td>5.86%</td></tr>
<tr><td>Tăng trưởng tín dụng (YoY)</td><td>Tháng 06/2026</td><td>17.41%</td><td>18.23%</td></tr>
<tr><td>Tỷ giá USD NHTM bán ra</td><td>Ngày 04/09/2026</td><td>26,255</td><td>26,260</td></tr>
<tr><td>Lãi suất liên ngân hàng  &nbsp;ON</td><td>Ngày 03/09/2026</td><td>6.01</td><td>1.19</td></tr>
</table>
`;

test("parseVnbNum: comma/dot hỗn hợp & nghìn phân cách (giá thật trên trang)", () => {
  assert.equal(parseVnbNum("57,833"), 57_833);
  assert.equal(parseVnbNum("4,442.4"), 4_442.4);
  assert.equal(parseVnbNum("718.89"), 718.89);
  assert.equal(parseVnbNum("26,633"), 26_633);
  assert.equal(parseVnbNum("25,605"), 25_605);
  assert.equal(parseVnbNum("523.1"), 523.1);
  assert.equal(parseVnbNum("-3,572.78"), -3_572.78);
  assert.equal(parseVnbNum("--"), null);
  assert.equal(parseVnbNum(""), null);
  assert.equal(parseVnbNum("  --  "), null);
  assert.equal(parseVnbNum("abc"), null);
});

test("parseVnbDate: DD/MM/YYYY → midnight +07:00", () => {
  assert.equal(parseVnbDate("04/09/2026"), Date.parse("2026-09-04T00:00:00+07:00"));
  assert.equal(parseVnbDate(null), null);
});

test("extractTableRows + parseVnbGoodsRows: đọc được mọi hàng giá hợp lệ (header/-- bỏ)", () => {
  const rows = parseVnbGoodsRows(GOODS_HTML);
  assert.equal(rows.length, 66, "toàn bộ 66 dòng bảng /goods");
  const heo = rows.find((r) => r.name === "Giá heo hơi trong nước");
  assert.ok(heo);
  assert.equal(heo.price, 57_833);
  assert.equal(heo.unit, "Đồng/kg");
  assert.equal(heo.dateTs, Date.parse("2026-09-04T00:00:00+07:00"));
  const nhom = rows.find((r) => r.name === "Nhôm Trung Quốc");
  assert.equal(nhom?.price, 24_373);
  assert.equal(nhom?.unit, "CNY/tấn");
});

test("mapVnbGoodsRows: 66/66 dòng /goods → catalog đúng key; unit/currency NGUYÊN VĂN; SJC ×1000", () => {
  const mapped = mapVnbGoodsRows(parseVnbGoodsRows(GOODS_HTML));
  assert.equal(mapped.size, 66, "map đủ 66 mục — không mất hàng nào");
  const get = (k: string) => mapped.get(k);

  // Kim loại & phi kim — unit giữ NGUYÊN VĂN trang (không đổi "CNY/tấn"→"CNY/T")
  assert.equal(get("gold")?.price, 4_442.4);
  assert.equal(get("gold")?.unit, "USD/ounce");
  assert.equal(get("sjc-gold")?.price, 147_600_000); // trang ghi nghìn đồng/lượng → ×1000
  assert.equal(get("sjc-gold")?.unit, "Đồng/lượng");
  assert.equal(get("silver")?.price, 65.48);
  assert.equal(get("copper")?.price, 6.58);
  assert.equal(get("copper")?.unit, "USD/pound");
  assert.equal(get("copper-cn")?.price, 110_032);
  assert.equal(get("copper-cn")?.unit, "CNY/tấn");
  assert.equal(get("copper-cn")?.currency, "CNY");
  assert.equal(get("aluminum")?.price, 24_373);
  assert.equal(get("aluminum")?.unit, "CNY/tấn");
  assert.equal(get("aluminum")?.currency, "CNY");
  assert.equal(get("zinc")?.price, 26_633);
  assert.equal(get("lead")?.price, 16_115);
  assert.equal(get("iron-ore")?.price, 718.89);
  assert.equal(get("nickel")?.price, 129_117);

  // Tiêu dùng — tôm KHÔNG scale nữa (giữ Đồng/kg 91,500 của trang)
  assert.equal(get("pig-vn")?.price, 57_833);
  assert.equal(get("pig-vn")?.unit, "Đồng/kg");
  assert.equal(get("shrimp-vn")?.price, 91_500);
  assert.equal(get("coffee-robusta")?.price, 94_700);
  assert.equal(get("pepper")?.price, 137_000);
  assert.equal(get("rice")?.price, 10_200);
  assert.equal(get("paddy")?.price, 7_550);
  assert.equal(get("rice-raw")?.price, 10_350);
  assert.equal(get("rice-byproduct")?.price, 8_475);
  assert.equal(get("sugar")?.price, 523.1);
  assert.equal(get("coffee")?.price, 295.6);
  assert.equal(get("cotton-fabric-us")?.price, 86.33);

  // Hóa chất
  assert.equal(get("urea")?.price, 443.25);
  assert.equal(get("sulfur")?.price, 8_639);
  assert.equal(get("yellow-phosphorus")?.price, 28_029);
  assert.equal(get("caustic-soda")?.price, 637);
  assert.equal(get("urea-cn")?.price, 1_813);
  assert.equal(get("urea-phu-my")?.price, 11_700);
  assert.equal(get("urea-ca-mau")?.price, 12_150);

  // Vật liệu xây dựng (20 mục — cả asphalt có space trước ':')
  assert.equal(get("steel-scrap")?.price, 388.5);
  assert.equal(get("steel-rebar")?.price, 595);
  assert.equal(get("steel")?.price, 3_388);
  assert.equal(get("aggregate-04")?.price, 109_200);
  assert.equal(get("aggregate-sieve")?.price, 111_200);
  assert.equal(get("aggregate-1x2")?.price, 169_200);
  assert.equal(get("aggregate-boulder")?.price, 172_000);
  assert.equal(get("sheet-color")?.price, 127_600);
  assert.equal(get("sheet")?.price, 121_000);
  assert.equal(get("asphalt")?.price, 4_146_000);
  assert.equal(get("pipe-27")?.price, 13_900);
  assert.equal(get("pipe-60")?.price, 43_300);
  assert.equal(get("pipe-90")?.price, 68_900);
  assert.equal(get("paint-primer")?.price, 117_090);
  assert.equal(get("paint-interior")?.price, 50_000);
  assert.equal(get("paint-exterior")?.price, 70_909);
  assert.equal(get("cement")?.price, 1_717.59);
  assert.equal(get("concrete")?.price, 1_586_869);
  assert.equal(get("brick")?.price, 1_825);
  assert.equal(get("pile")?.price, 7_416_667);

  // Năng lượng
  assert.equal(get("coal")?.price, 2_125);
  assert.equal(get("lpg")?.price, 6_531);
  assert.equal(get("wti")?.price, 91.22);
  assert.equal(get("wti")?.unit, "USD/thùng");
  assert.equal(get("natgas")?.price, 2.94);
  assert.equal(get("coal-newcastle")?.price, 147);
  assert.equal(get("gasoline-95-v")?.price, 25.05);
  assert.equal(get("gasoline-95")?.price, 24.15, "RON 95-II,III tách key riêng");
  assert.equal(get("gasoline-92")?.price, 22.48);
  assert.equal(get("diesel")?.price, 27.74);
  assert.equal(get("kerosene")?.price, 26.73);

  // Nhựa & cao su
  assert.equal(get("rubber")?.price, 429.3);
  assert.equal(get("rubber")?.currency, "JPY", "Yên/tấn → JPY");
  assert.equal(get("pet")?.price, 8_258.75);
  assert.equal(get("pvc")?.price, 4_835);
  assert.equal(get("pp")?.price, 9_633.33);

  // provenance + % Ngày hiện "--"
  assert.match(get("aluminum")?.source ?? "", /VietnamBiz Data/);
  assert.match(get("wti")?.url ?? "", /data\.vietnambiz\.vn\/goods/);
  assert.equal(get("aluminum")?.changePercent, null);
});

test("mapVnbGoodsRows: KHÔNG map hàng không tồn tại trên /goods; match chính xác (không prefix)", () => {
  const mapped = mapVnbGoodsRows(parseVnbGoodsRows(GOODS_HTML));
  assert.equal(mapped.has("milk-wmp"), false);
  assert.equal(mapped.has("pangasius"), false);
  assert.equal(mapped.has("btc"), false);
  // fuzzy (tolerance nhẹ cho rác CSS/prefix): vẫn khớp đúng mục nhiều nghĩa nhất
  assert.equal(matchVnbGoods("Giá vàng thế giới")?.key, "gold");
  assert.equal(matchVnbGoods("Giá heo hơi trong nước (giá hôm nay)")?.key, "pig-vn");
  assert.equal(matchVnbGoods(", Giá vàng trong nước")?.key, "sjc-gold", "junk prefix không đổi mapping");
  assert.equal(matchVnbGoods("Giá vàng trong nước ")?.key, "sjc-gold", "trailing space vẫn đúng");
  // vẫn từ chối những thứ không phải hàng hóa trong bảng
  assert.equal(matchVnbGoods("Chó giống"), null);
  assert.equal(matchVnbGoods("Tôm sú"), null);
  // mọi mapped key phải nằm trong catalog keys
  for (const k of mapped.keys()) assert.ok(VNB_GOODS_KEYS.has(k), k);
});

test("REGRESSION 3: junkGoodsHtml (CSS blob trong MỌI ô giống trang thật) → parse 66/66 + map 66 keys", () => {
  const rows = parseVnbGoodsRows(junkGoodsHtml());
  assert.equal(rows.length, 66, "66 dòng — rác CSS không làm mất hàng nào");
  assert.ok(rows.every((r) => !/\.css-|where\(|ant-typography|\$/.test(`${r.name} ${r.unit} ${r.price ?? ""}`)), "không còn sót CSS");
  const mapped = mapVnbGoodsRows(rows);
  assert.equal(mapped.size, 66);
  assert.equal(mapped.get("asphalt")?.price, 4_146_000);
  assert.equal(mapped.get("pile")?.price, 7_416_667);
  assert.equal(mapped.get("gasoline-95")?.price, 24.15);
});

test("VNB_GOODS_KEYS: đúng 66 key của bảng /goods (có đủ nhôm/kẽm/pepper/pile/asphalt)", () => {
  assert.equal(VNB_GOODS_KEYS.size, 66);
  for (const k of ["aluminum", "zinc", "copper-cn", "gold", "pepper", "paddy", "pile", "asphalt", "gasoline-95-v", "rubber", "pet", "pvc", "pp"]) {
    assert.equal(VNB_GOODS_KEYS.has(k), true, k);
  }
  assert.equal(VNB_GOODS_KEYS.has("pangasius"), false);
  assert.equal(VNB_GOODS_KEYS.has("milk-wmp"), false);
});

test("parseVnbMacroRows: GDP/CPI/PMI/xuất nhập khẩu đúng giá + kỳ + next release", () => {
  const rows = parseVnbMacroRows(MACRO_HTML);
  assert.equal(rows.length, 5);
  const gdp = rows.find((r) => r.indicator.startsWith("Tăng trưởng GDP"));
  assert.equal(gdp?.current, 8.39);
  assert.equal(gdp?.previous, 7.94);
  assert.equal(gdp?.period, "Quý 2/2026");
  assert.match(gdp?.nextRelease ?? "", /29 tháng/);
  const cpi = rows.find((r) => r.indicator.includes("CPI"));
  assert.equal(cpi?.current, 4.89);
  const pm = rows.find((r) => r.indicator === "PMI");
  assert.equal(pm?.current, 53.3);
  const trade = rows.find((r) => r.indicator.includes("Cán cân thương mại"));
  assert.equal(trade?.current, -113.21);
  assert.equal(trade?.previous, -3_572.78);
});

test("parseVnbRatesRows: M2/tín dụng/USD/lãi suất LNH đúng giá", () => {
  const rows = parseVnbRatesRows(RATES_HTML);
  assert.equal(rows.length, 4);
  const m2 = rows.find((r) => r.indicator.startsWith("Tăng trưởng cung tiền"));
  assert.equal(m2?.current, 5.28);
  const td = rows.find((r) => r.indicator.includes("tín dụng"));
  assert.equal(td?.current, 17.41);
  const usd = rows.find((r) => r.indicator.includes("USD NHTM"));
  assert.equal(usd?.current, 26_255);
  assert.equal(usd?.previous, 26_260);
  const on = rows.find((r) => r.indicator.includes("liên ngân hàng"));
  assert.equal(on?.current, 6.01);
  assert.equal(on?.previous, 1.19);
});

/* --------------- Regression: ANTD cssinjs SSR CSS lẫn vào bảng ---------------
 * Trang data.vietnambiz.vn là app Ant Design SSR — stylesheet được nhúng vào
 * HTML (có thể nằm trong <style> toàn trang, hoặc bên trong ô bảng). Parser
 * phải loại bỏ NỘI DUNG CSS (không chỉ thẻ) — bug cũ khiến UI hiển thị
 * nguyên khối `.css-x19ppn{...}where(.css-ls3dc0f){...}` thay cho dữ liệu.
 */

const CSS_BLOB =
  `.css-x19ppn{font-weight:800;line-height:1.5714285714285714;font-size:0.875rem;font-weight:500;color:inherit;}` +
  `,where(.css-ls3dc0f)[class^="ant-typography"],` +
  `[class^="ant-typography"]:before{content:""}` +
  `,where(.css-ls3dc0f)[class^="ant-typography"]:after{content:""}` +
  `,@media (max-width: 768px){.css-abc{display:none}}`;

const CSS_LADEN_HTML = `
<!DOCTYPE html><html><head>
<style>${CSS_BLOB}</style>
<script>window.__DATA__={x:1}</script>
</head><body>
<table><tr><th>Mặt hàng</th><th>Giá</th><th>% Ngày</th><th>% Tháng</th><th>% Năm</th><th>Ngày cập nhật</th></tr>
<tr>
  <td><style>${CSS_BLOB}</style>Giá heo hơi trong nước<br>Đồng/kg</td>
  <td>57,833</td><td>--</td><td>--</td><td>--</td><td>04/09/2026</td>
</tr>
<tr>
  <td>Giá vàng trong nước<br>Đồng/lượng</td>
  <td><style>${CSS_BLOB}</style>147,600</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td>
</tr>
</table>
<table>
<tr><th>Chỉ tiêu</th><th>Kỳ công bố</th><th>Kỳ hiện tại</th><th>Kỳ trước</th><th>Ngày công bố tiếp theo</th></tr>
<tr>
  <td><style>${CSS_BLOB}</style>Tăng trưởng GDP (YoY)</td>
  <td>Quý 2/2026</td><td>8.39%</td><td>7.94%</td><td>Ngày 29 tháng cuối cùng của quý</td>
</tr>
<tr>
  <td>PMI</td><td>Tháng 08/2026</td><td>53.3</td><td>52.9</td><td>Ngày 1 hàng tháng</td>
</tr>
</table>
<!-- dump table: header + row toàn CSS (plain text, không thẻ style) -->
<table>
<tr><td>${CSS_BLOB}</td><td>${CSS_BLOB}</td></tr>
<tr><td>${CSS_BLOB}</td><td>${CSS_BLOB}</td></tr>
</table>
</body></html>`;

test("REGRESSION: strip <style>/<script> NỘI DUNG — goods không còn CSS trong cell", () => {
  const rows = parseVnbGoodsRows(CSS_LADEN_HTML);
  assert.equal(rows.length, 2, "chỉ 2 hàng thật, không có hàng CSS");
  const heo = rows.find((r) => r.name === "Giá heo hơi trong nước");
  assert.ok(heo, "tên cleaned (không lẫn .css-…)");
  assert.equal(heo.price, 57_833);
  assert.equal(heo.unit, "Đồng/kg");
  const vang = rows.find((r) => r.name === "Giá vàng trong nước");
  assert.ok(vang);
  assert.equal(vang.price, 147_600);
  assert.ok(!isCssLike(rows.map(r => `${r.name} ${r.unit ?? ""} ${r.price}`)));
});

test("REGRESSION: macro/rates không còn CSS — indicator + currentRaw sạch", () => {
  const macro = parseVnbMacroRows(CSS_LADEN_HTML);
  assert.equal(macro.length, 2);
  const gdp = macro.find((r) => r.indicator === "Tăng trưởng GDP (YoY)");
  assert.ok(gdp);
  assert.equal(gdp.current, 8.39);
  assert.equal(gdp.currentRaw, "8.39%");
  assert.equal(gdp.period, "Quý 2/2026");
  const pmi = macro.find((r) => r.indicator === "PMI");
  assert.equal(pmi?.current, 53.3);
  assert.ok(!isCssLike(macro.map((m) => `${m.indicator}${m.currentRaw ?? ""}${m.period}`)));

  const rates = parseVnbRatesRows(
    `<table><tr><th>Chỉ tiêu</th><th>Kỳ công bố</th><th>Kỳ hiện tại</th><th>Kỳ trước</th></tr>
     <tr><td><style>${CSS_BLOB}</style>Lãi suất liên ngân hàng ON</td><td>Ngày 03/09/2026</td><td>6.01</td><td>1.19</td></tr></table>`,
  );
  assert.equal(rates.length, 1);
  assert.equal(rates[0].indicator, "Lãi suất liên ngân hàng ON");
  assert.equal(rates[0].current, 6.01);
  assert.equal(rates[0].currentRaw, "6.01");
  assert.equal(rates[0].period, "Ngày 03/09/2026");
});

test("REGRESSION: extractTableRows bỏ bảng CSS-dump (header không khớp / hàng toàn CSS)", () => {
  const rows = extractTableRows(CSS_LADEN_HTML, ["Mặt hàng", "Giá", "% Ngày", "Ngày cập nhật"]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !isCssLike(r)));
});

export function isCssLike(items: unknown[]): boolean {
  const s = items.join(" ");
  return /\.css-|where\(|ant-typography|font-weight:/.test(s);
}

/* --------------- Regression 2: ANTD cssinjs CSS NẰM TRỰC TIẾP TRONG CELL ---------------
 * Trang thực tế có thể đặt critical CSS làm TEXT trong ô bảng (không bọc
 * <style>) — đúng blob chụp từ UI: `.css-x19ppn{…},where(.css-ls3dc0f)
 * [class^="ant-typography"],…{…}` nằm ngay trước nhãn. Parser phải loại hết
 * CSS chữ và giữ NGUYÊN nhãn/số liệu (không còn "$", dấu phẩy, selector thừa).
 */

function cssTextTable(body: string, headers: string[]): string {
  const th = headers.map((h) => `<th>${CSS_TEXT_BLOB}${h}</th>`).join("");
  return `<table><tr>${th}</tr>${body}</table>`;
}

test("REGRESSION 2: CSS-as-text trong cell — macro giữ NGUYÊN nhãn + số, hết rác selector", () => {
  const html = cssTextTable(
    `<tr><td>${CSS_TEXT_BLOB}Tăng trưởng GDP (YoY)</td><td>${CSS_TEXT_BLOB}Quý 2/2026</td><td>8.39%</td><td>7.94%</td><td>Ngày 29 tháng cuối cùng của quý</td></tr>
     <tr><td>${CSS_TEXT_BLOB}PMI</td><td>Tháng 08/2026</td><td>53.3</td><td>52.9</td><td>Ngày 1 hàng tháng</td></tr>`,
    ["Chỉ tiêu", "Kỳ công bố", "Kỳ hiện tại", "Kỳ trước", "Ngày công bố tiếp theo"],
  );
  const rows = parseVnbMacroRows(html);
  assert.equal(rows.length, 2);
  const gdp = rows.find((r) => r.indicator.startsWith("Tăng trưởng GDP"));
  assert.ok(gdp, `indicator sạch: ${JSON.stringify(rows[0]?.indicator)}`);
  assert.equal(gdp?.indicator, "Tăng trưởng GDP (YoY)");
  assert.equal(gdp?.period, "Quý 2/2026");
  assert.equal(gdp?.currentRaw, "8.39%");
  const pmi = rows.find((r) => r.indicator === "PMI");
  assert.equal(pmi?.current, 53.3);
  assert.ok(!rows.some((r) => /\.css-|where\(|ant-typography|\$/.test(`${r.indicator} ${r.period} ${r.currentRaw ?? ""}`)));
});

test("REGRESSION 2: CSS-as-text trong cell — goods name/unit/price sạch", () => {
  const html = cssTextTable(
    `<tr><td>${CSS_TEXT_BLOB}Giá heo hơi trong nước<br>Đồng/kg</td><td>57,833</td><td>--</td><td>--</td><td>--</td><td>04/09/2026</td></tr>
     <tr><td>${CSS_TEXT_BLOB}Nhôm Trung Quốc<br>CNY/tấn</td><td>24,373</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>`,
    ["Mặt hàng", "Giá", "% Ngày", "% Tháng", "% Năm", "Ngày cập nhật"],
  );
  const rows = parseVnbGoodsRows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Giá heo hơi trong nước");
  assert.equal(rows[0].unit, "Đồng/kg");
  assert.equal(rows[0].price, 57_833);
  assert.equal(rows[1].name, "Nhôm Trung Quốc");
  assert.equal(rows[1].price, 24_373);
  const mapped = mapVnbGoodsRows(rows);
  assert.equal(mapped.get("aluminum")?.price, 24_373);
  assert.equal(mapped.get("pig-vn")?.price, 57_833);
});
