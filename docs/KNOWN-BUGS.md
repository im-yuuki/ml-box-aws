# KNOWN-BUGS — MLBox production (mlbox.june8th.me)

Phát hiện khi verify E2E bằng tài khoản test `tadirab921@bwingmedia.com` ngày **2026-11-10**.
Cách phát hiện: HTTP checks + browser E2E (đăng nhập → /projects). Máy dùng để test **không có
AWS credentials** (`aws sts get-caller-identity` → NoCredentials), nên Bug 1 chỉ xác định được
tới BFF, chưa chẩn đoán được RDS.

Thứ tự xử lý gợi ý: Bug 1 → Bug 2 → Bug 3/4 (phần còn lại phụ thuộc Bug 1).

---

## ✅ Bug 1 — BFF: mọi authenticated endpoint trả `503 APP_DATABASE_UNAVAILABLE`

**Nguyên nhân thật (đã xác nhận 2026-11-10):** RDS `jhub-gpu-sandbox-dev-apse2-dashboard-usage` đang
`available`, BFF kết nối được. Lỗi là schema: bảng `mlbox_projects` trên prod còn dạng cũ (`space_id`,
không có `team_id`), được tạo từ commit `d0ac3b0`. `CREATE TABLE IF NOT EXISTS` bỏ qua bảng cũ, nên
`CREATE INDEX ... mlbox_projects(team_id)` lỗi `column "team_id" does not exist` và mọi request có session
đều 503. Log BFF: `Application database bootstrap failed`.

**Đã sửa (code, chưa deploy):** `web/bff/src/app-store.ts` thêm `migrateLegacyProjects()`: tạo team cho
từng Space cũ (personal → `personal-team:<owner>`), chuyển project sang team, copy thành viên Space sang
team để giữ quyền truy cập, rồi bỏ ràng buộc `space_id`. Idempotent, chạy trong một transaction.
Đã kiểm chứng trên Postgres 18 thật: migration, chạy lại, và các truy vấn sau migration.

Trước khi xóa mục này: deploy BFF mới và kiểm tra `GET /api/bff/spaces` trong browser session = 200.

### Ghi nhận ban đầu (trước khi chẩn đoán)

**Mức độ:** chặn toàn bộ E2E của ứng dụng (Projects, Spaces, Usage, Account, sandbox, artifacts,
hub handoff, session list… đều không dùng được).

**Hiện tượng (đã lặp lại):**

- `GET /api/bff/spaces` → `503 {"error":"APP_DATABASE_UNAVAILABLE","message":"Dịch vụ ứng dụng tạm thời không khả dụng."}`
- `GET /api/bff/projects` → 503 tương tự
- `GET /api/bff/usage` → 503 tương tự
- `GET /api/bff/auth/session` → 503 tương tự
- `GET /api/bff/subscriptions/plans` → **200** (plans tĩnh, không chạm DB)
- Login trên UI vẫn đi tiếp tới `/projects` (xem Bug 4: login nuốt lỗi DB)

**Phân tích:**

- Chuỗi lỗi: `requireSession` → `ensureAppBootstrap` → `appStore.ensureSchema()` /
  `isAuthSessionActive` / `touchAuthSession` → Postgres (RDS). Khi Postgres unreachable,
  MỌI endpoint authenticated đều 503 (`web/bff/src/server.ts` ~L384–409).
- Cognito **OK** (login lấy được token), DynamoDB **OK** (refresh token lưu/đọc qua DynamoDB,
  `saveRefreshToken`/`loadRefreshToken`), Postgres **KHÔNG OK**. Lỗi cô lập ở app database.
- Nghi ngờ thuộc một trong: RDS instance bị stop / storage đầy / security group hoặc subnet
  lệch sau khi `02-platform` được apply lại ngày 2026-11-10 (xóa ECR, publisher IAM) /
  `APP_DATABASE_URL` (secret) lệch sau khi password bị xoay. Lưu ý TODO.md: `01-foundation`
  chưa apply lại và **state lệch cluster** (fck-NAT ↔ NAT gateway, IAM) — cần đối chiếu xem
  có ảnh hưởng network/SG tới RDS không.

