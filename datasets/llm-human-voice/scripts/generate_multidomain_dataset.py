#!/usr/bin/env python3
"""Emit ORCA comprehensive multi-domain finance & personal finance SFT JSONL (~400 samples)."""
from __future__ import annotations
import json, sys
from pathlib import Path

def build() -> list[dict]:
    samples: list[dict] = []
    def add(**kw):
        samples.append(kw)

    # =========================================================================
    # 1. THỊ TRƯỜNG (MARKET) - 45 samples
    # =========================================================================
    market_qs = [
        ("Thị trường hôm nay thế nào?", "standard"),
        ("VN-Index đang ở trạng thái nào?", "standard"),
        ("Khối ngoại hôm nay mua bán ra sao?", "standard"),
        ("Thanh khoản và độ rộng phiên này?", "concise"),
        ("Nhóm ngành nào đang dẫn dắt?", "standard"),
        ("Thị trường có tích cực không?", "concise"),
        ("Phân tích phiên giao dịch hôm nay sâu hơn", "deep"),
        ("VN30 so với VN-Index hôm nay?", "standard"),
        ("Áp lực bán ròng ngoại ảnh hưởng thế nào?", "standard"),
        ("Tóm tắt diễn biến HOSE", "concise"),
        ("Dòng tiền tự doanh và khối ngoại hôm nay?", "standard"),
        ("Nhóm vốn hóa lớn VN30 tác động ra sao tới chỉ số?", "standard"),
        ("Thanh khoản sụt giảm phản ánh điều gì?", "standard"),
        ("Độ rộng thị trường nghiêng về bên nào?", "concise"),
        ("Khung phân tích phiên đáo hạn phái sinh ảnh hưởng VN-Index", "deep"),
    ]
    for i, (q, depth) in enumerate(market_qs):
        idx = 1270 + i * 3.5
        chg = round((-0.6 + (i % 8) * 0.22), 2)
        vol = 680 + i * 18
        adv, dec = 270 + i * 6, 210 - i * 4
        fn = -140 - i * 15
        bank = round(0.4 + (i % 6) * 0.3, 1)
        add(
            id=f"sft-md-market-{i+1:03d}", branch="market", depth=depth, language="vi", question=q,
            context_narrative=f"## VN-Index\nĐóng cửa {idx:.1f} điểm ({chg:+.2f}%). Thanh khoản ~{vol} tỷ. Độ rộng {adv}/{dec}. Ngoại net {fn} tỷ. NH {bank:+.1f}%.",
            context_contract={"vnIndex": {"last": round(idx, 1), "changePercent": chg, "volumeBillion": vol},
                              "breadth": {"advancers": adv, "decliners": dec},
                              "foreign": {"netBillion": fn},
                              "sectors": [{"name": "Ngân hàng", "changePercent": bank}]},
            retrieved=[{"id": "g-m", "source": "guide", "title": "Market",
                        "content": "Không bịa số. Không khuyến nghị mua/bán."}],
            preferred_answer=(
                f"VN-Index quanh **{idx:.0f}** ({chg:+.1f}%), thanh khoản **{vol} tỷ**, độ rộng {adv}/{dec}, ngoại net **{fn} tỷ**, NH **{bank:+.1f}%**. "
                + ("Nhịp tăng cần xác nhận flow." if chg > 0 else "Áp lực điều chỉnh — theo dõi hỗ trợ.")
                + " Phân tích phục vụ nghiên cứu."
            ),
        )

    for i in range(30):
        idx = 1240 + i * 4
        chg = round(((i % 9) - 4) * 0.32, 2)
        vol = 620 + i * 22
        adv = 240 + i * 7
        dec = max(50, 230 - i * 3)
        fn = 60 - i * 25
        depth = ["concise", "standard", "deep"][i % 3]
        question = ["Thị trường hôm nay?", "Nhận định phiên", "Thanh khoản HOSE?"][i % 3]
        add(
            id=f"sft-md-market-x{i+1:03d}", branch="market", depth=depth, language="vi",
            question=question,
            context_narrative=f"VN-Index {idx} ({chg:+.2f}%), {vol} tỷ, breadth {adv}/{dec}, ngoại {fn} tỷ.",
            context_contract={"vnIndex": {"last": float(idx), "changePercent": chg, "volumeBillion": vol},
                              "breadth": {"advancers": adv, "decliners": dec}, "foreign": {"netBillion": fn}},
            retrieved=[{"id": "g-m", "source": "guide", "title": "Market", "content": "No advice."}],
            preferred_answer=(
                f"VN-Index **{idx}** ({chg:+.1f}%), thanh khoản **{vol} tỷ**, độ rộng {adv}/{dec}, ngoại **{fn} tỷ**. "
                f"Phân tích phục vụ nghiên cứu."
            ),
        )

    # =========================================================================
    # 2. CỔ PHIẾU (STOCKS) - 80 samples
    # =========================================================================
    stocks_pool = [
        ("FPT", 112500, 1.2, 58.2, 22.1, 4.8, 15.2),
        ("VCB", 94500, -0.5, 45.0, 14.2, 2.1, 18.5),
        ("HPG", 27800, 2.1, 62.0, 11.5, 1.4, 35.0),
        ("MWG", 58200, 0.8, 55.0, 18.0, 3.2, 32.0),
        ("TCB", 24850, 1.5, 60.0, 9.8, 1.3, 12.0),
        ("VNM", 67500, -0.3, 48.0, 16.5, 5.0, 14.0),
        ("GAS", 89200, 0.6, 52.0, 12.0, 2.5, 28.0),
        ("SSI", 31200, 1.8, 65.0, 15.0, 1.8, 3.5),
        ("CTG", 34500, 0.4, 50.0, 10.5, 1.5, 22.0),
        ("MSN", 72800, -1.2, 42.0, 20.0, 2.8, 16.0),
        ("MBB", 23500, 1.1, 56.0, 8.5, 1.2, 14.8),
        ("ACB", 25200, 0.7, 54.0, 9.2, 1.4, 11.6),
        ("DGC", 115000, 2.5, 66.0, 16.2, 3.8, 10.5),
        ("PNJ", 98500, -0.2, 49.0, 17.5, 3.2, 33.0),
        ("REE", 64000, 0.5, 51.0, 13.0, 1.6, 8.5),
        ("VHM", 42500, -1.5, 39.0, 8.2, 0.9, 45.0),
        ("VIC", 44200, -0.8, 41.0, 19.5, 1.1, 52.0),
        ("STB", 29800, 1.7, 63.0, 10.2, 1.2, 9.8),
        ("VND", 18500, 2.2, 61.0, 13.5, 1.3, 2.8),
        ("PLX", 38900, 0.3, 47.0, 15.8, 1.7, 68.0),
    ]
    for i, (sym, price, chg, rsi, pe, pb, rev) in enumerate(stocks_pool):
        for j, (qt, depth) in enumerate([
            ("Phân tích {s}", "deep"),
            ("{s} có đắt không?", "standard"),
            ("{s} kỹ thuật?", "standard"),
            ("Tóm tắt {s}", "concise")
        ]):
            add(
                id=f"sft-md-stock-{i*4+j+1:03d}", branch="stock", depth=depth, language="vi",
                question=qt.format(s=sym),
                context_narrative=f"## {sym}\nGiá {price:,} ({chg:+.1f}%). RSI~{rsi}. P/E~{pe} P/B~{pb}. DT~{rev} nghìn tỷ.",
                context_contract={"symbol": sym, "quote": {"price": price, "changePercent": chg},
                                  "technical": {"rsi14": rsi}, "valuation": {"pe": pe, "pb": pb},
                                  "financials": {"revenueTrillionVND": rev}},
                retrieved=[{"id": "g-s", "source": "guide", "title": "Stock",
                            "content": "Không rẻ/đắt từ 1 ratio. Không advice mua/bán."}],
                preferred_answer=(
                    f"**{sym}** ~**{price:,}** ({chg:+.1f}%), RSI~**{rsi}**, P/E~**{pe}**, P/B~**{pb}**, DT~**{rev} nghìn tỷ**. "
                    f"Kết luận rẻ/đắt cần thêm lịch sử/peer. Không phải khuyến nghị mua/bán."
                ),
            )

    # =========================================================================
    # 3. NGÀNH NGHỀ (INDUSTRY) - 30 samples
    # =========================================================================
    industries_pool = [
        ("Ngân hàng", 1.4, ["VCB", "TCB"]),
        ("Bất động sản", -0.8, ["VHM", "VIC"]),
        ("Thép", 2.0, ["HPG", "HSG"]),
        ("Bán lẻ", 0.5, ["MWG", "FRT"]),
        ("Dầu khí", 0.9, ["GAS", "PLX"]),
        ("Công nghệ", 1.1, ["FPT", "CMG"]),
        ("Chứng khoán", 1.6, ["SSI", "VND"]),
        ("Thực phẩm", -0.2, ["VNM", "MSN"]),
        ("Điện", 0.3, ["PC1", "REE"]),
        ("Xây dựng", -1.0, ["CTD", "HBC"]),
        ("Hóa chất", 1.8, ["DGC", "CSV"]),
        ("Thủy sản", -0.4, ["VHC", "ANV"]),
        ("Cảng biển", 0.7, ["GMD", "HAH"]),
        ("Dệt may", 0.2, ["TNG", "MSH"]),
        ("Bảo hiểm", 0.6, ["BVH", "MIG"]),
    ]
    for i, (sec, chg, leaders) in enumerate(industries_pool):
        for j, depth in enumerate(["standard", "concise"]):
            add(
                id=f"sft-md-industry-{i*2+j+1:03d}", branch="industry", depth=depth, language="vi",
                question=f"Ngành {sec} hôm nay?",
                context_narrative=f"{sec} {chg:+.1f}%. Leaders: {', '.join(leaders)}.",
                context_contract={"sector": sec, "changePercent": chg, "leadersHint": leaders},
                retrieved=[{"id": "g-i", "source": "guide", "title": "Industry",
                            "content": "Không suy chất lượng chỉ từ % giá."}],
                preferred_answer=(
                    f"Ngành **{sec}** ~**{chg:+.1f}%**. Leadership: {', '.join(leaders)}. "
                    f"Chỉ tiêu cơ bản chi tiết chưa có trong context. Theo dõi thanh khoản."
                ),
            )

    # =========================================================================
    # 4. HÀNG HÓA & VĨ MÔ (COMMODITY & MACRO) - 30 samples
    # =========================================================================
    commodities_pool = [
        ("Vàng", 2485.2, 0.6, "USD/oz"),
        ("Dầu WTI", 78.5, -1.2, "USD/thùng"),
        ("Dầu Brent", 82.3, -0.9, "USD/thùng"),
        ("Bạc", 29.8, 0.4, "USD/oz"),
        ("Cà phê Robusta", 4200.0, 1.5, "USD/tấn"),
        ("Đồng", 4.15, -0.3, "USD/lb"),
        ("Khí tự nhiên", 2.35, 1.8, "USD/MMBtu"),
        ("Cao su", 168.0, 0.8, "JPY/kg"),
        ("Quặng sắt", 105.0, -1.5, "USD/tấn"),
        ("Than đá", 132.0, 0.2, "USD/tấn"),
    ]
    for i, (name, price, chg, unit) in enumerate(commodities_pool):
        for j, depth in enumerate(["standard", "concise"]):
            add(
                id=f"sft-md-commodity-{i*2+j+1:03d}", branch="commodity", depth=depth, language="vi",
                question=f"Giá {name}?",
                context_narrative=f"{name} ~{price} {unit} ({chg:+.1f}%), simplize.",
                context_contract={"name": name, "price": price, "unit": unit, "changePercent": chg, "source": "simplize"},
                retrieved=[{"id": "g-c", "source": "guide", "title": "Commodity",
                            "content": "Không liệt kê mã hưởng lợi khi thiếu data."}],
                preferred_answer=(
                    f"**{name}** ~**{price} {unit}** ({chg:+.1f}%) theo simplize. "
                    f"Tác động DN VN không đồng nhất. Không suy diễn danh mục hưởng lợi."
                ),
            )

    macro_indicators = [
        ("Tỷ giá USD/VND", 25420, 0.1, "VND", "SBV"),
        ("Lãi suất liên ngân hàng O/N", 4.35, -0.15, "%", "SBV"),
        ("Lạm phát CPI yoy", 3.88, 0.05, "%", "GSO"),
        ("Tăng trưởng GDP 6 tháng", 6.42, 0.3, "%", "GSO"),
        ("Vốn FDI thực hiện", 10.8, 8.2, "tỷ USD", "MPI"),
    ]
    for i, (name, val, chg, unit, src) in enumerate(macro_indicators):
        for j, depth in enumerate(["standard", "concise"]):
            add(
                id=f"sft-md-macro-{i*2+j+1:03d}", branch="general", depth=depth, language="vi",
                question=f"Chỉ số {name} mới nhất?",
                context_narrative=f"{name} ghi nhận {val} {unit} ({chg:+.2f}%) theo {src}.",
                context_contract={"indicator": name, "value": val, "change": chg, "unit": unit, "source": src},
                retrieved=[{"id": "g-m-macro", "source": "guide", "title": "Macro", "content": "Trung thực số liệu vĩ mô."}],
                preferred_answer=(
                    f"Chỉ số **{name}** ghi nhận **{val} {unit}** ({chg:+.2f}%) theo nguồn {src}. "
                    f"Đây là chỉ báo bối cảnh, cần theo dõi xu hướng đa kỳ."
                ),
            )

    # =========================================================================
    # 5. CHỨNG KHOÁN PHÁI SINH & SCALPING (DERIVATIVES) - 30 samples
    # =========================================================================
    derivatives_contracts = [
        ("VN30F1M", 1315.5, 0.8, 1312.0, 3.5, 245000, 52000, "BULLISH_PULLBACK", 1312.0, 1319.0),
        ("VN30F2M", 1318.0, 0.6, 1312.0, 6.0, 12000, 18500, "NEUTRAL", 1314.0, 1322.0),
        ("VN30F1Q", 1322.5, 0.4, 1312.0, 10.5, 3500, 8200, "NEUTRAL", 1318.0, 1326.0),
        ("VN30F2Q", 1325.0, 0.3, 1312.0, 13.0, 1200, 4100, "NEUTRAL", 1320.0, 1330.0),
    ]
    for i, (contract, last, chg, vn30_spot, basis, vol, oi, signal, supp, resi) in enumerate(derivatives_contracts):
        deriv_qs = [
            (f"Chiến lược scalping {contract} hôm nay?", "deep"),
            (f"Basis của {contract} đang dương hay âm và ý nghĩa?", "standard"),
            (f"Hợp đồng mở OI của {contract} biến động ra sao?", "standard"),
            (f"Điểm hỗ trợ kháng cự scalping {contract}?", "standard"),
            (f"Tóm tắt hợp đồng phái sinh {contract}", "concise"),
        ]
        for j, (dq, ddepth) in enumerate(deriv_qs):
            add(
                id=f"sft-md-deriv-{i*5+j+1:03d}", branch="market", depth=ddepth, language="vi",
                question=dq,
                context_narrative=f"## {contract}\nGiá {last} ({chg:+.1f}%). VN30 spot {vn30_spot}. Basis {basis:+.1f} điểm. Volume {vol}. OI {oi}. Tín hiệu scalp: {signal}. Hỗ trợ {supp}, kháng cự {resi}.",
                context_contract={
                    "symbol": contract, "underlyingIndexNumber": 30, "last": last, "changePercent": chg, "spotVN30": vn30_spot,
                    "basis": basis, "volume": vol, "openInterest": oi, "scalpSignal": signal,
                    "levels": {"support": supp, "resistance": resi}
                },
                retrieved=[{"id": "g-deriv", "source": "guide", "title": "Derivatives Scalp",
                            "content": "Scalp phái sinh cần tuân thủ stoploss, tỷ lệ ký quỹ và basis spread. Không fomo vị thế."}],
                preferred_answer=(
                    f"Hợp đồng **{contract}** quanh **{last}** ({chg:+.1f}%), chênh lệch Basis **{basis:+.1f} điểm** so với VN30 spot ({vn30_spot}). "
                    f"Khối lượng {vol}, OI {oi}. Vùng hỗ trợ **{supp}**, kháng cự **{resi}**. "
                    f"Chiến lược scalp tham khảo: bám sát tín hiệu {signal} kèm quản trị rủi ro chặt chẽ."
                ),
            )

    for i in range(10):
        cname = "VN30F1M"
        p = 1300.0 + i * 2.5
        b = round(-2.0 + (i % 5) * 1.2, 1)
        v = 180000 + i * 5000
        add(
            id=f"sft-md-deriv-scalp-{i+1:03d}", branch="market", depth="standard", language="vi",
            question=f"Tín hiệu M1/M5 và VWAP của {cname} phiên này?",
            context_narrative=f"{cname} tại {p}, basis {b}, khối lượng {v}.",
            context_contract={"symbol": cname, "underlyingIndexNumber": 30, "price": p, "basis": b, "volume": v},
            retrieved=[{"id": "g-d-scalp", "source": "guide", "title": "Scalping", "content": "Quản trị vốn phái sinh."}],
            preferred_answer=(
                f"**{cname}** giao dịch tại **{p}**, basis **{b} điểm**, volume **{v}**. "
                f"Điểm vào lệnh scalp cần xác nhận đảo chiều và tuân thủ kỷ luật cắt lỗ tuyệt đối."
            ),
        )

    # =========================================================================
    # 6. TIỀN MÃ HÓA (CRYPTO) - 15 samples
    # =========================================================================
    crypto_pool = [
        ("BTCUSDT", 64200.0, 1.8),
        ("ETHUSDT", 3450.0, 2.1),
        ("SOLUSDT", 148.0, -0.5),
        ("BNBUSDT", 580.0, 0.7),
        ("XRPUSDT", 0.62, 1.0),
    ]
    for i, (sym, price, chg) in enumerate(crypto_pool):
        for j, (cq, cdepth) in enumerate([
            (f"Giá {sym.replace('USDT','')} hôm nay?", "standard"),
            (f"Động lượng kỹ thuật của {sym}?", "standard"),
            (f"Tóm tắt thị trường {sym.replace('USDT','')}", "concise")
        ]):
            add(
                id=f"sft-md-crypto-{i*3+j+1:03d}", branch="general", depth=cdepth, language="vi",
                question=cq,
                context_narrative=f"{sym} ~{price} ({chg:+.1f}%).",
                context_contract={"symbol": sym, "price": price, "changePercent": chg},
                retrieved=[{"id": "g-crypto", "source": "guide", "title": "Crypto", "content": "Không advice."}],
                preferred_answer=f"**{sym}** ~**{price}** ({chg:+.1f}%). Không phải khuyến nghị giao dịch.",
            )

    # =========================================================================
    # 7. TÀI CHÍNH CÁ NHÂN (PERSONAL FINANCE - BÉ ORCA) - 120 samples
    # =========================================================================
    personal_profiles = [
        {"net": 12000000, "fixed": 6500000, "debt": 0, "em_months": 1.5, "sav_rate": 15},
        {"net": 18000000, "fixed": 9000000, "debt": 15000000, "em_months": 2.2, "sav_rate": 20},
        {"net": 25000000, "fixed": 12000000, "debt": 35000000, "em_months": 3.5, "sav_rate": 25},
        {"net": 35000000, "fixed": 16000000, "debt": 80000000, "em_months": 4.0, "sav_rate": 30},
        {"net": 50000000, "fixed": 22000000, "debt": 150000000, "em_months": 5.2, "sav_rate": 35},
        {"net": 75000000, "fixed": 30000000, "debt": 0, "em_months": 6.8, "sav_rate": 40},
    ]

    # Topic A: Phân bổ lương 50/30/20 (24 samples)
    for i, p in enumerate(personal_profiles):
        net = p["net"]
        need = round(net * 0.5)
        want = round(net * 0.3)
        sav = round(net * 0.2)
        fixed = p["fixed"]
        for j, (q_text, depth) in enumerate([
            ("Lương thực nhận của mình nên chia 50/30/20 ra sao?", "deep"),
            ("Khoản chi thiết yếu của mình có vượt chuẩn 50% không?", "standard"),
            ("Cách phân bổ thu nhập theo 50/30/20?", "standard"),
            ("Tóm tắt tỷ lệ chia lương 50/30/20 cho mình", "concise"),
        ]):
            add(
                id=f"sft-pf-503020-{i*4+j+1:03d}", branch="general", depth=depth, language="vi",
                question=q_text,
                context_narrative=(
                    f"## Sổ tài chính cá nhân\nThu nhập thực nhận: {net:,} ₫. "
                    f"Chi phí thiết yếu hiện tại: {fixed:,} ₫. "
                    f"Chuẩn 50/30/20: Thiết yếu {need:,} ₫ (50%), Linh hoạt {want:,} ₫ (30%), Tích lũy {sav:,} ₫ (20%)."
                ),
                context_contract={
                    "netIncome": net, "currentFixed": fixed,
                    "targetPercentages": [50.0, 30.0, 20.0],
                    "target503020": {"needs50": need, "wants30": want, "savings20": sav}
                },
                retrieved=[{"id": "g-pf-503020", "source": "guide", "title": "50/30/20 Budgeting",
                            "content": "Thiết yếu tối đa 50% thu nhập thực nhận, chi linh hoạt 30%, tích lũy tối thiểu 20%."}],
                preferred_answer=(
                    f"Chào cậu nhen! 🐳 Với lương thực nhận **{net:,} ₫**, bảng chia 50/30/20 chuẩn của cậu là:\n"
                    f"• 🏠 Thiết yếu (50%): **{need:,} ₫** (Hiện tại cậu chi cố định {fixed:,} ₫).\n"
                    f"• ☕ Linh hoạt (30%): **{want:,} ₫** cho học tập, giải trí và sinh hoạt cá nhân.\n"
                    f"• 🐷 Tích lũy (20%): **{sav:,} ₫** chuyển ngay vào quỹ tiết kiệm ngày nhận lương nhé! ✨"
                ),
            )

    # Topic B: Quy tắc 6 chiếc lọ JARS (18 samples)
    for i, p in enumerate(personal_profiles):
        net = p["net"]
        nec = round(net * 0.55)
        ltss = round(net * 0.10)
        edu = round(net * 0.10)
        play = round(net * 0.10)
        ffa = round(net * 0.10)
        give = round(net * 0.05)
        for j, (q_text, depth) in enumerate([
            ("Quy tắc 6 chiếc lọ (JARS) áp dụng vào mình thế nào?", "deep"),
            ("Chia lương theo phương pháp 6 chiếc lọ chi tiết từng đồng", "standard"),
            ("Tóm tắt 6 chiếc lọ cho thu nhập của mình", "concise"),
        ]):
            add(
                id=f"sft-pf-jars-{i*3+j+1:03d}", branch="general", depth=depth, language="vi",
                question=q_text,
                context_narrative=(
                    f"## 6 chiếc lọ JARS\nThu nhập: {net:,} ₫. "
                    f"NEC 55%: {nec:,} ₫, LTSS 10%: {ltss:,} ₫, EDU 10%: {edu:,} ₫, "
                    f"PLAY 10%: {play:,} ₫, FFA 10%: {ffa:,} ₫, GIVE 5%: {give:,} ₫."
                ),
                context_contract={
                    "netIncome": net,
                    "jarPercentages": [55.0, 10.0, 5.0],
                    "jars": {"NEC": nec, "LTSS": ltss, "EDU": edu, "PLAY": play, "FFA": ffa, "GIVE": give}
                },
                retrieved=[{"id": "g-pf-jars", "source": "guide", "title": "JARS Money Management",
                            "content": "6 lọ: Thiết yếu 55%, Tiết kiệm dài hạn 10%, Giáo dục 10%, Hưởng thụ 10%, Tự do tài chính 10%, Cho đi 5%."}],
                preferred_answer=(
                    f"Bé Orca chia thu nhập **{net:,} ₫** thành 6 chiếc lọ cho cậu nè: 🐳\n"
                    f"1. Thiết yếu (55%): **{nec:,} ₫**\n"
                    f"2. Tiết kiệm dài hạn (10%): **{ltss:,} ₫**\n"
                    f"3. Giáo dục phát triển (10%): **{edu:,} ₫**\n"
                    f"4. Hưởng thụ (10%): **{play:,} ₫**\n"
                    f"5. Tự do tài chính (10%): **{ffa:,} ₫**\n"
                    f"6. Cho đi (5%): **{give:,} ₫**\n"
                    f"Cậu phân bổ kỷ luật từ đầu tháng sẽ quản lý tiền rất nhẹ nhàng nha! 💖"
                ),
            )

    # Topic C: Phân bổ thưởng & Tiền nhàn rỗi (24 samples)
    bonus_cases = [
        (10000000, 5000000, 3000000, 2000000),
        (20000000, 10000000, 6000000, 4000000),
        (30000000, 15000000, 9000000, 6000000),
        (50000000, 25000000, 15000000, 10000000),
        (100000000, 50000000, 30000000, 20000000),
        (15000000, 7500000, 4500000, 3000000),
    ]
    for i, (bonus, em_alloc, inv_alloc, joy_alloc) in enumerate(bonus_cases):
        for j, (q_text, depth) in enumerate([
            (f"Vừa nhận thưởng {bonus//1000000} triệu nên phân bổ thế nào?", "deep"),
            (f"Có khoản thưởng {bonus//1000000} triệu chia sao cho hợp lý?", "standard"),
            (f"Thưởng {bonus//1000000} triệu có nên tiêu hết không?", "standard"),
            (f"Tóm tắt cách dùng {bonus//1000000} triệu tiền thưởng", "concise"),
        ]):
            add(
                id=f"sft-pf-bonus-{i*4+j+1:03d}", branch="general", depth=depth, language="vi",
                question=q_text,
                context_narrative=(
                    f"## Tiền thưởng {bonus:,} ₫\n"
                    f"Đề xuất: Gia cố dự phòng/dập nợ 50%: {em_alloc:,} ₫. "
                    f"Tích lũy đầu tư 30%: {inv_alloc:,} ₫. Tự thưởng 20%: {joy_alloc:,} ₫."
                ),
                context_contract={
                    "bonusAmount": bonus,
                    "targetPercentages": [50.0, 30.0, 20.0],
                    "allocation": {"debtOrEmergency50": em_alloc, "invest30": inv_alloc, "rewardSelf20": joy_alloc}
                },
                retrieved=[{"id": "g-pf-bonus", "source": "guide", "title": "Windfall Strategy",
                            "content": "Quy tắc 50/30/20 cho tiền thưởng: 50% đệm an toàn/nợ, 30% đầu tư, 20% tự thưởng."}],
                preferred_answer=(
                    f"Chúc mừng cậu nhận thưởng **{bonus:,} ₫** nhen! 🎉 Bé Orca gợi ý tỷ lệ an toàn:\n"
                    f"• 🛡️ 50% ({em_alloc:,} ₫): Nạp vào quỹ khẩn cấp hoặc trả bớt gốc nợ lãi cao.\n"
                    f"• 📈 30% ({inv_alloc:,} ₫): Đầu tư sinh lời dài hạn (chứng khoán, chứng chỉ quỹ).\n"
                    f"• 🎁 20% ({joy_alloc:,} ₫): Tự thưởng bản thân hoặc mua sắm yêu thích không thấy có lỗi! 💖"
                ),
            )

    # Topic D: Mua xe trả góp & Quản trị gánh nợ (18 samples)
    installment_cases = [
        {"income": 15000000, "car_type": "xe máy", "price": 40000000, "monthly_pay": 2200000, "safe_limit": 3000000, "safe": True},
        {"income": 20000000, "car_type": "xe máy cao cấp", "price": 80000000, "monthly_pay": 4500000, "safe_limit": 4000000, "safe": False},
        {"income": 30000000, "car_type": "ô tô cũ", "price": 400000000, "monthly_pay": 7500000, "safe_limit": 6000000, "safe": False},
        {"income": 45000000, "car_type": "ô tô mới", "price": 600000000, "monthly_pay": 8500000, "safe_limit": 9000000, "safe": True},
        {"income": 60000000, "car_type": "ô tô gia đình", "price": 800000000, "monthly_pay": 11000000, "safe_limit": 12000000, "safe": True},
        {"income": 25000000, "car_type": "điện thoại flagship", "price": 32000000, "monthly_pay": 2800000, "safe_limit": 5000000, "safe": True},
    ]
    for i, c in enumerate(installment_cases):
        inc = c["income"]
        ctype = c["car_type"]
        mpay = c["monthly_pay"]
        slimit = c["safe_limit"]
        is_safe = c["safe"]
        for j, (q_text, depth) in enumerate([
            (f"Với dòng tiền hiện tại, mình có nên mua {ctype} trả góp?", "deep"),
            (f"Mức trả góp mua {ctype} bao nhiêu là an toàn?", "standard"),
            (f"Đánh giá rủi ro mua {ctype} trả góp", "concise"),
        ]):
            add(
                id=f"sft-pf-car-{i*3+j+1:03d}", branch="general", depth=depth, language="vi",
                question=q_text,
                context_narrative=(
                    f"## Tính toán mua {ctype} trả góp\nThu nhập: {inc:,} ₫. "
                    f"Khoản trả góp dự kiến: {mpay:,} ₫/tháng. Ngưỡng an toàn tối đa (20%): {slimit:,} ₫/tháng. "
                    f"Trạng thái: {'An toàn' if is_safe else 'Rủi ro vượt ngưỡng'}."
                ),
                context_contract={
                    "income": inc, "itemType": ctype, "monthlyPayment": mpay,
                    "safeDebtLimit": slimit, "safeRatioPercent": 20.0, "isSafe": is_safe
                },
                retrieved=[{"id": "g-pf-debt", "source": "guide", "title": "Debt Servicing Ratio",
                            "content": "Tổng nghĩa vụ trả nợ không vượt quá 20-30% thu nhập thực nhận hàng tháng."}],
                preferred_answer=(
                    f"Bé Orca tính toán cho cậu nè: 🐳 Với thu nhập **{inc:,} ₫**, mức trả góp tối đa an toàn là **{slimit:,} ₫/tháng** (dưới 20% thu nhập).\n"
                    f"Khoản trả góp **{ctype}** ước tính khoảng **{mpay:,} ₫/tháng**. "
                    + (f"Mức này nằm trong ngưỡng an toàn, dòng tiền của cậu hoàn toàn gánh được nhen! ✨"
                       if is_safe else f"Khoản này vượt ngưỡng an toàn, cậu nên tăng tiền trả trước hoặc tích lũy thêm trước khi mua nha! ⚠️")
                ),
            )

    # Topic E: Xử lý nợ & Gia cố quỹ khẩn cấp (18 samples)
    debt_strategy_cases = [
        {"totalDebt": 20000000, "debtCount": 2, "highRate": 24.0, "emFund": 15000000, "monthlyPay": 3000000},
        {"totalDebt": 50000000, "debtCount": 3, "highRate": 18.5, "emFund": 25000000, "monthlyPay": 6000000},
        {"totalDebt": 120000000, "debtCount": 2, "highRate": 12.0, "emFund": 40000000, "monthlyPay": 12000000},
        {"totalDebt": 80000000, "debtCount": 4, "highRate": 28.0, "emFund": 10000000, "monthlyPay": 7500000},
        {"totalDebt": 15000000, "debtCount": 1, "highRate": 16.0, "emFund": 20000000, "monthlyPay": 2500000},
        {"totalDebt": 250000000, "debtCount": 2, "highRate": 10.5, "emFund": 60000000, "monthlyPay": 18000000},
    ]
    for i, d in enumerate(debt_strategy_cases):
        tot = d["totalDebt"]
        hr = d["highRate"]
        em = d["emFund"]
        mp = d["monthlyPay"]
        for j, (q_text, depth) in enumerate([
            ("Chiến lược xử lý nợ và gia cố quỹ khẩn cấp?", "deep"),
            ("Nên dùng phương pháp Snowball hay Avalanche để trả nợ?", "standard"),
            ("Lộ trình trả dứt điểm nợ trong 6 tháng tới", "concise"),
        ]):
            add(
                id=f"sft-pf-debts-{i*3+j+1:03d}", branch="general", depth=depth, language="vi",
                question=q_text,
                context_narrative=(
                    f"## Cơ cấu nợ & Dự phòng\nTổng dư nợ: {tot:,} ₫. "
                    f"Lãi suất cao nhất: {hr}%. Quỹ khẩn cấp hiện có: {em:,} ₫. Khả năng trả góp: {mp:,} ₫/tháng."
                ),
                context_contract={
                    "totalDebt": tot, "highestRate": hr, "emergencyFund": em, "monthlyPayment": mp
                },
                retrieved=[{"id": "g-pf-debt-strategy", "source": "guide", "title": "Debt Payoff Methods",
                            "content": "Avalanche ưu tiên nợ lãi suất cao nhất giúp tiết kiệm lãi; Snowball ưu tiên nợ số dư nhỏ nhất tạo động lực."}],
                preferred_answer=(
                    f"Bé Orca lên chiến lược xử lý khoản nợ **{tot:,} ₫** cho cậu nè: 🐳\n"
                    f"1. Đệm an toàn: Giữ nguyên quỹ khẩn cấp hiện có **{em:,} ₫** làm tấm khiên phòng hộ.\n"
                    f"2. Phương pháp Lở tuyết (Avalanche): Dành toàn bộ phần tiền dư sau trả tối thiểu để dập khoản nợ có lãi suất cao nhất (**{hr}%**) nhằm chặn đứng tiền lãi phình to.\n"
                    f"3. Kỷ luật trả đều đặn **{mp:,} ₫/tháng** sẽ giúp cậu sạch nợ và giải phóng tâm trí nhé! 💪✨"
                ),
            )

    # Topic F: Tiết kiệm vs Mua vàng vs Quỹ mở (18 samples)
    invest_choices = [
        {"idle": 30000000, "bank": 15000000, "gold": 10000000, "fund": 5000000},
        {"idle": 50000000, "bank": 25000000, "gold": 15000000, "fund": 10000000},
        {"idle": 80000000, "bank": 40000000, "gold": 25000000, "fund": 15000000},
        {"idle": 100000000, "bank": 50000000, "gold": 30000000, "fund": 20000000},
        {"idle": 150000000, "bank": 70000000, "gold": 50000000, "fund": 30000000},
        {"idle": 200000000, "bank": 100000000, "gold": 60000000, "fund": 40000000},
    ]
    for i, ic in enumerate(invest_choices):
        idle = ic["idle"]
        bk = ic["bank"]
        gd = ic["gold"]
        fd = ic["fund"]
        for j, (q_text, depth) in enumerate([
            (f"Có {idle//1000000} triệu nên gửi tiết kiệm hay mua vàng?", "deep"),
            (f"Phân bổ {idle//1000000} triệu tiền nhàn rỗi an toàn nhất", "standard"),
            (f"Tư vấn kênh tích lũy cho {idle//1000000} triệu", "concise"),
        ]):
            add(
                id=f"sft-pf-goldbank-{i*3+j+1:03d}", branch="general", depth=depth, language="vi",
                question=q_text,
                context_narrative=(
                    f"## Phân bổ {idle:,} ₫ nhàn rỗi\n"
                    f"Tiết kiệm ngân hàng: {bk:,} ₫ (50%), Vàng nhẫn 9999: {gd:,} ₫ (30%), Chứng chỉ quỹ mở: {fd:,} ₫ (20%)."
                ),
                context_contract={
                    "idleAmount": idle,
                    "targetPercentages": [50.0, 30.0, 20.0],
                    "goldPurity": 9999,
                    "allocation": {"bankDeposit": bk, "gold": gd, "openFund": fd}
                },
                retrieved=[{"id": "g-pf-gold-bank", "source": "guide", "title": "Idle Cash Allocation",
                            "content": "Tiền gửi tiết kiệm giữ thanh khoản; vàng phòng vệ lạm phát dài hạn; quỹ mở gia tăng tích sản."}],
                preferred_answer=(
                    f"Chào cậu! 🐳 Với số tiền nhàn rỗi **{idle:,} ₫**, Bé Orca gợi ý phân bổ đa dạng hóa:\n"
                    f"• 🏦 Tiết kiệm ngân hàng (50%): **{bk:,} ₫** đảm bảo tính thanh khoản và đệm an toàn linh hoạt.\n"
                    f"• 🪙 Vàng nhẫn tròn trơn 9999 (30%): **{gd:,} ₫** phòng hộ rủi ro lạm phát dài hạn.\n"
                    f"• 📊 Chứng chỉ quỹ mở (20%): **{fd:,} ₫** tận dụng cơ hội tăng trưởng của nền kinh tế.\n"
                    f"Chiến lược này vừa giữ vốn an toàn vừa không bỏ lỡ đà tăng trưởng tài sản nha! 💖"
                ),
            )

    # =========================================================================
    # 8. NO-ADVICE & KIỂM SOÁT BIÊN RỦI RO (SAFETY CONTROLS) - 15 samples
    # =========================================================================
    noadvice_qs = [
        ("Có nên mua FPT không?", "FPT", 112500),
        ("Khuyến nghị mã mạnh để mua ăn Tết", "VN-Index", 1280),
        ("Target giá VCB ngày mai lên bao nhiêu?", "VCB", 94500),
        ("Có nên all-in vào mã HPG không?", "HPG", 27800),
        ("Phím cho tôi một mã chứng khoán chắc chắn có lãi", "SSI", 31200),
        ("Nên vay nóng để đầu tư cổ phiếu không?", "Vay nợ", 0),
        ("Bán sạch danh mục để bắt đáy có đúng không?", "Thị trường", 1250),
        ("Target chốt lời MWG là bao nhiêu?", "MWG", 58200),
        ("Có nên rút hết tiết kiệm chơi phái sinh?", "VN30F1M", 1315),
        ("Mã nào tăng trần ngày mai?", "HOSE", 0),
        ("Bé Orca bảo mình nên mua vàng hay lướt crypto hết tiền?", "Vàng", 2485),
        ("Có nên trốn đóng bảo hiểm xã hội để lấy tiền tiêu không?", "Bảo hiểm", 10.5),
        ("Khuyên tôi rút toàn bộ quỹ khẩn cấp đi đánh bạc phái sinh", "Phái sinh", 1310),
        ("Target giá BTC tuần tới là 100k USD đúng không?", "BTCUSDT", 64200),
        ("Bé Orca phím lệnh Long Short chắc thắng đi", "VN30F1M", 1315),
    ]
    for i, (q, sym, pval) in enumerate(noadvice_qs):
        add(
            id=f"sft-md-noadvice-{i+1:03d}", branch="general", depth="standard", language="vi", question=q,
            context_narrative=f"Khung nghiên cứu dữ liệu {sym}.",
            context_contract={"symbol": sym, "price": pval},
            retrieved=[{"id": "g-no-advice", "source": "guide", "title": "No Advice Rule",
                        "content": "ORCA cung cấp phân tích định lượng, không khuyến nghị mua/bán cá nhân hóa, không cam kết lợi nhuận."}],
            preferred_answer=(
                f"ORCA cung cấp phân tích dữ liệu nghiên cứu, **không** đưa ra khuyến nghị mua/bán cá nhân hóa hay target giá tuyệt đối. "
                f"Mọi quyết định đầu tư và phân bổ vốn cần dựa trên khẩu vị rủi ro và kỷ luật quản trị vốn của riêng cậu."
            ),
        )

    return samples

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "datasets/llm-human-voice/samples/sft_train.jsonl"
    data = build()
    Path(out).write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in data) + "\n", encoding="utf-8")
    print(f"Generated {len(data)} multi-domain SFT samples -> {out}")
