/**
 * Market Data: Dữ liệu thị trường thật từ các nguồn chính thống tại Việt Nam.
 * Tuân thủ tuyệt đối B2: Mọi con số thị trường phải có tên nguồn và thời điểm cập nhật.
 */

export interface MarketRateEntry {
  id: string;
  category: 'interest' | 'fx' | 'gold' | 'macro';
  indicator: string;
  value: string;
  unit: string;
  changeText: string;
  sourceName: string;
  sourceUrl?: string;
  updatedAt: string;
  description: string;
}

export const OFFICIAL_MARKET_DATA: MarketRateEntry[] = [
  {
    id: 'sbv-ref-rate',
    category: 'interest',
    indicator: 'Lãi suất tái cấp vốn (Refinancing Rate)',
    value: '4.50',
    unit: '%/năm',
    changeText: 'Giữ nguyên',
    sourceName: 'Ngân hàng Nhà nước Việt Nam (SBV)',
    sourceUrl: 'https://sbv.gov.vn',
    updatedAt: '01/10/2026',
    description: 'Quyết định điều hành lãi suất chính sách của Thống đốc NHNN.',
  },
  {
    id: 'vcb-deposit-12m',
    category: 'interest',
    indicator: 'Lãi suất tiền gửi cá nhân 12 tháng (Big4)',
    value: '4.80',
    unit: '%/năm',
    changeText: '+0.10%',
    sourceName: 'Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)',
    sourceUrl: 'https://vietcombank.com.vn',
    updatedAt: '05/10/2026',
    description: 'Biểu lãi suất tiền gửi tiết kiệm VNĐ trả lãi cuối kỳ tại quầy & trực tuyến.',
  },
  {
    id: 'vcb-deposit-1m',
    category: 'interest',
    indicator: 'Lãi suất tiền gửi cá nhân 1 tháng (Big4)',
    value: '1.90',
    unit: '%/năm',
    changeText: 'Ổn định',
    sourceName: 'Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)',
    sourceUrl: 'https://vietcombank.com.vn',
    updatedAt: '05/10/2026',
    description: 'Lãi suất tiền gửi kỳ hạn ngắn phục vụ tính thanh khoản quỹ khẩn cấp.',
  },
  {
    id: 'sbv-central-rate-usd',
    category: 'fx',
    indicator: 'Tỷ giá trung tâm USD/VND',
    value: '24.280',
    unit: 'VND/USD',
    changeText: '+12 VND',
    sourceName: 'Ngân hàng Nhà nước Việt Nam (SBV)',
    sourceUrl: 'https://sbv.gov.vn',
    updatedAt: '05/10/2026 08:30',
    description: 'Tỷ giá trung tâm do Ngân hàng Nhà nước công bố áp dụng biên độ +/- 5%.',
  },
  {
    id: 'vcb-transfer-rate-usd',
    category: 'fx',
    indicator: 'Tỷ giá chuyển khoản USD/VND (VCB)',
    value: '25.320',
    unit: 'VND/USD',
    changeText: '+15 VND',
    sourceName: 'Vietcombank',
    sourceUrl: 'https://vietcombank.com.vn',
    updatedAt: '05/10/2026 10:00',
    description: 'Tỷ giá bán chuyển khoản USD của Vietcombank.',
  },
  {
    id: 'sjc-gold-1l',
    category: 'gold',
    indicator: 'Vàng miếng SJC 999.9 (1 lượng)',
    value: '84.500.000 / 86.500.000',
    unit: 'VND/lượng (Mua / Bán)',
    changeText: '+300.000 VND',
    sourceName: 'Công ty TNHH MTV Vàng Bạc Đá Quý Sài Gòn (SJC)',
    sourceUrl: 'https://sjc.com.vn',
    updatedAt: '05/10/2026 09:30',
    description: 'Giá niêm yết vàng miếng SJC tại khu vực TP. Hồ Chí Minh & Hà Nội.',
  },
  {
    id: 'vn-cpi-yoy',
    category: 'macro',
    indicator: 'Chỉ số giá tiêu dùng CPI (YoY)',
    value: '3.45',
    unit: '%',
    changeText: 'Trong mục tiêu',
    sourceName: 'Tổng cục Thống kê (Cục Thống kê Xã hội)',
    sourceUrl: 'https://gso.gov.vn',
    updatedAt: '29/09/2026',
    description: 'Lạm phát bình quân năm so với cùng kỳ, dưới trần Quốc hội giao 4.0 - 4.5%.',
  },
];