**Cần làm:**

- [ ] Chẩn đoán RDS: `aws rds describe-db-instances` (instance status, storage, endpoint),
      `kubectl -n dashboard logs deploy/bff --since=1h` (tìm lỗi kết nối Postgres),
      đối chiếu `APP_DATABASE_URL` trong secret với endpoint/password hiện tại.
- [ ] Khôi phục kết nối Postgres (start instance / mở SG / xoay lại secret đúng với DB).
- [ ] Verify lại: `GET /api/bff/spaces` với session đã đăng nhập trả **200 + list spaces**;
      `curl -sI` không đủ — phải test trong browser session (curl thường không mang cookie).
- [ ] Sau khi Bug 1 xong, chạy lại toàn bộ E2E: login → create project → start sandbox →
      open notebook handoff → verify file EFS (stop/start) → stop → logout.

---

## ✅ Bug 2 — Dashboard: "Loading projects…" vô hạn khi Spaces API lỗi

**Đã sửa (frontend, chưa deploy):** `useActiveSpace` thêm `reload()`; `ProjectBoard` hiển thị panel lỗi
+ "Try again" khi Spaces lỗi hoặc không có Space (không còn spinner vô hạn); `SpaceSwitcher` hiện
"Workspaces unavailable" thay vì ẩn. Thêm key i18n `navbar.spacesUnavailable` (en/vi).

**Mức độ:** UX treo cứng, không có error state, không biết lỗi là gì.

**Vị trí code:**

- `web/dashboard/src/components/ProjectBoard.tsx`:
  - `loadState` khởi tạo `"loading"`; `loadProjects()` chỉ được gọi khi `activeSpaceId != null`
    (`useEffect` phía dưới `activeSpaceId`);
  - `useActiveSpace` khi `/api/bff/spaces` lỗi sẽ `setFailed(true)` nhưng `spaces` vẫn `[]` →
    `chooseActiveSpace([], storedId)` trả `null` → `activeSpaceId` mãi là `null` →
    `loadProjects()` không bao giờ chạy → `loadState` kẹt ở `"loading"` **vĩnh viễn**.
- `web/dashboard/src/components/navbar/SpaceSwitcher.tsx`: `failed || !activeSpace` → render
  `null` (nút switch space tàng hình, không báo lỗi).

**Kỳ vọng:** khi Spaces API lỗi → hiển thị panel lỗi (title/body + nút Retry) như các nhánh
`unavailable`/`unauthorized` sẵn có; SpaceSwitcher hiện trạng thái lỗi hoặc logout-and-retry.

**Gợi ý sửa:**

- [ ] Trong `useActiveSpace`, expose cả `loading` và `failed` (đã có sẵn) xuống `ProjectBoard`;
      nếu `failed` hoặc (sau khi `loading=false` mà `activeSpace === null`) → `setLoadState("unavailable")`.
- [ ] Thay check `if (!activeSpaceId) return;` trong `useEffect` bằng nhánh xử lý lỗi rõ ràng,
      không để rơi về spinner vô hạn.
- [ ] SpaceSwitcher: khi `failed` render nút/tooltip báo "Workspace temporarily unavailable"
      thay vì `null`.

---

## ✅ Bug 3 — `/v1/health` không kiểm tra DB → readiness "healthy" giả

**Đã sửa:** `/v1/health` (readiness) gọi `AppStore.ping()` (`SELECT 1`) và trả `503` khi DB không truy cập
được. Thêm `/v1/health/live` (chỉ config, không chạm DB) và chuyển liveness probe trong
`terraform/stacks/04-dashboard/main.tf` sang endpoint này, để DB sự cố không làm restart pod.
`docs/OPERATIONS.md` đã cập nhật.

**Mức độ:** monitoring/ops tin rằng BFF khỏe trong khi toàn bộ DB-backed features đã chết.
Docs/OPERATIONS.md ghi "BFF readiness `/v1/health` trả 200" — con số này **không phản ánh**
trạng thái thật.

