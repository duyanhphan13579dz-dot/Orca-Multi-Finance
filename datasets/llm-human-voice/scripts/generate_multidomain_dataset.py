#!/usr/bin/env python3
"""Emit ORCA multi-domain finance SFT JSONL (market/stock/industry/commodity/crypto/macro/no-advice)."""
import json, sys
from pathlib import Path

def build():
    samples = []
    def add(**kw):
        samples.append(kw)

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
    ]
    for i, (q, depth) in enumerate(market_qs):
        idx = 1280 + i * 3.2
        chg = round((-0.5 + (i % 7) * 0.25), 2)
        vol = 700 + i * 15
        adv, dec = 280 + i * 5, 200 - i * 3
        fn = -150 - i * 12
        bank = round(0.5 + (i % 5) * 0.3, 1)
        add(
            id=f"sft-md-market-{i+1:03d}", branch="market", depth=depth, language="vi", question=q,
            context_narrative=f"## VN-Index\nĐóng cửa {idx:.1f} điểm ({chg:+.2f}%). Thanh khoản ~{vol} tỷ. Độ rộng {adv}/{dec}. Ngoại net {fn} tỷ. NH {bank:+.1f}%.",
            context_contract={"vnIndex": {"last": round(idx,1), "changePercent": chg, "volumeBillion": vol},
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

    stocks = [
        ("FPT",112500,1.2,58.2,22.1,4.8,15.2),("VCB",94500,-0.5,45.0,14.2,2.1,18.5),
        ("HPG",27800,2.1,62.0,11.5,1.4,35.0),("MWG",58200,0.8,55.0,18.0,3.2,32.0),
        ("TCB",24850,1.5,60.0,9.8,1.3,12.0),("VNM",67500,-0.3,48.0,16.5,5.0,14.0),
        ("GAS",89200,0.6,52.0,12.0,2.5,28.0),("SSI",31200,1.8,65.0,15.0,1.8,3.5),
        ("CTG",34500,0.4,50.0,10.5,1.5,22.0),("MSN",72800,-1.2,42.0,20.0,2.8,16.0),
    ]
    for i, (sym, price, chg, rsi, pe, pb, rev) in enumerate(stocks):
        for j, (qt, depth) in enumerate([("Phân tích {s}", "deep"), ("{s} có đắt không?", "standard"),
                                         ("{s} kỹ thuật?", "standard"), ("Tóm tắt {s}", "concise")]):
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

    for i, (sec, chg, leaders) in enumerate([
        ("Ngân hàng",1.4,["VCB","TCB"]),("Bất động sản",-0.8,["VHM","VIC"]),
        ("Thép",2.0,["HPG","HSG"]),("Bán lẻ",0.5,["MWG","FRT"]),
        ("Dầu khí",0.9,["GAS","PLX"]),("Công nghệ",1.1,["FPT","CMG"]),
        ("Chứng khoán",1.6,["SSI","VND"]),("Thực phẩm",-0.2,["VNM","MSN"]),
        ("Điện",0.3,["PC1","REE"]),("Xây dựng",-1.0,["CTD","HBC"]),
    ]):
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

    for i, (name, price, chg, unit) in enumerate([
        ("Vàng",2485.2,0.6,"USD/oz"),("Dầu WTI",78.5,-1.2,"USD/thùng"),
        ("Bạc",29.8,0.4,"USD/oz"),("Cà phê Robusta",4200,1.5,"USD/tấn"),("Đồng",4.15,-0.3,"USD/lb"),
    ]):
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

    for i, (sym, price, chg) in enumerate([
        ("BTCUSDT",64200,1.8),("ETHUSDT",3450,2.1),("SOLUSDT",148,-0.5),
        ("BNBUSDT",580,0.7),("XRPUSDT",0.62,1.0),
    ]):
        add(
            id=f"sft-md-crypto-{i+1:03d}", branch="general", depth="standard", language="vi",
            question=f"Giá {sym.replace('USDT','')}?",
            context_narrative=f"{sym} ~{price} ({chg:+.1f}%).",
            context_contract={"symbol": sym, "price": price, "changePercent": chg},
            retrieved=[{"id": "g", "source": "guide", "title": "Crypto", "content": "Không advice."}],
            preferred_answer=f"**{sym}** ~**{price}** ({chg:+.1f}%). Không phải khuyến nghị giao dịch.",
        )

    for i in range(15):
        idx=1250+i*4; chg=round((i%9-4)*0.35,2); vol=650+i*20; adv=250+i*8; dec=max(50,220-i*2); fn=50-i*20
        add(
            id=f"sft-md-market-x{i+1:03d}", branch="market", depth=["concise","standard","deep"][i%3], language="vi",
            question=["Thị trường hôm nay?","Nhận định phiên","Thanh khoản HOSE?"][i%3],
            context_narrative=f"VN-Index {idx} ({chg:+.2f}%), {vol} tỷ, breadth {adv}/{dec}, ngoại {fn} tỷ.",
            context_contract={"vnIndex": {"last": float(idx), "changePercent": chg, "volumeBillion": vol},
                              "breadth": {"advancers": adv, "decliners": dec}, "foreign": {"netBillion": fn}},
            retrieved=[{"id": "g", "source": "guide", "title": "M", "content": "No advice."}],
            preferred_answer=(
                f"VN-Index **{idx}** ({chg:+.1f}%), thanh khoản **{vol} tỷ**, độ rộng {adv}/{dec}, ngoại **{fn} tỷ**. "
                f"Phân tích phục vụ nghiên cứu."
            ),
        )

    for i, q in enumerate(["Có nên mua FPT không?", "Khuyến nghị mã mạnh", "Target giá VCB?"]):
        add(
            id=f"sft-md-noadvice-{i+1:03d}", branch="stock", depth="standard", language="vi", question=q,
            context_narrative="Khung nghiên cứu.",
            context_contract={"symbol": "FPT", "quote": {"price": 112500}},
            retrieved=[{"id": "g", "source": "guide", "title": "No advice", "content": "Không mua/bán tuyệt đối."}],
            preferred_answer=(
                "ORCA cung cấp phân tích dữ liệu, **không** khuyến nghị mua/bán cá nhân hóa hay target giá khi không có trong hệ thống. "
                "Hãy hỏi diễn biến giá hoặc định giá theo dữ liệu có sẵn."
            ),
        )

    return samples

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "sft_multidomain_finance.jsonl"
    data = build()
    Path(out).write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in data) + "\n", encoding="utf-8")
    print(len(data), "->", out)
