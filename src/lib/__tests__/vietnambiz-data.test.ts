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

const GOODS_HTML = `
<table>
<tr><th>Mặt hàng</th><th>Giá</th><th>% Ngày</th><th>% Tháng</th><th>% Năm</th><th>Ngày cập nhật</th></tr>
<tr><td>Giá heo hơi trong nước<br>Đồng/kg</td><td>57,833</td><td>--</td><td>--</td><td>--</td><td>04/09/2026</td></tr>
<tr><td>Giá cà phê trong nước<br>Đồng/kg</td><td>94,700</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Tôm thẻ<br>Đồng/kg</td><td>91,500</td><td>--</td><td>--</td><td>--</td><td>28/08/2026</td></tr>
</table>
<table>
<tr><th>Mặt hàng</th><th>Giá</th><th>% Ngày</th><th>% Tháng</th><th>% Năm</th><th>Ngày cập nhật</th></tr>
<tr><td>Quặng sắt Trung Quốc<br>CNY/tấn</td><td>718.89</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Kẽm Trung Quốc<br>CNY/tấn</td><td>26,633</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Nhôm Trung Quốc<br>CNY/tấn</td><td>24,373</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Đồng Trung Quốc<br>CNY/tấn</td><td>110,032</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Nikken Trung Quốc<br>CNY/tấn</td><td>129,117</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Giá vàng<br>USD/ounce</td><td>4,442.4</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Giá vàng trong nước<br>Đồng/lượng</td><td>147,600</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Giá bạc<br>USD/ounce</td><td>65.48</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Giá đồng<br>USD/pound</td><td>6.58</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
</table>
<table>
<tr><th>Mặt hàng</th><th>Giá</th><th>% Ngày</th><th>% Tháng</th><th>% Năm</th><th>Ngày cập nhật</th></tr>
<tr><td>Ure Trung Đông<br>USD/tấn</td><td>443.25</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Phân Ure Phú Mỹ<br>Đồng/kg</td><td>11,700</td><td>--</td><td>--</td><td>--</td><td>28/08/2026</td></tr>
</table>
<table>
<tr><th>Mặt hàng</th><th>Giá</th><th>% Ngày</th><th>% Tháng</th><th>% Năm</th><th>Ngày cập nhật</th></tr>
<tr><td>Thép phế Anh<br>USD/tấn</td><td>388.5</td><td>--</td><td>--</td><td>--</td><td>04/09/2026</td></tr>
<tr><td>HRC Trung Quốc<br>CNY/tấn</td><td>3,388</td><td>--</td><td>--</td><td>--</td><td>06/09/2026</td></tr>
</table>
<table>
<tr><th>Mặt hàng</th><th>Giá</th><th>% Ngày</th><th>% Tháng</th><th>% Năm</th><th>Ngày cập nhật</th></tr>
<tr><td>Than cốc Trung Quốc<br>CNY/tấn</td><td>2,125</td><td>--</td><td>--</td><td>--</td><td>06/09/2026</td></tr>
<tr><td>Dầu WTI<br>USD/thùng</td><td>91.22</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Khí thiên nhiên<br>USD/Mmbtu</td><td>2.94</td><td>--</td><td>--</td><td>--</td><td>05/09/2026</td></tr>
<tr><td>Than Newcastle<br>USD/tấn</td><td>147</td><td>--</td><td>--</td><td>--</td><td>03/09/2026</td></tr>
<tr><td>Xăng RON 95-V<br>Nghìn/lít</td><td>25.05</td><td>--</td><td>--</td><td>--</td><td>29/05/2026</td></tr>
<tr><td>Xăng sinh học E5 RON 92-II<br>Nghìn/lít</td><td>22.48</td><td>--</td><td>--</td><td>--</td><td>04/09/2026</td></tr>
<tr><td>Xăng Diezen<br>Nghìn/lít</td><td>27.74</td><td>--</td><td>--</td><td>--</td><td>04/09/2026</td></tr>
</table>
`;

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
  assert.ok(rows.length >= 20);
  const heo = rows.find((r) => r.name === "Giá heo hơi trong nước");
  assert.ok(heo);
  assert.equal(heo.price, 57_833);
  assert.equal(heo.unit, "Đồng/kg");
  assert.equal(heo.dateTs, Date.parse("2026-09-04T00:00:00+07:00"));
  const nhom = rows.find((r) => r.name === "Nhôm Trung Quốc");
  assert.equal(nhom?.price, 24_373);
  assert.equal(nhom?.unit, "CNY/tấn");
});

