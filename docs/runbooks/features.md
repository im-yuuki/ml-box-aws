# MLBox — Runbook tính năng mới (multi-tenant)

> Cập nhật 2026-11-14. Dành cho người trực & QA. Tham khảo TODO.md Phase 9.

## Teams & invitations

- Tạo team: `POST /v1/teams` (owner/admin của Space). Danh sách: `GET /v1/teams`.
- Thêm/xoá lead-member: owner/admin hoặc Team Lead của team đó; xoá/hạ quyền lead cuối cùng bị chặn (`LAST_TEAM_LEAD`).
- Lời mời Space: `POST /v1/spaces/invitations` (owner/admin), thu hồi `POST /v1/invitations/:id/revoke`. Người được mời chấp nhận đúng email đã mời (không gửi email thật; hiện chỉ ghi nhận trong hệ thống).
- Người được mời phải là thành viên cùng Space mới được gán Project trực tiếp.
- Kiểm tra: `mlbox_space_invitations`, `mlbox_space_memberships` qua SQL nếu cần; audit events (`mlbox_audit_events`) ghi thao tác này.

## Sandbox lifecycle (theo Project)

- Start: `POST /v1/sandboxes` với `projectId` + `profile` (`cpu-small|cpu-medium|cpu-large`, GPU khi gói cho phép). BFF kiểm tra quota RAM của profile + gói + units; chỉ owner Project (hoặc member được phép) được thao tác.
- Stop: `POST /v1/sandboxes/stop` với `projectId`. Hub server đóng; session usage ghi nhận `ended_at`.
- Profile không hợp lệ với gói: `403 GPU_NOT_IN_PLAN` hoặc `429 QUOTA_EXCEEDED` (`metric: compute_units`).
- Session mở quá 24h bị đóng ở mốc 24h (cron/job-like trong BFF). Đơn giá: CPU 1 unit/giờ, GPU 10 unit/giờ (`CREDIT_RATES` trong `web/bff/src/mock-billing.ts`).
- Đổi profile: chỉ khi sandbox đang Stopped; khi Running thì stop trước rồi start lại với profile mới.

## Artifact retention & xóa Project

- Artifact list theo Project; upload/download qua presigned URL dưới `spaces/{space}/projects/{project}/` (BFF authorize trước khi cấp URL).
- Retention theo gói: Free 7 ngày, Plus 14, Pro 30 (retention job xoá object + metadata khi quá hạn).
- Xóa Project = soft delete: giữ lịch sử usage (`mlbox_usage_sessions`), giải phóng tên, xóa file qua EFS access point & object store; có xác nhận UI.
- Kiểm tra capacity Project/Space trong admin console; quota enforcement upload **chưa** bật (TODO "Dashboard").

## Billing units & gói

- Free: 20 units/tháng, CPU only. Plus: 100, GPU. Pro: 300, GPU. Org: Team $19 (≤3 thành viên), Growth $8/thành viên.
- `CREDIT_RATES`: CPU 1 unit/giờ, GPU 10 units/giờ (trong `web/bff/src/mock-billing.ts`). Số liệu là mock; **không** phải thanh toán thật.
- Gate khi units cạn: start bị chặn `429 QUOTA_EXCEEDED`. GPU không có trong Free: `403 GPU_NOT_IN_PLAN`.
- Đóng session >24h: đóng ở mốc 24h, tính đủ đến đó; check `mlbox_usage_sessions.ended_at`.

## Admin support actions (stack 07-admin, `web/admin`)

- Bốn thao tác (tắt mặc định, `enable_actions=true`): dừng sandbox, đăng xuất user, khóa user, đổi gói. Mỗi thao tác cần lý do và ghi `mlbox_admin_audit`.
- Audit: `SELECT created_at, actor_user_id, action, target, metadata FROM mlbox_audit_events ORDER BY created_at DESC LIMIT 50` (qua pod `bff`/postgres client).
- Đổi mật khẩu admin: `npm run hash-password` trong `web/admin`, cập nhật `admin_password_hash`, apply stack `07-admin`.
- Chỉ-đọc mặc định; mọi thao tác ghi đều có audit.

## Migrate / migration DB

- AppStore tự chạy migration khi khởi động (ensureSchema); migration `units_per_hour ADD COLUMN` tương thích ngược (dòng cũ tính rate 1).
- Trước release thay đổi schema: snapshot RDS usage + hub (manual snapshot), verify khôi phục theo quy trình restore test.

## Xác nhận sau mỗi tính năng release

Xem `docs/runbooks/release-acceptance.md` — bắt buộc chạy smoke (login, tạo project, start/stop sandbox, /quota, admin /healthz).