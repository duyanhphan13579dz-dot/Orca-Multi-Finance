# ORCA FINANCIAL — UPGRADE & CORE ENGINE PRESERVATION PRINCIPLES

> Nguồn: chỉ thị chính thức của chủ sở hữu (2026-09-06).
> **Nguyên tắc ràng buộc mọi nâng cấp, refactor, migration, bổ sung tính năng.**

MỤC TIÊU: **NÂNG CẤP, MỞ RỘNG, TỐI ƯU VÀ TĂNG CƯỜNG HỆ THỐNG HIỆN CÓ — KHÔNG PHẢI XÓA ĐI VÀ XÂY LẠI TỪ ĐẦU.**

## 1. CORE ENGINE PRESERVATION FIRST
Core Assets: Core Data Engine · Provider Layer · Data Normalization · Validation Engine ·
Realtime/Refresh Engine · Cache Layer · Financial Calculation Engine · Technical Analysis Engine ·
Stock Intelligence Engine · Commodities Intelligence Engine · Existing API Contracts · Database Schema ·
Authentication · AI Tool Layer · Agent Orchestration · Business logic đang hoạt động.

KHÔNG được: xóa toàn bộ engine · thay thế module để thêm provider · rewrite từ đầu ·
xóa business logic chưa phân tích · xóa API đang hoạt động · xóa schema đang dùng ·
xóa fallback · xóa validation/error handling.
Trừ khi: (1) không còn dùng (2) không dependency (3) có replacement hoàn chỉnh
(4) replacement đã test (5) migration path xác nhận.

## 2. AUDIT BEFORE MODIFY
AUDIT → DEPENDENCY ANALYSIS → IDENTIFY CORE ENGINES → IDENTIFY REUSABLE COMPONENTS
→ DESIGN UPGRADE PATH → IMPLEMENT.
Cấm: NEW IDEA → DELETE OLD CODE → BUILD NEW SYSTEM. Chưa hiểu code → KHÔNG XÓA.

## 3. EXTEND BEFORE REPLACE
1. CONFIGURE EXISTING ENGINE → 2. EXTEND EXISTING ENGINE → 3. ADD NEW ADAPTER →
4. ADD NEW PROVIDER → 5. COMPATIBILITY LAYER → 6. REPLACE → 7. REMOVE.
Xóa/thay thế chỉ ở bước cuối.

## 4. PROVIDER REPLACEMENT IS NOT ENGINE REPLACEMENT
Đổi provider KHÔNG được phá: Normalization · Validation · Cache · Realtime · API Contracts ·
Financial Intelligence.

## 5. ADDITIVE ARCHITECTURE
`EXISTING SYSTEM + NEW CAPABILITY = UPGRADED SYSTEM` (qua Adapter/Provider/Service/
Engine Extension/Plugin/Module/Feature Flag/Compatibility Layer).
Cấm `EXISTING SYSTEM − CORE FEATURES + NEW FEATURE`.

## 6. NO BLIND DELETION
Trước khi xóa: DIRECT/INDIRECT DEPENDENCIES · RUNTIME · API · DB · AI TOOL ·
BACKGROUND JOB · TEST COVERAGE. Chưa chắc → **KEEP THE CODE AND MARK FOR REVIEW**.

## 7. STRANGLER MIGRATION PATTERN
OLD ENGINE → LEGACY PATH + NEW PATH → COMPARE RESULTS → VALIDATION → GRADUAL SWITCH →
OBSERVATION → LEGACY REMOVAL. Cấm OLD → DELETE → NEW trong một bước.

## 8. BACKWARD COMPATIBILITY
API đang chạy = STABLE CONTRACT. Không đổi response structure/field/types/routes
trừ khi có versioning + compatibility layer + consumers vẫn chạy.
Ưu tiên: NEW ENGINE → COMPATIBILITY ADAPTER → EXISTING API CONTRACT.

## 9. PRESERVE FINANCIAL INTELLIGENCE
Bảo vệ: financial calculations · technical indicators · valuation · stock/commodity analysis ·
market analysis · risk · portfolio · data validation · freshness · source attribution.
`OLD INTELLIGENCE + NEW INTELLIGENCE = STRONGER INTELLIGENCE`.

## 10. DATA PROVIDER FALLBACK MUST BE PRESERVED
PRIMARY → fail → SECONDARY → fail → FALLBACK → stale cache → DATA_UNAVAILABLE.
Provider cũ giữ làm fallback/validation/historical comparison/emergency recovery;
chỉ loại khi provider mới tốt hơn (coverage/reliability/freshness/quality).

## 11. CORE ENGINE INVENTORY
Trước mỗi major upgrade: bảng Engine | Purpose | Dependencies | Status | Upgrade Impact.

## 12. IMPLEMENTATION MUST BE INCREMENTAL
PHASE 1 AUDIT → 2 ARCHITECTURE → 3 ADD NEW COMPONENT → 4 INTEGRATE → 5 DUAL RUN/VALIDATION →
6 GRADUAL MIGRATION → 7 OBSERVATION → 8 OPTIONAL CLEANUP. Không PR khổng lồ.

## 13. NO REGRESSION RULE
`NEW CAPABILITY > 0` và `CORE CAPABILITY LOST = 0`. Nếu feature mới chạy nhưng feature cũ vỡ
→ upgrade = FAILED.

## 14. TEST BEFORE REMOVAL
NEW ENGINE → UNIT → INTEGRATION → DATA COMPARISON → FAILURE TEST → LOAD → OBSERVATION.
Bắt buộc test: provider failure · missing data · invalid data · timeout · stale · realtime fail ·
partial · DB fail.

## 15. FEATURE FLAGS FOR HIGH-RISK UPGRADES
VD: `USE_NEW_PROVIDER=true`, `USE_NEW_AI_AGENT=false` — enable/disable/rollback không phá hệ thống.

## 16. ROLLBACK MUST ALWAYS BE POSSIBLE
Không deploy production nếu chưa có rollback strategy.

## 17. UI/UX STABILITY
Không redesign/theme/layout/colors/typography/navigation khi task chỉ nâng cấp engine.
Frontend appearance = UI STABLE CONTRACT. Chỉ đổi khi task yêu cầu tường minh.

## 18. REQUIRED CHANGE REPORT
Sau mỗi major upgrade: A. PRESERVED · B. EXTENDED · C. NEW · D. REPLACED · E. REMOVED.
Mỗi REMOVED: Reason · Dependency Check · Replacement · Migration Result · Test Result · Rollback.

## FINAL GOVERNING PRINCIPLE
UNDERSTAND → PRESERVE → EXTEND → INTEGRATE → VALIDATE → MIGRATE → OPTIMIZE.
Cấm: DELETE → REBUILD → HOPE IT WORKS.

> **ORCA Financial là hệ thống phát triển liên tục. Mỗi nâng cấp phải kế thừa và tận dụng
> các Core Engine, Data Engine, Financial Intelligence và Business Logic hiện có. Chỉ thay thế
> hoặc loại bỏ sau khi hiểu đầy đủ chức năng, dependency, có replacement tương đương hoặc tốt hơn,
> đã kiểm thử, có migration path và rollback plan.**