test("mapVnbGoodsRows: phủ toàn bộ catalog key khớp + đơn vị/scale đúng (không quy đổi tiền tệ)", () => {
  const mapped = mapVnbGoodsRows(parseVnbGoodsRows(GOODS_HTML));
  const get = (k: string) => mapped.get(k);

  assert.equal(get("gold")?.price, 4_442.4);
  assert.equal(get("gold")?.unit, "USD/oz");
  assert.equal(get("sjc-gold")?.price, 147_600_000); // 147,600 nghìn đồng/lượng → VNĐ
  assert.equal(get("sjc-gold")?.unit, "VNĐ/Lượng");
  assert.equal(get("silver")?.price, 65.48);
  assert.equal(get("copper")?.price, 6.58);
  assert.equal(get("copper")?.unit, "USD/lb");

  assert.equal(get("aluminum")?.price, 24_373);
  assert.equal(get("aluminum")?.unit, "CNY/T");
  assert.equal(get("aluminum")?.currency, "CNY");
  assert.equal(get("zinc")?.price, 26_633);
  assert.equal(get("zinc")?.unit, "CNY/T");
  assert.equal(get("iron-ore")?.price, 718.89);
  assert.equal(get("iron-ore")?.unit, "CNY/T");
  assert.equal(get("nickel")?.price, 129_117);
  assert.equal(get("nickel")?.unit, "CNY/T");
  assert.equal(get("steel")?.price, 3_388);
  assert.equal(get("steel")?.unit, "CNY/T");

  assert.equal(get("urea")?.price, 443.25);
  assert.equal(get("coal")?.price, 2_125);
  assert.equal(get("wti")?.price, 91.22);
  assert.equal(get("natgas")?.price, 2.94);

  assert.equal(get("pig-vn")?.price, 57_833);
  assert.equal(get("shrimp-vn")?.price, 91.5); // 91,500 đồng/kg → nghìn đồng/kg
  assert.equal(get("gasoline-95")?.price, 25.05);
  assert.equal(get("gasoline-92")?.price, 22.48);
  assert.equal(get("diesel")?.price, 27.74);

  // provenance
  const src = get("aluminum")?.source ?? "";
  assert.match(src, /VietnamBiz Data/);
  assert.match(get("wti")?.url ?? "", /data\.vietnambiz\.vn\/goods/);
  assert.equal(get("aluminum")?.changePercent, null); // % Ngày hiện "--"
});

test("mapVnbGoodsRows: KHÔNG map những hàng đơn vị/nghĩa không khớp (không bịa)", () => {
  const mapped = mapVnbGoodsRows(parseVnbGoodsRows(GOODS_HTML));
  // hàng có mapping nhưng là sản phẩm khác → KHÔNG map
  assert.equal(mapped.has("coffee-robusta"), false); // "Giá cà phê trong nước" ≠ robusta USD/T
  assert.equal(mapped.has("rice"), false); // chưa có hạt gạo thế giới
  assert.equal(mapped.has("cotton"), false); // vải/sợi cotton ≠ futures CT
  assert.equal(mapped.has("sugar"), false); // đường USD/tấn ≠ SB USd/lb
  assert.equal(mapped.has("milk-wmp"), false);
  assert.equal(mapped.has("pangasius"), false);
  assert.equal(matchVnbGoods("Đồng Trung Quốc"), null); // không có key đồng TQ
});

test("VNB_GOODS_KEYS: chứa nhôm/kẽm (mục trước đây không nguồn) và không chứa mặt hàng không khớp", () => {
  assert.equal(VNB_GOODS_KEYS.has("aluminum"), true);
  assert.equal(VNB_GOODS_KEYS.has("zinc"), true);
  assert.equal(VNB_GOODS_KEYS.has("gold"), true);
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
const CSS_TEXT_BLOB =
  `.css-x19ppn{font-weight:800;line-height:1.5714285714285714;font-size:0.875rem;font-weight:500;color:inherit;},` +
  `where(.css-ls3dc0f)[class^="ant-typography"],where(.css-ls3dc0f)[class^="ant-typography"]{` +
  `font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",` +
  `sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji";font-size:14px;box-sizing:border-box;},` +
  `where(.css-ls3dc0f)[class^="ant-typography"]:before,where(.css-ls3dc0f)[class^="ant-typography"]:after{box-sizing:border-box;},` +
  `where(.css-ls3dc0f)[class^="ant-typography"]:before,where(.css-ls3dc0f)[class^="ant-typography"]:after{content:"";}`;

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
