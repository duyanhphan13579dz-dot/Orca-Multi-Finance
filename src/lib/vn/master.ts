/**
 * VIETNAM SECURITY MASTER — canonical registry for Vietnamese securities.
 * Every module must resolve symbols/exchanges/sectors through this file.
 * Classification: HOSE / HNX / UPCOM · Vietnamese sector taxonomy.
 */

export type VnExchange = "HOSE" | "HNX" | "UPCOM";

export interface VnSecurity {
  symbol: string;
  name: string;
  nameEn?: string;
  exchange: VnExchange;
  sector: string;
  industry?: string;
  bluechip?: boolean;
}

export interface VnIndexDef {
  code: string;
  name: string;
  aliases: string[];
  exchange: "HOSE" | "HNX" | "UPCOM";
}

export const VN_INDICES: VnIndexDef[] = [
  { code: "VNINDEX", name: "VN-Index", aliases: ["VN-Index", "VNINDEX", "VNI", "^VNINDEX"], exchange: "HOSE" },
  { code: "VN30", name: "VN30", aliases: ["VN30", "VN30-Index"], exchange: "HOSE" },
  { code: "VN100", name: "VN100", aliases: ["VN100"], exchange: "HOSE" },
  { code: "HNXINDEX", name: "HNX-Index", aliases: ["HNX-Index", "HNX", "HNXIndex"], exchange: "HNX" },
  { code: "HNX30", name: "HNX30", aliases: ["HNX30"], exchange: "HNX" },
  { code: "UPCOM", name: "UPCoM-Index", aliases: ["UPCoM", "UPCOM", "UPCOM-Index"], exchange: "UPCOM" },
];

/* --------------------------- Vietnamese taxonomy --------------------------- */

export const VN_SECTORS = [
  "Ngân hàng", "Chứng khoán", "Bảo hiểm", "Bất động sản", "Khu công nghiệp",
  "Xây dựng & Vật liệu", "Thép", "Bán lẻ", "Công nghệ", "Kho hậu cần",
  "Hàng không & Vận tải", "Dầu khí", "Điện lực", "Hóa chất & Phân bón",
  "Thực phẩm & Đồ uống", "Nông nghiệp", "Cao su", "Dược phẩm & Y tế",
  "Viễn thông", "Dịch vụ tài chính", "Tài nguyên thiên nhiên", "Tiêu dùng thiết yếu",
  "Sản xuất tổng hợp", "Du lịch & Giải trí", "Khác",
] as const;

export type VnSector = (typeof VN_SECTORS)[number];

const S = (symbol: string, name: string, exchange: VnExchange, sector: VnSector, bluechip = false): VnSecurity => ({ symbol, name, exchange, sector, bluechip });