**Vị trí code:** `web/bff/src/server.ts` L541–554 — `/v1/health` chỉ gọi `runtimeConfig()`,
không ping Postgres. Kiểm chứng thực tế: `https://mlbox.june8th.me/api/bff/subscriptions/plans`
vẫn 200 và `/v1/health` vẫn `{"status":"ok","configured":true}` trong khi mọi endpoint
authenticated trả 503.

**Gợi ý sửa:**

- [ ] Tách `liveness` (process sống, chỉ check config) và `readiness` (`SELECT 1` vào appStore);
      readiness trả 503 khi DB down.
- [ ] Cập nhật docs/OPERATIONS.md: health check phải phản ánh DB trước khi coi BFF là healthy.

---

## ✅ Bug 4 — Login nuốt lỗi DB (silent failure) → user "đăng nhập được" nhưng phiên hỏng

**Quyết định đã áp dụng:** login **từ chối** khi DB không sẵn sàng (`503 APP_DATABASE_UNAVAILABLE`)
thay vì cấp phiên hỏng. `recordLoginSession` không còn nuốt lỗi, và được gọi trước khi lưu refresh token
và cookie. Trang Security (`SessionsCard`) đã có nhánh lỗi + "Try again", nên không còn hiển thị rỗng
giả khi API lỗi.

**Mức độ:** user vào được `/projects` rồi kẹt/toàn lỗi 503, không hiểu vì sao; bảng
`auth_sessions` không có dòng nào được ghi → trang Security (danh sách phiên, revoke) trống/sai.

**Vị trí code:** `web/bff/src/server.ts` ~L805–813 `recordLoginSession` — mọi lỗi DB bị bắt,
chỉ `request.log.warn`, login vẫn trả 200.

**Gợi ý sửa (quyết định sản phẩm):**

- [ ] Hoặc login trả lỗi rõ ràng khi `ensureAppBootstrap` fail (user biết ngay), hoặc giữ
      login best-effort nhưng mọi API sau đó phải có circuit-breaker/message rõ ràng thay vì
      503 generic.
- [ ] Nếu giữ best-effort, ít nhất trang Security nên hiển thị "không tải được danh sách"
      thay vì rỗng.
- [ ] Đối chiếu: `isAuthSessionActive` fail → 503 (không phải 401/403), nên phiên bị từ chối
      trông như "service lỗi" chứ không phải "phiên bị thu hồi" — xem lại cách map lỗi.

---

## Các kiểm tra đã chạy được (trước khi bị chặn)

- `https://mlbox.june8th.me/` và `/login` → **200**
- `https://notebook.mlbox.june8th.me/hub/login` → **302** → `/hub/mlbox/login` → **302** →
  `https://mlbox.june8th.me/login` (đúng flow: auth đi qua dashboard/BFF)
- `/api/bff/auth/csrf` → **200**; `/api/bff/projects` khi **chưa** đăng nhập → **401** (đúng)
- Đăng nhập UI với tài khoản test → redirect `/projects` (Cookie session được set, DynamoDB OK)
- `/projects` kẹt ở "Loading projects…" (Bug 2), root cause `503 APP_DATABASE_UNAVAILABLE` (Bug 1)
- Chưa kiểm tra được: create project, sandbox start/stop, notebook handoff, EFS persistence,
  billing metering, artifacts, teams, invitations — **đều bị chặn bởi Bug 1**.

## Ghi chú vận hành

- Screenshot trạng thái lỗi: `.openchamber/screenshots/page-2026-11-10T09-45-15-985.jpg`
  (gitignored theo `.openchamber/`, xem nội bộ máy này).
- Mật khẩu test user bị dán trong phiên chat ngày 2026-11-10 — theo docs/OPERATIONS.md, test
  user phải được xóa/disable sau khi kiểm tra xong; cần xoay mật khẩu này.
- Không đưa secret/log chứa token vào docs hoặc commit.