export const VN_SECURITIES: VnSecurity[] = [
  /* ========================== NGÂN HÀNG (Banking) ========================== */
  S("VCB", "Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)", "HOSE", "Ngân hàng", true),
  S("BID", "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV)", "HOSE", "Ngân hàng", true),
  S("CTG", "Ngân hàng TMCP Công Thương Việt Nam (VietinBank)", "HOSE", "Ngân hàng", true),
  S("TCB", "Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)", "HOSE", "Ngân hàng", true),
  S("MBB", "Ngân hàng TMCP Quân Đội (MBBank)", "HOSE", "Ngân hàng", true),
  S("VPB", "Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)", "HOSE", "Ngân hàng", true),
  S("ACB", "Ngân hàng TMCP Á Châu (ACB)", "HOSE", "Ngân hàng", true),
  S("STB", "Ngân hàng TMCP Sài Gòn Thương Tín (Sacombank)", "HOSE", "Ngân hàng", true),
  S("HDB", "Ngân hàng TMCP Phát triển TP.HCM (HDBank)", "HOSE", "Ngân hàng", true),
  S("VIB", "Ngân hàng TMCP Quốc tế Việt Nam (VIB)", "HOSE", "Ngân hàng", true),
  S("LPB", "Ngân hàng TMCP Lộc Phát Việt Nam (LPBank)", "HOSE", "Ngân hàng"),
  S("SHB", "Ngân hàng TMCP Sài Gòn – Hà Nội (SHB)", "HOSE", "Ngân hàng"),
  S("MSB", "Ngân hàng TMCP Hàng Hải (MSB)", "HOSE", "Ngân hàng"),
  S("OCB", "Ngân hàng TMCP Phương Đông (OCB)", "HOSE", "Ngân hàng"),
  S("TPB", "Ngân hàng TMCP Tiên Phong (TPBank)", "HOSE", "Ngân hàng"),
  S("EIB", "Ngân hàng TMCP Xuất Nhập Khẩu Việt Nam (Eximbank)", "HOSE", "Ngân hàng"),
  S("NAB", "Ngân hàng TMCP Nam Á (Nam A Bank)", "HOSE", "Ngân hàng"),
  S("ABB", "Ngân hàng TMCP An Bình (ABBank)", "HNX", "Ngân hàng"),
  S("VBB", "Ngân hàng TMCP Việt - Nga Liên doanh (VRB)", "UPCOM", "Ngân hàng"),
  S("KLB", "Ngân hàng TMCP Kiên Long (KLB)", "UPCOM", "Ngân hàng"),
  S("PGB", "Ngân hàng Thịnh vượng và Phát triển (PGBank)", "UPCOM", "Ngân hàng"),
  S("SGB", "Ngân hàng TMCP Sài Gòn Công Thương (SGICB)", "UPCOM", "Ngân hàng"),
  S("NVB", "Ngân hàng Thương mại Quốc Dân (NCB)", "UPCOM", "Ngân hàng"),
  S("BVB", "Ngân hàng TMCP Bảo Việt (BVB)", "UPCOM", "Ngân hàng"),

  /* ======================== CHỨNG KHOÁN (Securities) ======================= */
  S("SSI", "CTCP Chứng khoán SSI", "HOSE", "Chứng khoán", true),
  S("VND", "CTCP Chứng khoán VNDirect", "HOSE", "Chứng khoán", true),
  S("HCM", "CTCP Chứng khoán TP.HCM (VCSC)", "HOSE", "Chứng khoán", true),
  S("VCI", "CTCP Chứng khoán Vietcap (Bản Việt)", "HOSE", "Chứng khoán", true),
  S("SHS", "CTCP Chứng khoán Sài Gòn – Hà Nội", "HOSE", "Chứng khoán", true),
  S("MBS", "CTCP Chứng khoán MB", "HOSE", "Chứng khoán"),
  S("BSI", "CTCP Chứng khoán BIDV", "HOSE", "Chứng khoán"),
  S("FTS", "CTCP Chứng khoán FPT", "HOSE", "Chứng khoán"),
  S("CTS", "CTCP Chứng khoán Kỹ Thương (TCBS)", "HOSE", "Chứng khoán"),
  S("ORS", "CTCP Chứng khoán Thành Phố (HoSE Securities)", "HOSE", "Chứng khoán"),
  S("AGR", "CTCP Chứng khoán Agribank", "HOSE", "Chứng khoán"),
  S("TVS", "CTCP Chứng khoán Thiên Việt", "HOSE", "Chứng khoán"),
  S("VIX", "CTCP Chứng khoán VIX", "HOSE", "Chứng khoán"),
  S("BVS", "CTCP Chứng khoán Bảo Việt", "HOSE", "Chứng khoán"),
  S("DSE", "CTCP Chứng khoán DNSE", "HNX", "Chứng khoán"),
  S("PSI", "CTCP Chứng khoán Dầu khí", "HOSE", "Chứng khoán"),
  S("CTS", "CTCP Chứng khoán Kỹ Thương", "HOSE", "Chứng khoán"),
  S("EVF", "Tổ chức chứng khoán EVF", "HOSE", "Chứng khoán"),

  /* ========================== BẢO HIỂM (Insurance) ========================= */
  S("BVH", "Tập đoàn Bảo Việt", "HOSE", "Bảo hiểm", true),
  S("PVI", "CTCP Bảo hiểm PVI", "HOSE", "Bảo hiểm"),
  S("BIC", "Tổng CTCP Bảo hiểm BIDV", "HOSE", "Bảo hiểm"),
  S("MIG", "Tổng CTCP Bảo hiểm Quân đội", "HOSE", "Bảo hiểm"),
  S("PGI", "Tổng CTCP Bảo hiểm Xây dựng (PIDC)", "HOSE", "Bảo hiểm"),
  S("PRE", "CTCP Tái bảo hiểm Petrolimex", "HOSE", "Bảo hiểm"),
  S("ABI", "CTCP Bảo hiểm Ngân hàng Nông nghiệp", "HOSE", "Bảo hiểm"),

  /* ========================= BẤT ĐỘNG SẢN (Real Estate) ==================== */
  S("VIC", "Tập đoàn Vingroup", "HOSE", "Bất động sản", true),
  S("VHM", "Vinhomes", "HOSE", "Bất động sản", true),
  S("VRE", "Vincom Retail", "HOSE", "Bất động sản", true),
  S("NVL", "Tập đoàn Novaland", "HOSE", "Bất động sản", true),
  S("PDR", "Phát Đạt Real Estate", "HOSE", "Bất động sản", true),
  S("DXG", "Đất Xanh Group", "HOSE", "Bất động sản"),
  S("KDH", "CTCP Đầu tư và Kinh doanh Nhà (Khang Điền)", "HOSE", "Bất động sản", true),
  S("NLG", "Nam Long Investment", "HOSE", "Bất động sản"),
  S("CEO", "CTCP Đầu tư và Phát triển Công trình C.E.O", "UPCOM", "Bất động sản"),
  S("HDG", "Tập đoàn Hà Đô", "HOSE", "Bất động sản"),
  S("DIG", "CTCP Phát triển Hạ tầng (DIC)", "HOSE", "Bất động sản"),
  S("SCR", "CTCP Tập đoàn Đầu tư Đến trước", "HOSE", "Bất động sản"),
  S("TCH", "CTCP Đầu tư Dịch vụ Tài chính Hoàng Huy", "HOSE", "Bất động sản"),
  S("HQC", "CTCP Tư vấn Thương mại Dịch vụ Địa ốc Hoàng Quân", "HOSE", "Bất động sản"),
  S("TDH", "Thuduc House", "HOSE", "Bất động sản"),
  S("LDG", "CTCP cảng Long An (Lộc Phát)", "HOSE", "Bất động sản"),
  S("API", "CTCP Đầu tư Phát triển Xây dựng – Kinh doanh Địa ốc An Phúc", "HOSE", "Bất động sản"),
  S("CRE", "Cên Land", "HOSE", "Bất động sản"),
  S("SJS", "CTCP Đầu tư Phát triển Đô thị và Khu công nghiệp Sông Đà", "HNX", "Bất động sản"),

  /* ==================== KHU CÔNG NGHIỆP (Industrial Parks) ================= */
  S("KBC", "CTCP Đầu tư Kinh Bắc", "HOSE", "Khu công nghiệp", true),
  S("IDC", "Tổng CTCP IDICO", "HOSE", "Khu công nghiệp"),
  S("BCM", "CTCP Tập đoàn Đầu tư và Công nghiệp Becamex", "HOSE", "Khu công nghiệp", true),
  S("SZC", "CTCP Sonadezi", "HOSE", "Khu công nghiệp"),
  S("TIP", "CTCP Phát triển KCN Tây Ninh", "HOSE", "Khu công nghiệp"),
  S("VGC", "CTCP Viglacera", "HOSE", "Khu công nghiệp"),
  S("TIX", "CTCP Tập đoàn Tân Đức", "HOSE", "Khu công nghiệp"),
  S("ITA", "CTCP Đầu tư và Công nghiệp TPHCM", "HOSE", "Khu công nghiệp"),

  /* ===================== XÂY DỰNG & VẬT LIỆU (Construction) ================ */
  S("HPG", "Tập đoàn Hòa Phát", "HOSE", "Thép", true),
  S("HSG", "Tập đoàn Hoa Sen", "HOSE", "Thép", true),
  S("NKG", "Nam Kim Steel", "HOSE", "Thép"),
  S("SMC", "Cơ khí SMC", "HOSE", "Thép"),
  S("TLH", "Công ty Thép Tiến Lên", "HOSE", "Thép"),
  S("POM", "Thép Pomina", "HOSE", "Thép"),
  S("TVN", "Thép Việt Nam", "HOSE", "Thép"),
  S("BTS", "Cao su Bò Rịa", "HOSE", "Xây dựng & Vật liệu"),
  S("HPP", "CTCP Xi măng Holcim/Vicem Hà Bằng", "HOSE", "Xây dựng & Vật liệu"),
  S("BCC", "Xi măng Bỉm Sơn", "HNX", "Xây dựng & Vật liệu"),
  S("HT1", "Xi măng Hà Tiên 1", "HOSE", "Xây dựng & Vật liệu"),
  S("VLB", "Vật liệu Xây dựng Làng Đại học", "HNX", "Xây dựng & Vật liệu"),
  S("CCM", "Cầm Định Thợ", "HNX", "Xây dựng & Vật liệu"),
  S("DHA", "Công ty Quản lý và Phát triển Nhà Hà Nội", "HOSE", "Xây dựng & Vật liệu"),
  S("YBM", "Khoáng sản Yên Bái", "HNX", "Tài nguyên thiên nhiên"),
  S("KSB", "CTCP Khoáng sản và Luyện kim Bình Dương", "HOSE", "Tài nguyên thiên nhiên"),
  S("FCN", "CTCP Cơ giới (FC Corporation)", "HOSE", "Xây dựng & Vật liệu"),
  S("CTD", "CTCP Coteccons", "HOSE", "Xây dựng & Vật liệu", true),
  S("HBC", "CTCP Xây dựng Hòa Bình", "HOSE", "Xây dựng & Vật liệu"),
  S("GCN", "Tập đoàn Công nghiệp Gốm sứ (GHI)", "HOSE", "Xây dựng & Vật liệu"),

  /* ========================= CÔNG NGHỆ (Technology) ======================== */
  S("FPT", "FPT Corporation", "HOSE", "Công nghệ", true),
  S("CMG", "CTCP Tập đoàn CMC (CMC Corporation)", "HOSE", "Công nghệ"),
  S("ELC", "CTCP Đầu tư Phát triển Công nghệ Điện tử – ELCOM", "HNX", "Công nghệ"),
  S("POT", "CTCP Tổ chức Hỗ trợ Kỹ thuật VinaPhone", "HOSE", "Viễn thông"),
  S("FOC", "CTCP Viễn thông FPT (Foxconn/PFT)", "HOSE", "Viễn thông"),
  S("VGI", "Viettel Global", "HOSE", "Viễn thông", true),
  S("CTR", "Tổng CTCP Công trình Viettel", "HOSE", "Viễn thông"),
  S("SGT", "CTCP Công nghệ Viễn thông SaiGonTel", "HOSE", "Viễn thông"),

  /* ============================== BÁN LẺ (Retail) =========================== */
  S("MWG", "Tập đoàn Thế Giới Di Động", "HOSE", "Bán lẻ", true),
  S("MSN", "Tập đoàn Masan Group", "HOSE", "Bán lẻ", true),
  S("MCH", "Masan Consumer (Vinamilk Spinoff)", "HOSE", "Thực phẩm & Đồ uống", true),
  S("PNJ", "CTCP Vàng bạc Đá quý Phú Nhuận", "HOSE", "Bán lẻ", true),
  S("DGW", "Thế Giới Số (Digiworld)", "HOSE", "Bán lẻ"),
  S("FRT", "FPT Retail", "HOSE", "Bán lẻ"),
  S("PET", "Xuất nhập khẩu Petrolimex", "HOSE", "Bán lẻ"),

  /* ========================= THỰC PHẨM & ĐỒ UỐNG =========================== */
  S("VNM", "Vinamilk", "HOSE", "Thực phẩm & Đồ uống", true),
  S("SAB", "Sabeco", "HOSE", "Thực phẩm & Đồ uống", true),
  S("QNS", "Đường Quảng Ngãi", "UPCOM", "Thực phẩm & Đồ uống"),
  S("SBT", "Quốc Tế Châu Đốc – SBT", "HOSE", "Thực phẩm & Đồ uống"),
  S("LSS", "Sơn La Đường", "HNX", "Thực phẩm & Đồ uống"),
  S("KDC", "Kinh Đô Corporation", "HOSE", "Thực phẩm & Đồ uống"),
  S("TAC", "Tuong An Vegetable Oil", "HOSE", "Thực phẩm & Đồ uống"),
  S("VHC", "Vĩnh Hoàn Corporation", "HOSE", "Thực phẩm & Đồ uống", true),
  S("FMC", "Sao Ta Foods (Finso)", "HOSE", "Thực phẩm & Đồ uống"),
  S("ASM", "Sao Mai Group", "HOSE", "Thực phẩm & Đồ uống"),
  S("IDI", "IDICO - Đông Đô", "HOSE", "Thực phẩm & Đồ uống"),
  S("ANV", "Công ty Cổ phần Sản xuất Nông nghiệp Anh Vũ", "HOSE", "Thực phẩm & Đồ uống"),
  S("ACL", "Cà Mau Sựu Thê (Cafeta)", "HOSE", "Nông nghiệp"),
  S("HAG", "Hoàng Anh Gia Lai", "HOSE", "Nông nghiệp"),
  S("PAN", "Tập đoàn PAN (PAN Group)", "HOSE", "Nông nghiệp"),
  S("DBC", "Dabaco Việt Nam", "HOSE", "Nông nghiệp"),
  S("BAF", "Chăn nuôi An Binh (BAF)", "HOSE", "Nông nghiệp"),
  S("LTG", "Vĩnh Loc High Tech", "HOSE", "Nông nghiệp"),

  /* ============================= DẦU KHÍ (Oil & Gas) ======================== */
  S("GAS", "PV Gas", "HOSE", "Dầu khí", true),
  S("PLX", "Petrolimex", "HOSE", "Dầu khí", true),
  S("BSR", "Lọc hóa dầu Bình Sơn", "HOSE", "Dầu khí", true),
  S("PVD", "PV Drilling (PetroVietnam Drilling)", "HOSE", "Dầu khí"),
  S("PVS", "PTSC - Dịch vụ Kỹ thuật Dầu khí", "HOSE", "Dầu khí"),
  S("PVT", "PetroVietnam Transportation (PVTrans)", "HOSE", "Dầu khí"),
  S("OIL", "PV Oil", "HOSE", "Dầu khí"),
  S("PVC", "Dịch vụ Xây lắp Dầu khí (PVCC)", "HOSE", "Dầu khí"),
  S("PVB", "Câu chuyện và Hóa chất Dầu khí (PetroVietnam Coating)", "HOSE", "Dầu khí"),
  S("PXS", "In ấn Petrolimex", "HOSE", "Dầu khí"),
  S("POS", "Dịch vụ Xây lắp Máy Tàu thủy Dầu khí (PTSC POS)", "HNX", "Dầu khí"),
  S("TOS", "Tân Bình Oil", "HNX", "Dầu khí"),

  /* ========================== ĐIỆN LỰC (Utilities) ========================== */
  S("POW", "PV Power", "HOSE", "Điện lực", true),
  S("REE", "CTCP Cơ điện lạnh (REE Corp)", "HOSE", "Điện lực", true),
  S("NT2", "Nhiệt điện 2 Gành Kèo", "HOSE", "Điện lực"),
  S("PPC", "Nhiệt điện Phả Lại", "HNX", "Điện lực"),
  S("GEG", "Điện Giải Group (GELEX Power)", "HOSE", "Điện lực"),
  S("QTP", "Quảng Phú Energy", "UPCOM", "Điện lực"),
  S("VSH", "Thủy điện Vĩnh Sơn - Sông Hinh", "HOSE", "Điện lực"),
  S("RIC", "Đông Á Điện lực", "HNX", "Điện lực"),
  S("VCP", "Năng lượng Việt Nam", "HNX", "Điện lực"),
  S("TMP", "Thủy điện Tâm Lâm", "UPCOM", "Điện lực"),
  S("GHC", "Điện Giải Khánh Hòa (Gecam Hydropower)", "HNX", "Điện lực"),

  /* ====================== HÓA CHẤT & PHÂN BÓN (Chemicals) =================== */
  S("DCM", "Đạm Cà Mau (PetroVietnam Fertilizer)", "HOSE", "Hóa chất & Phân bón", true),
  S("DPM", "Đạm Phú Mỹ (Phu My Fertilizer)", "HOSE", "Hóa chất & Phân bón", true),
  S("DGC", "Đức Giang Chemicals", "HOSE", "Hóa chất & Phân bón", true),
  S("CSV", "Cao su Việt Nam (SVR)", "HOSE", "Hóa chất & Phân bón"),
  S("BFC", "Bình Điền Fertilizer (BINAF)", "HOSE", "Hóa chất & Phân bón"),
  S("LAS", "Phân bón Lâm Thao (Supe LAS)", "HNX", "Hóa chất & Phân bón"),
  S("NET", "NET Nam Châu", "HNX", "Hóa chất & Phân bón"),
  S("PTC", "Hóa chất Phúc Thạnh (PetroVietnam General Services)", "HOSE", "Hóa chất & Phân bón"),
  S("APP", "Hóa chất An Phú (Agrophos)", "HNX", "Hóa chất & Phân bón"),
  S("MCC", "Ceramic MCC", "HOSE", "Xây dựng & Vật liệu"),
  S("HSL", "Hóa chất Hue (Hue Chemicals)", "HNX", "Hóa chất & Phân bón"),

  /* =============================== CAO SU (Rubber) =========================== */
  S("GVR", "Tập đoàn Cao su Việt Nam (GVR)", "HOSE", "Cao su", true),
  S("PHR", "Cao su Phước Hòa", "HOSE", "Cao su"),
  S("DPR", "Cao su Đồng Nai (DC4)", "HOSE", "Cao su"),
  S("TRC", "Tây Ninh Cao su", "HOSE", "Cao su"),
  S("RTB", "Cao su Tân Biên", "UPCOM", "Cao su"),
  S("VJF", "Cao su Việt - Lào", "HNX", "Cao su"),

  /* ======================= HÀNG KHÔNG & VẬN TẢI (Aviation) ================== */
  S("ACV", "Tổng Công ty TNHH Cảng hàng không Việt Nam", "UPCOM", "Hàng không & Vận tải", true),
  S("HVN", "Tổng Công ty Cổ phần Hàng không Việt Nam (Vietnam Airlines)", "HOSE", "Hàng không & Vận tải", true),
  S("VJC", "CTCP Hàng không VietJet", "HOSE", "Hàng không & Vận tải", true),
  S("AST", "CTCP Dịch vụ Hàng hóa Sân bay (TCS & PTSC)", "HOSE", "Hàng không & Vận tải"),
  S("MAS", "Tập đoàn Địa ốc Hoàng Mai (Masan/Airport)", "HOSE", "Hàng không & Vận tải"),
  S("NCT", "Nội Phát Cargo", "UPCOM", "Hàng không & Vận tải"),

  /* ========================== KHO HẬU CẦN (Logistics) ====================== */
  S("GMD", "CTCP Đầu tư Khai thác Container (Gemadept)", "HOSE", "Kho hậu cần", true),
  S("VSC", "CTCP Container Việt Nam (Viconship)", "HOSE", "Kho hậu cần"),
  S("HAH", "CTCP Vận tải và Xếp dỡ Hải Âu", "HOSE", "Kho hậu cần"),
  S("TCL", "CTCP Logistics Tân Cảng", "HOSE", "Kho hậu cần"),
  S("PHP", "CTCP Cổ phần Đầu tư Thương mại và Dịch vụ Petroleum", "HOSE", "Kho hậu cần"),
  S("ILB", "CTCP ICD", "HNX", "Kho hậu cần"),
  S("CDN", "Cảng Đà Nẵng", "HOSE", "Kho hậu cần"),
  S("DVP", "Định Vũ Port (DVP)", "HNX", "Kho hậu cần"),
  S("VNL", "Vận tải Logistics Việt Nam (Vinalines)", "UPCOM", "Kho hậu cần"),
  S("HTG", "Hà Tiên Xanh", "HOSE", "Kho hậu cần"),
  S("TCO", "Taseco Land", "HNX", "Kho hậu cần"),
  S("STG", "CTCP Vận tải STP (Sotrans Group)", "HNX", "Kho hậu cần"),

  /* ====================== DƯỢC PHẨM & Y TẾ (Pharma) ======================= */
  S("DHG", "Dược Hậu Giang", "HOSE", "Dược phẩm & Y tế", true),
  S("TRA", "Dược Traphaco", "HOSE", "Dược phẩm & Y tế"),
  S("IMP", "Sỹ Dược Imexpharm", "HOSE", "Dược phẩm & Y tế"),
  S("DBD", "Dược Bình Định (Bidiphar)", "UPCOM", "Dược phẩm & Y tế"),
  S("DVN", "Dược Vĩnh Phúc (Vidipha)", "UPCOM", "Dược phẩm & Y tế"),
  S("PMB", "Pharmedic (PMB)", "HNX", "Dược phẩm & Y tế"),
  S("HT1", "CTS HT1", "HNX", "Dược phẩm & Y tế"),
  S("TNH", "Bệnh viện Việt Nam - Thụy Điển", "HNX", "Dược phẩm & Y tế"),
  S("JVC", "Japan-Vietnam Medical (JVC)", "UPCOM", "Dược phẩm & Y tế"),
  S("MKP", "Mekophar", "HOSE", "Dược phẩm & Y tế"),

  /* ========================= TÀI NGUYÊN / KHÁC ============================= */
  S("MSR", "Masan Resources (Nui Phao)", "HOSE", "Tài nguyên thiên nhiên", true),
  S("HTM", "Hà Tĩnh Mineral", "HNX", "Tài nguyên thiên nhiên"),
  S("KHM", "Khoáng Mộc Hương Cần", "HNX", "Tài nguyên thiên nhiên"),

  /* ================================= ETF ==================================== */
  S("FUEVFVND", "VFMVN Diamond ETF", "HOSE", "Dịch vụ tài chính"),
  S("FUESSVFL", "SSIAM VNFIN Lead ETF", "HOSE", "Dịch vụ tài chính"),
];

/* --------------------------- lookup & search index -------------------------- */

const bySymbol = new Map<string, VnSecurity>();
const normIndex = new Map<string, VnSecurity[]>();

const normVi = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

for (const s of VN_SECURITIES) {
  if (!bySymbol.has(s.symbol)) bySymbol.set(s.symbol, s);
}
for (const s of bySymbol.values()) {
  const keys = new Set<string>([s.symbol.toLowerCase(), normVi(s.name), normVi(s.sector)]);
  for (const k of keys) {
    for (const token of k.split(" ")) {
      if (token.length < 2) continue;
      const arr = normIndex.get(token) ?? [];
      arr.push(s);
      normIndex.set(token, arr);
    }
  }
}

export function getSecurity(symbol: string): VnSecurity | null {
  return bySymbol.get(symbol.toUpperCase()) ?? null;
}

export function isVnSymbol(symbol: string): boolean {
  return bySymbol.has(symbol.toUpperCase());
}

export interface SectorDef {
  name: string;
  symbols: string[];
}

export const VN_SECTOR_MAP: SectorDef[] = (() => {
  const m = new Map<string, string[]>();
  for (const s of bySymbol.values()) {
    const arr = m.get(s.sector) ?? [];
    arr.push(s.symbol);
    m.set(s.sector, arr);
  }
  return [...m.entries()].map(([name, symbols]) => ({ name, symbols })).sort((a, b) => b.symbols.length - a.symbols.length);
})();

export function sectorOf(symbol: string): string {
  return getSecurity(symbol)?.sector ?? "Khác";
}

export function searchSecurities(query: string, limit = 12): VnSecurity[] {
  const q = normVi(query);
  if (!q) return [];
  const upper = query.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const scored = new Map<VnSecurity, number>();
  for (const s of bySymbol.values()) {
    let score = 0;
    if (s.symbol === upper) score = 100;
    else if (s.symbol.startsWith(upper) && upper.length >= 2) score = 60;
    const nn = normVi(s.name);
    if (nn.includes(q)) score = Math.max(score, q.length >= 3 ? 45 : 0);
    if (normVi(s.sector).startsWith(q) && q.length >= 3) score = Math.max(score, 30);
    if (s.bluechip) score += 8;
    if (score > 0) scored.set(s, score);
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([s]) => s);
}

/** default VN-first watchlist seeds */
export const DEFAULT_VN_WATCHLIST: string[] = ["VNINDEX", "VN30", "VCB", "FPT", "HPG", "VIC", "MBB", "TCB", "SSI", "VND", "MWG", "GAS"];
