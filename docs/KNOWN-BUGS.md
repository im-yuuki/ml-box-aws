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

---

# Kết quả verify E2E lần 2 — 2026-11-10 (sau khi deploy fix b9fbaa6)

Context: các fix Bug 1–4 đã merge (PR #11) và **đã deploy** — tfvars `04-dashboard` pin
`mlbox-{dashboard,bff}:b9fbaa6120da82a0e0c94fce1c5a82cf391d8fa6`. Máy test vẫn không có AWS
credentials, nên kết luận dựa trên black-box HTTP/browser.

## ✅ Phần đã kiểm chứng OK trên production

- `GET /api/bff/spaces` → **200**, trả đúng personal Space (`personal:f9fe0438-…`, role owner) → Bug 1 hết.
- `/projects` tải được, Space switcher hiện "Personal", empty-state "Start with a durable project" → Bug 2 hết (bundle mới).
- `/account/quota` render đủ dữ liệu (RAM 0/24 GB..., "No sandboxes are running") → Hub GET qua bridge token OK.
- Tạo project `e2e-verify-2026-11-10` (`b2d1bb61-…`) → điều hướng tới project overview OK.
- Logout từ account menu → về `/login`; login lại OK.
- `/account/security`: sau khi login LẠI, danh sách "Sign-in sessions" hiện phiên hiện tại ("This device",
  signed in 10/11/2026 5:24 PM) → Bug 4 hết end-to-end.
- `/hub/login` → 302 → `/hub/mlbox/login` → 302 → dashboard login (đúng flow); `/hub/health` → 200 (v5.5.2).

## ✅ Bug 5 — Sandbox START thất bại trên production: "Could not start the sandbox. Try again."

**Nguyên nhân (đã xác nhận từ log):** `kubectl -n dashboard logs deploy/bff` có `JupyterHub returned 404`
ở `Project sandbox start failed`; log Hub có `404 GET /hub/api/users/cognito-…` rồi `404 POST …/servers/<projectId>`
và **không có** `POST /hub/api/users/cognito-…` (tạo user). Route `POST /v1/projects/:id/sandbox/start`
(`web/bff/src/server.ts`) hard-code `userExists: true` nên `startHubSandbox` không bao giờ provision user
trên Hub khi user chưa có. BFF đã có identity trong DB nhưng Hub không có user đó → mọi lần start đều 404.

**Sửa:** lấy `hubUserExists` từ kết quả GET user (404 → `false`) và truyền vào `startHubSandbox`, giống
route `/v1/sandboxes` đã làm đúng.

**Mức độ:** chặn toàn bộ luồng notebook (không spawn được → không handoff → không test EFS → không start/stop).

**Hiện tượng (lặp lại 2/2 lần, 2026-11-10 ~10:22–10:23):**

- Vào `/projects/b2d1bb61-…`, chọn `c1.large` (cpu-small), bấm Start → hiển thị lỗi chung
  "Could not start the sandbox. Try again." (state giữ nguyên `Stopped`, không có crash trong UI).
- Trước đó lần bấm đầu tiên báo `PROJECT_OWNER_NOT_READY`; sau khi mở `/account/quota` (gọi `/v1/usage`,
  persist Hub identity), lỗi đổi sang `startFailed` — tức bước Hub identity đã xong.
- `/hub/health` → 200, `/hub/api` → `{"version":"5.5.2"}`, Hub GET (`/v1/usage`) trả 200 → Hub sống,
  bridge token auth hoạt động ít nhất cho GET. Lỗi nằm ở bước start: `ensureRuntimeHubUser` (POST
  `/hub/api/users/cognito-<sub>`) hoặc spawn POST `/hub/api/users/<u>/servers/<name>`.
- Chưa kiểm chứng trên cluster sau fix: pod singleuser, PVC `mlbox-<projectId>` và image singleuser (chưa xem;
  nếu lỗi tiếp theo là ImagePullBackOff hoặc PVC Pending thì đây là nguyên nhân mới).
- [ ] Verify E2E full flow sau deploy: start → Running → Open notebook (handoff) → ghi file →
      stop → start lại → file còn trên EFS → stop → (xóa project test nếu user đồng ý).

**Dữ liệu còn lại từ smoke test:** project `e2e-verify-2026-11-10` (id `b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0`)
trong personal Space của test user; Hub identity `cognito-…` đã được persist; Hub server record có thể ở
trạng thái stopped. Giữ lại để debug tiếp; chỉ xóa khi user xác nhận.

## ✅ Bug 6 — `PROJECT_OWNER_NOT_READY`: màn hình báo "owner cần đăng nhập dashboard một lần" nhưng đăng nhập KHÔNG tạo Hub identity

**Vị trí:** `web/bff/src/server.ts` — Hub identity chỉ được persist qua các Hub-dependent routes
(`/v1/usage`, `/v1/usage/history`, `/v1/sandboxes*`, `/v1/hub/handoff`), còn `/v1/projects/:id/sandbox/start`
(`ensureProjectSandboxRuntime`, app-store.ts L1079) chỉ join `mlbox_hub_identities` và báo NOT_READY.

**Hệ quả:** user vừa login lần đầu, vào project và bấm Start ngay → 409 `ownerNotReady`, message hướng dẫn
sai (đăng nhập rồi vẫn không khởi động được cho tới khi mở trang Usage/Quota).

**Đã sửa:** route `POST /v1/projects/:id/sandbox/start` gọi `resolveSessionHubIdentity` +
`persistSessionHubIdentity` trước `ensureProjectSandboxRuntime`, nên lần start đầu tiên không còn phụ thuộc
trang Usage. Giới hạn: chỉ persist identity của người đang gọi; nếu chủ Project chưa từng đăng nhập dashboard
thì vẫn báo `PROJECT_OWNER_NOT_READY` (đúng nghĩa).

## ✅ Bug 7 (nhỏ) — Sessions list hiển thị UA tiếng Việt trên UI tiếng Anh

`/account/security` (en) hiển thị tên phiên "Trình duyệt không xác định" (fallback user-agent khi parse
thất bại). Nên localize theo `mlbox-locale` như các chuỗi khác.

**Đã sửa:** `describeUserAgent` trả `null` khi không nhận diện được; dashboard hiển thị `account.unknownBrowser`
theo locale (en: "Unknown browser", vi: "Trình duyệt không xác định").

## Ghi chú verify

- Screenshots: `.openchamber/screenshots/page-2026-11-10T10-21-53-624.jpg` (project overview + sandbox card),
  `…T10-22-10-004.jpg` (startFailed), `…T10-22-54-536.jpg` (Stopped sau reload), `…T10-23-02-999.jpg`
  (startFailed lần 2), `…T10-24-41-239.jpg` (logout → /login), `…T10-25-10-455.jpg` (Security: phiên hiện tại).
- Mật khẩu test user vẫn nằm trong phiên chat 2026-11-10 — cần xoay/disable sau khi test xong.

---

# Kết quả verify E2E lần 3 — 2026-11-10 ~10:43–11:03 (sau deploy `3907aad`)

Deploy: `04-dashboard/terraform.tfvars` pin `mlbox-{dashboard,bff}:3907aad68574d1b170dfe8600ca9d8fb0129d3bd`.
Xác nhận bundle mới đã lên production (HTML chứa `account.unknownBrowser`, `navbar.spacesUnavailable`,
`projectArtifacts.storageEnabled`; build id đổi). Máy test vẫn không có AWS credentials.

## ✅ Đã verify OK

- **Bug 5 (start sandbox):** Start `c1.large` → `Starting` → `ready` (~40 s). Hub user được provision,
  singleuser pod chạy được, image pull OK. `GET /api/bff/projects/<id>/sandbox` → `state: "ready"`,
  `profile: cpu-small`, `url` = `https://notebook.mlbox.june8th.me/user/cognito-f9fe0438-…/<projectId>/`.
- **Vòng đời stop/start:** Stop → `stopped`; Start lại → `ready`. Dùng lại được PVC EFS
  (`mlbox-<projectId>`, storage class `efs-sc`) — không lỗi bind.
- **Bug 6 (owner identity):** không còn `PROJECT_OWNER_NOT_READY` khi bấm Start.
- **Billing metering trên Postgres thật:** `/account/quota` hiện **Compute units 0.2 / 20** (gói Free),
  RAM 4/24 GB, "Recorded runtime: 0.27 h in the last 30 days" → session đóng/mở được ghi vào DB thật.
- **Usage history:** `/account/quota` vẽ được chart (RAM allocated / CPU allocated) — trước đây báo
  "not configured".
- **Realtime footprint:** 1 running sandbox, 0 pending, 2 cores, 4 GB → đọc pod spec trong namespace `hub` OK.
- **Plan gate GPU:** chọn `g1.xlarge` (1 GPU T4 chia sẻ) → Start → bị chặn đúng:
  "This configuration is included in paid plans. Upgrade your plan to start it." (403 `GPU_NOT_IN_PLAN`).
  Trả lại `c1.large` → Start OK.
- **Artifact storage:** bật "Keep artifacts" → switch ON, hiện "Choose a file to upload" + feedback
  "Artifact storage is on." (các key feedback mới của bundle `3907aad` đã live).

## ✅ Bug 8 — "Open notebook" không mở được notebook: UI không dùng handoff, bị đá về trang login

**Mức độ:** chặn bước cuối của E2E (JupyterLab + verify file trên EFS). Mọi tính năng khác đã chạy.

**Hiện tượng (lặp lại 3/3 lần):**

- Sandbox `Running` → bấm **Open notebook** → tab mới mở URL Hub
  `https://notebook.mlbox.june8th.me/user/cognito-f9fe0438-…/b2d1bb61-…/` → Hub không có session →
  redirect `…/hub/mlbox/login` → handler không có `code` → redirect `https://mlbox.june8th.me/login`.
- Trang login hiện form (dù user đã đăng nhập dashboard) → người dùng bị kẹt ở vòng lặp đăng nhập.
- Probe trực tiếp `https://notebook.mlbox.june8th.me/hub/mlbox/login?code=…` (code giả) → cũng về
  `mlbox.june8th.me/login` (đúng hành vi khi code sai).

**Nguyên nhân (đã xác nhận trong code):**

- Cơ chế handoff **đã có đầy đủ ở BFF**: `POST /v1/hub/handoff` (mint code 60 s, chỉ lưu hash) và
  `/internal/v1/hub/handoff/redeem` (Hub redeem bằng bridge token). Dashboard cũng có proxy route
  `web/dashboard/src/app/api/bff/hub/handoff/route.ts`.
- **Nhưng không có UI nào gọi route đó**: `grep -r "hub/handoff" web/dashboard/src` chỉ ra chính file route.
  `ProjectRuntimePanel.tsx` (L87) và `ProjectRuntimeControl.tsx` (L26) đều là
  `window.open(url, "_blank")` với `url` = server URL thô từ `GET /v1/projects/:id/sandbox`.
- ⇒ Tính năng "Mở notebook qua mã handoff một lần" (TODO.md mục "✅ Mở notebook qua mã handoff một lần")
  **chưa bao giờ được nối vào UI** → mở notebook luôn thất bại.

**Đã sửa:** thêm helper `openNotebookViaHandoff` (`web/dashboard/src/lib/notebookHandoff.ts`), dùng ở
`ProjectRuntimePanel` và `ProjectRuntimeControl`. Helper mở tab trước khi `await` (tránh bị chặn popup), gọi
`POST /api/bff/hub/handoff` với `path` tương đối `/user/<hubUser>/<server>/` (đúng với `sanitizeNextPath`),
rồi đặt `location` tới URL có code. Lỗi hiện thông báo `projectRuntime.openFailed` và đóng tab trắng.

- [x] Nối "Open notebook" vào handoff (đã làm).
- [x] Fallback khi handoff lỗi: thông báo rõ thay vì mở tab trắng (đã làm).
- [ ] Test lại sau deploy: Open notebook → JupyterLab mở thẳng (không còn vòng lặp login) → tạo file →
      stop → start → file còn → xác nhận EFS persistence (TODO.md "⚠️ Notebook storage EFS" chỉ còn
      thiếu bước này).

## Chưa verify được (giới hạn công cụ, không phải lỗi app)

- Upload artifact: browser panel không hỗ trợ set file input (`input[type=file]`) → chỉ verify được
  bật/tắt storage, chưa verify upload/list/download. **Đã verify lại ở lần 4 bằng chrome-devtools (xem dưới).**
- Cross-tenant / hai danh tính thật (TODO "Kiểm tra cross-tenant trên cluster thật") — cần tài khoản thứ hai.

## Ghi chú trạng thái

- Project test `e2e-verify-2026-11-10` (`b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0`) để lại, artifact storage đang **bật**,
  sandbox `c1.large` **đang chạy** (để test lại luồng notebook sau khi vá Bug 8). Dừng: bấm Stop trên
  trang project; xóa: nút "Delete project" (kỳ vọng xóa luôn PVC + access point EFS).
- Screenshots: `.openchamber/screenshots/page-2026-11-10T10-43-37-287.jpg` (Starting), `…T10-57-59-635.jpg`
  (quota: compute units 0.2/20 + history), `…T10-59-47-453.jpg` (plan gate GPU), `…T11-02-31-209.jpg` (Running),
  `…T11-02-58-935.jpg` (artifact storage on).

---

# Kết quả verify E2E lần 4 — 2026-11-10 ~11:20–11:30 (sau deploy `5040a71`)

Deploy: `04-dashboard/terraform.tfvars` pin `mlbox-{dashboard,bff}:5040a710cf55f5ade358e71604b3294fc8a5da21`;
đã xác nhận bundle mới live qua key `projectRuntime.openFailed` trong HTML phục vụ.
Công cụ: browser panel cho UI + chrome-devtools (`evaluate_script`) cho các bước cần POST/PUT/websocket
(JupyterLab không đọc được DOM bằng browser panel).

## ✅ Bug 8 — "Open notebook" đã được vá, hoạt động end-to-end

- Bấm "Open notebook" → tab mới mở `https://notebook.mlbox.june8th.me/hub/mlbox/login?code=<mã 1 lần>&next=/user/<hubUser>/<projectId>/`
  → Hub redeem code qua bridge token → chuyển thẳng tới
  `https://notebook.mlbox.june8th.me/user/cognito-f9fe0438-…/b2d1bb61-…/lab`, title **JupyterLab**.
- Không còn vòng lặp về `/login`. Handoff cũng chạy lại được sau khi sandbox restart (code mới mỗi lần).

## ✅ Notebook storage EFS — verify đầy đủ (đóng nốt TODO "⚠️ Notebook storage EFS")

Chuỗi đã chạy trên project `e2e-verify-2026-11-10`:

1. Sandbox `c1.large` → `ready` (pod singleuser chạy, PVC `mlbox-<projectId>` trên `efs-sc`).
2. Tạo file trong workspace qua Jupyter Contents API: `PUT /api/contents/e2e-proof.txt` → **201**,
   size 27 byte, nội dung `mlbox-efs-proof-2026-11-10`.
3. `GET /api/contents/e2e-proof.txt` → 200, đọc lại đúng nội dung.
4. **Stop** sandbox → `stopped`. **Start** lại → `starting` → `ready` (pod mới, `serverStarted` đổi).
5. `GET /api/contents/e2e-proof.txt` → **200**, nội dung `mlbox-efs-proof-2026-11-10`,
   `last_modified` = 11:24:08 (pod cũ) trong khi `serverStarted` = 11:25:57 (pod mới).

⇒ File sống sót qua full pod restart ⇒ nhà ở `/home/jovyan` nằm trên PVC/EFS, không phải filesystem container.
(`e2e-proof.txt` còn nằm trong workspace để agent sau kiểm tra; xóa: xoá file trong JupyterLab.)

## ✅ Artifact (S3) — verify đầy đủ upload → list → download

- `POST /api/bff/projects/<id>/artifacts` → **201** + presigned PUT URL (`upload.method = PUT`).
- `PUT` nội dung lên S3 → **200**.
- `POST .../artifacts/<id>/complete` → 200, artifact chuyển `ready`.
- `GET .../artifacts` → list có `artifact-proof.txt`, 32 byte, `ready`.
- `GET .../artifacts/<id>/download` → 200 + presigned GET → tải về đúng nội dung `mlbox-artifact-proof-2026-11-10`.

## ☐ Bug 9 — `useActiveSpace()` bị instantiate 4 lần → request trùng + trạng thái lệch nhau giữa các panel

**Mức độ:** trung bình. Hiện tượng quan sát được lúc ~11:27 trên trang project: navbar hiện
**"Workspaces unavailable"** trong khi thân trang vẫn quay **"Loading projects…"** — hai component cùng
trang nói hai điều khác nhau về cùng một nguồn dữ liệu.

**Nguyên nhân:** `useActiveSpace()` được gọi trong **4** component, mỗi lần tạo state riêng và tự gọi
`GET /api/bff/spaces`:

- `web/dashboard/src/components/navbar/SpaceSwitcher.tsx:18`
- `web/dashboard/src/components/ProjectBoard.tsx:55`
- `web/dashboard/src/components/ProjectDetail.tsx:28`
- `web/dashboard/src/components/TeamBoard.tsx:27`

Hệ quả: (a) mỗi trang bắn 2 request `/api/bff/spaces` trùng nhau; (b) khi một request lỗi (lỗi mạng
thoáng qua, hoặc request chạm mốc hết hạn access token 1h), component này báo lỗi còn component kia
vẫn ở trạng thái loading ⇒ UI mâu thuẫn; (c) fix Bug 2 chỉ sửa phần hiển thị, không sửa nguồn.

**Gợi ý sửa:** đưa `useActiveSpace` lên thành provider/context (một instance ở layout `(app)`),
các component consume từ đó ⇒ 1 request, 1 nguồn sự thật.

## Ghi chú

- `POST /api/bff/auth/refresh` chạy **song song 2 lần** đều trả 200 (Cognito chấp nhận reuse refresh
  token trong grace window) ⇒ không phải nguyên nhân làm chết session; session sau khi refresh vẫn dùng
  được (`GET /api/bff/spaces` → 200).
- Session hiện tại: đăng nhập lúc ~11:0x, access token TTL 1h; hết hạn thì `bffFetch` refresh tự động.
- Dữ liệu còn lại: project `e2e-verify-2026-11-10` (artifact storage **bật**, 1 artifact S3), file
  `e2e-proof.txt` trong EFS, sandbox `c1.large` **đang chạy**. Xóa: nút "Delete project" trên trang project
  (kỳ vọng xóa cả PVC + access point EFS — bước này **chưa** verify vì cần xác nhận xóa project).
- Máy test không có AWS credentials ⇒ chưa verify được: pod spec/EFS access point ở tầng kubectl, và
  việc xóa Project có xóa PVC/access point hay không (TODO "BFF xóa PVC của Project khi xóa Project").

---

# Kết quả verify E2E lần 5 — 2026-11-11 (sau deploy `f19bc22`, có thêm tính năng mới)

Deploy: `mlbox-{dashboard,bff}:f19bc22b061dbef15b5e9058f1641d7cdf59f154` (tfvars `04-dashboard`).
Lần này verify **cả lỗi thiết kế giao diện** (terminology, layout, trạng thái, responsive, i18n).
Công cụ: chrome-devtools (`evaluate_script`, a11y snapshot, viewport 360/1440) + browser panel.

Tính năng mới trong bản này: logo/brand mới, Organization (owner/admin/member) + tạo organization,
Account pages mới (profile/subscription/quota/security), quota theo credits + lịch sử credit, project list
hiện instance đang chạy, toast thay cho feedback inline, toàn bộ route account chuyển sang
`/quota`, `/security`, `/subscription` (URL cũ `/account/*` → 404, nhưng không còn link nào trỏ vào).

## ✅ Chức năng mới chạy đúng (đã kiểm trên production)

- Tạo organization: switcher → "Create team" → dialog "New team" → tạo `e2e-org-2026-11-11` → tự chuyển
  sang org, toast báo thành công, danh sách project của org rỗng + empty state.
- Trang Teams của organization: Members (role Owner), Invite members (ghi lời mời, hiện pending + Revoke),
  Danger zone "Delete team".
- Tạo project trong organization (không cần chọn team) → project detail → **start sandbox trong org OK**
  (`starting` → `ready`) → stop OK.
- Toast: bật/tắt "Keep artifacts" → toast "Artifact storage is off." góc dưới phải, có live region.
- Interface settings: đổi **English → Tiếng Việt** (dịch đúng) và **Dark → Light** (render sạch, không vỡ layout).
- Trang profile (tên, chức danh, ngày sinh, giới tính, múi giờ, avatar), security (đổi mật khẩu + danh sách phiên),
  subscription, quota — tất cả render và tải dữ liệu thật.
- Tìm kiếm ở navbar lọc được danh sách project.

## ☐ Bug 10 (cao) — Trang Quota/Usage luôn hiện Space **cá nhân**, bỏ qua Space đang chọn

- **Chứng minh:** `GET /api/bff/usage` với `?spaceId=org:…`, `?spaceId=personal:…` và không có param
  trả **cùng một kết quả**: `planId personal_pro, limit 300`, cùng danh sách credit session (chỉ project
  của personal space), `concurrentSandboxes {limit 5, running 1}` — không tính sandbox đang chạy trong org.
- **Nguyên nhân:** `web/bff/src/server.ts:2116` — `const spaceId = \`personal:${session.subject}\`` (hard-code).
  Trong khi route start (`server.ts:1748-1765`) lại dùng `spacePlan.spaceId` (đúng Space của project) cho
  credit pool và giới hạn sandbox đồng thời ⇒ **hai phạm vi tính phí khác nhau trong cùng sản phẩm**.
- **Hệ quả giao diện:** đang ở org mà trang Quota vẫn hiện "Credits left 293.2 / 300" (gói `personal_pro`),
  trong khi project của org chạy trên gói Free (20 credit, 1 sandbox, 5 GB, 7 ngày) — hai con số mâu thuẫn
  ngay trên cùng màn hình.
- **Gợi ý sửa:** `/v1/usage` nhận `spaceId` (đã có sẵn ở các route khác) và mặc định theo Space đang chọn;
  dashboard truyền `spaceId` của active space; ghi rõ trên trang "Quota của Space X".

## ☐ Bug 11 (cao) — Subscription hiện raw API key + sai đơn vị

- `web/dashboard/src/app/(app)/subscription/BillingPanel.tsx:187-202` (`quotaLabel`) chỉ map
  `projects`/`storage_gb`/`credits`/`members`; `concurrent_sandboxes` và `gpu_access` rơi vào nhánh
  `return resource` ⇒ lộ raw key.
- `BillingPanel.tsx:253-260` dùng `t("billingHours")` cho mọi resource khác ⇒ "concurrent_sandboxes: **5 hours**",
  "Credits: **300 hours**", "gpu_access: **1 hours**".
- Quan sát được cả ở bản en và vi (vi hiện "5 giờ", "300 giờ", "1 giờ").

## ☐ Bug 12 (trung bình) — Thanh tiến độ ngược nghĩa với nhãn

- `web/dashboard/src/components/UsagePanel.tsx:104`: `creditsPercent = creditsUsed / creditsLimit` ⇒ thanh
  hiển thị **phần đã dùng**, nhưng tiêu đề là "Credits left this month 293.2" và dòng phụ "293.2 of 300 credits
  left" ⇒ ở 98% còn lại thanh vẫn gần như trống. Tương tự với storage.
- Gợi ý: vẽ phần **còn lại**, hoặc đổi nhãn thành "Used" cho khớp.

## ☐ Bug 13 (trung bình) — Lẫn lộn "team" và "organization"

- Switcher dùng icon tòa nhà + tên org, nhưng action là "**Create team**", dialog "**New team**", field
  "**Team name**", trang là "**Teams**", danger zone "**Delete team**", copy "members and invitations of the
  **selected team**". Mô hình mới là Organization (Space) — user không biết "team" và "organization" có phải
  là hai thứ khác nhau không.
- Gợi ý: thống nhất "Organization" cho Space/đội phẳng (tên action, dialog, tiêu đề, copy), dùng "Team" chỉ
  khi nói về nhóm con thực sự.

## ☐ Bug 14 (trung bình) — Project của organization bị gắn nhãn "Personal Space"

- `web/dashboard/src/components/ProjectDetail.tsx:125-131` dùng `t("personalSpace")` cho trường Space của
  mọi project ⇒ project trong org hiện "**Personal Space**" với giá trị `org:79c6539d-…` (và nhãn này cũng
  được dùng làm aria-label của nút copy).

## ☐ Bug 15 (trung bình) — Chọn gói không phản ánh gói hiện tại

- Gói hiện tại là `personal_pro`, nhưng radio "Personal Free" đang được chọn và CTA ghi "**Pay for Personal
  Free**" ⇒ bấm là **hạ gói** (kèm giao dịch mock $0).
- Gợi ý: preselect gói hiện tại, hoặc disable CTA khi đang ở gói đó.

## ☐ Bug 16–24 (thấp/trung bình) — Vấn đề giao diện khác đã quan sát

| # | Vấn đề | Vị trí / bằng chứng |
|---|---|---|
| 16 | Project list hiện chip instance của project **đang dừng** mà không nói rõ là "next launch" (chi tiết có ghi "Next launch:", list thì không) | `/projects` → "test1 · d1.xlarge · GPU instance · Start" |
| 17 | Raw plan id trong copy người dùng: "personal_pro" làm tên gói hiện tại, "personal_pro - Succeeded" trong lịch sử thanh toán; các dòng thanh toán **không có ngày** | trang `/subscription` |
| 18 | Card "Sandboxes running at once" là banner full-width, canh giữa, lệch style với 2 stat card phía trên (canh trái, số lớn) | trang `/quota` |
| 19 | Số liệu storage format không nhất quán: project page "32 B of 100 GB used" vs Quota "Storage by project: **0 GB** · 0% of quota" | `/quota` (bytes bị làm tròn về 0) |
| 20 | **Mobile 360px tràn ngang** ở trang Subscription: `scrollWidth 379 > 360`, 3 card gói bị cắt tên | đo bằng `document.documentElement.scrollWidth` |
| 21 | Trang login/register không canh giữa dọc: card nằm ở 1/3 trên, còn lại trống | `/login`, `/register` |
| 22 | Landing page không nhận biết đã đăng nhập (vẫn hiện "Sign in / Create account"); danh sách feature chỉ còn tiêu đề (chuỗi `features.*.body` không dùng); không có footer | `src/app/page.tsx` |
| 23 | Switch "Keep artifacts" nằm **trên** nhãn; khi tắt, nhãn bị làm mờ trông như lỗi | card Artifacts |
| 24 | Lời mời pending không có tiêu đề hiển thị (chỉ có aria-label), role hiện raw lowercase "member" trong khi badge member viết "Owner" | trang Teams của org |

### Ghi chú a11y

- Searchbox chứa nút "Close" bên trong (`button "Close"` trong `search`) — nhãn a11y lạ cho nút xoá.
- Toaster có live region (`role=status`/`log`) — tốt.
- Focus vào dialog: đã kiểm — mở "New project" thì focus vào ô tên (đúng), đóng bằng Escape thì focus trả về
  nút "New project" (đúng).
- Cần kiểm tra thêm: contrast ở light theme, focus trap khi mở menu.

## ☐ Bug 25–36 — Rà soát thiết kế ở tầng code (agent phụ, đã đối chiếu lại với bản live)

Ký hiệu: **[đã xác minh live]** = quan sát được trên production; *(chỉ code)* = suy ra từ mã nguồn.

### Cao

- **☐ Bug 25 [đã xác minh live] — Khoá JSON trùng làm mất nhãn mới.**
  `web/dashboard/src/messages/en.json:196` và `:230` đều là `usage.historyHeading` ("Last 30 days" vs
  "Usage history"); `vi.json:196`/`:230` tương tự. `JSON.parse` giữ giá trị sau ⇒ trang Quota hiện
  "Usage history" (đã quan sát live) và nhãn "Last 30 days" / "30 ngày gần nhất" là code chết.
  *Cách sửa:* xoá dòng 230 ở cả 2 file, thêm CI check trùng khoá JSON.
- **☐ Bug 26 [đã xác minh live] — Lỗi inline bị đổi thành toast 4 giây.**
  `web/dashboard/src/components/FeedbackAlert.tsx:20-32` render `null` và bắn toast; các form
  (`LoginForm.tsx:91`, `RegisterForm.tsx:103`, `VerifyForm.tsx:146`, `PasswordRecoveryForm.tsx:107`,
  `CreateOrganizationDialog.tsx:66`, `OrganizationDangerZone.tsx:81`, `ProjectDeleteButton.tsx:57`) mất hết
  lỗi tại chỗ. Live: sai mật khẩu trên trang `/login` (bản English) **chỉ** có toast ở góc dưới phải, không
  có lỗi cạnh form. Thêm nữa, toast được raise trong `useEffect` phụ thuộc `children` ⇒ lần lỗi thứ hai
  cùng nội dung không hiện gì.
  *Cách sửa:* giữ `Alert` cho lỗi form/inline, toast chỉ dùng cho kết quả nền; nếu cần toast thì thêm key.
- **☐ Bug 27 [đã xác minh live] — Thông báo lỗi của BFF hard-code tiếng Việt, lọt sang UI tiếng Anh.**
  Live: sai mật khẩu trên trang login English hiện "**Email hoặc mật khẩu không đúng.**"; các lỗi khác
  ("Dịch vụ ứng dụng tạm thời không khả dụng.", "Chủ Project cần đăng nhập dashboard một lần để khởi tạo
  runtime.") cũng là tiếng Việt trong `web/bff/src/server.ts`.
  *Cách sửa:* BFF trả `error` code + message tiếng Anh hoặc chỉ trả code, dashboard tự dịch theo locale.

### Trung bình

- **☐ Bug 28 (chỉ code) — Dropdown role rỗng với admin.** `components/OrganizationMembers.tsx:150-167`:
  option `admin` chỉ được thêm khi `actor === "owner"`, nhưng Select hiển thị cho mọi manager ⇒ admin thấy
  trigger trống trên dòng của chính mình.
- **☐ Bug 29 (chỉ code) — Từ vựng role không nhất quán trong vi.** `vi.json:364-365` dùng "Quản trị"/"Người
  xem" ở card Members nhưng `:487-488` dùng "Quản trị viên"/"Chỉ xem" ở card Lời mời; navbar lại dùng "Chủ
  sở hữu" cho Owner.
- **☐ Bug 30 (chỉ code) — Sau khi chuyển quyền sở hữu, chủ cũ vẫn thấy danger zone.** `TeamBoard.tsx:66` +
  `OrganizationMembers.tsx:109-120` không gọi `notifySpacesChanged()` ⇒ `activeSpace.role` vẫn "owner" ⇒
  "Delete team" vẫn hiện (bấm thì mới nhận lỗi forbidden).
- **☐ Bug 31 (chỉ code) — Xoá member không cần xác nhận.** `OrganizationMembers.tsx:178-188` nút ghost gọi
  DELETE ngay, chỉ có toast; trong khi xoá team bắt nhập tên (đúng pattern). Không nhất quán với hành vi
  destructive khác.
- **☐ Bug 32 (chỉ code) — Danger zone báo sai lỗi.** `OrganizationDangerZone.tsx:12-16,86`: lỗi FORBIDDEN
  khi xoá team lại map sang `memberForbidden` ("You cannot manage members of this team"); nút Delete bị vô
  hiệu khi chưa gõ đúng tên mà không có chú thích giải thích.
- **☐ Bug 33 (chỉ code) — "Storage by project: % of quota"** (`UsagePanel.tsx:192`) tính theo quota của cả
  workspace ⇒ gợi ý sai rằng mỗi project có hạn riêng.
- **☐ Bug 34 (chỉ code) — Chart chỉ hiện giá trị khi hover, bỏ qua series storage.**
  `ResourceHistory.tsx:36,52-59`: giá trị nằm trong `<title>` (không dùng được trên touch) và API trả
  `resourceHistory.storage` nhưng không được vẽ.

### Thấp

- **☐ Bug 35 (chỉ code) — Dialog tạo team:** `CreateOrganizationDialog.tsx:62` chỉ có placeholder (không có
  `<Label>`), không `autoFocus`, và chuỗi `"Team created."` tồn tại nhưng không được raise.
- **☐ Bug 36 (chỉ code) — Member không có email hiện UUID bị cắt:** `OrganizationMembers.tsx:122,141` dùng
  `member.userId` rồi `truncate` không kèm `title`/copy.

### Những điểm tốt (không cần sửa)

- `CreditSessionList.tsx:31-32` — bảng session có `overflow-x-auto` + `min-w-[32rem]` ⇒ cuộn ngang thay vì
  vỡ layout ở 360px (đúng pattern).
- `OrganizationDangerZone.tsx:25,77-88` — xoá team bắt nhập đúng tên, disable nút cho tới khi khớp, reset state
  khi đóng: pattern xác nhận destructive tốt.
- `Toaster.tsx` + `FeedbackAlert.tsx:7-19` — một vùng toast toàn cục, có dedupe chống double-fire StrictMode.
- `OrganizationMembers.tsx:144-148` + `AccountMenu.tsx:15-20` — phân biệt role bằng màu + icon + chữ, không phụ
  thuộc màu đơn thuần.
- `ProjectRow.tsx:20-26` — đưa loại instance đang chạy lên ngay dưới tên project là cải thiện thật.

## Chưa verify được

- Xóa Project → xoá PVC + access point EFS (cần kubectl/AWS credentials).
- Cross-tenant với hai danh tính thật (cần tài khoản thứ hai).
- Luồng nhận lời mời bởi user khác (cần tài khoản thứ hai).

---

# Kết quả verify — GPU & Artifacts (2026-11-11 ~01:20–02:10, deploy `f19bc22`)

## ☐ Bug 37 (cao) — GPU không spawn được: Hub báo "Spawn failed" cho cả 2 profile GPU

**Đã kiểm chứng live:**

| Profile | Kết quả |
|---|---|
| `cpu-small` (c1.large) | ✅ `starting` → `ready` (~10 s) |
| `gpu-l4-shared` (g1.xlarge, T4 time-slicing) | ❌ Hub: **"Spawn failed"** (màn hình /hub/spawn) |
| `gpu-dedicated` (d1.xlarge) | ❌ kẹt `starting` ~2 phút rồi rơi về `stopped` (spawn timeout) |

- Plan gate GPU **đúng**: project thuộc Space Free (org) bị chặn `403 GPU_NOT_IN_PLAN`; Space cá nhân
  (gói `personal_pro`, có GPU) được phép qua gate ⇒ lỗi nằm sau plan gate, ở tầng Hub/cluster.
- Hub tạo server record nhưng không có pod nào chạy (`/hub/home` liệt kê server ở trạng thái stopped,
  "Last activity … 3 minutes ago").
- **Nguyên nhân chưa xác định** (máy test không có kubectl): khả năng cao là *node GPU không được
  provision/schedule* (Karpenter NodePool `gpu-shared-l4` đã từng phải patch tay label
  `nvidia.com/device-plugin.config=any`; quota G/VT = 8 vCPU) hoặc *image GPU không pull được*.
  Cần: `kubectl -n hub logs deploy/hub` (lý do spawn fail), `kubectl get pods -n hub` (ImagePullBackOff
  vs Unschedulable), `kubectl get nodepools` (Karpenter), `aws service-quotas` (G quota).
- Lưu ý: image singleuser đang chạy là `ghcr.io/im-yuuki/mlbox-cpu:dbcd98f…` (biến env `JUPYTER_IMAGE`
  trong pod) ⇒ **tag ảnh runtime đang lệch 1 release** so với dashboard/BFF (`f19bc22`); nên kiểm tra
  cả image `mlbox-gpu` ở tag tương ứng.

## ☐ Bug 38 (trung bình) — Start bị no-op im lặng khi sandbox đang chạy

- `POST /v1/projects/:id/sandbox/start` với profile khác khi server đang `ready` trả **200 với state của
  server cũ** (`server.ts:1744-1746` — `if (!shouldStartHubSandbox(existing)) return { ok: true, state: … }`),
  **bỏ qua profile được yêu cầu** và không có thông báo nào cho UI.
- Quan sát live: yêu cầu `gpu-dedicated` trong khi sandbox CPU đang chạy ⇒ trả `state: ready`, profile vẫn
  là `cpu-small`, không có cảnh báo. Người dùng tưởng đã đổi sang GPU.
- Gợi ý: trả 409 `ALREADY_RUNNING` kèm profile hiện tại, hoặc cho phép đổi profile khi đang chạy.

## ☐ Bug 39 (trung bình, sản phẩm) — Artifact (S3) không thể truy cập được từ trong sandbox

Kiểm tra trực tiếp trong pod (terminal Jupyter qua WebSocket):

- `/home/jovyan` là **mount EFS**: `127.0.0.1:/ on /home/jovyan type nfs4 (rw,…)`, `df -h` → `8.0E` ⇒ đúng
  "shared storage" như mô tả.
- File `e2e-proof.txt` (27 B, tạo 10/11 11:24) **vẫn còn** sau khi pod restart (server started 10/11 18:45)
  ⇒ **persistence EFS xác nhận lại trên bản deploy hiện tại**.
- Nhưng artifact của dashboard **không có đường vào sandbox**: `/mnt` rỗng, không có file nào chứa
  "artifact" trong home, **không có AWS CLI** (`aws: No such file or directory`), không có `/etc/aws`,
  không có biến môi trường MLBOX/S3 ⇒ **không thể tải artifact từ trong notebook**, và file trong
  notebook cũng không xuất hiện trong danh sách artifact.
- ⇒ Hai kho dữ liệu (EFS của notebook và S3 của dashboard) hoàn toàn tách rời. Nếu sản phẩm muốn
  "artifact trong dashboard = file trong notebook" thì còn thiếu cầu nối (mount S3 vào pod, sidecar đồng bộ,
  hoặc API đọc artifact từ notebook).

## ✅ Artifacts — luồng UI hoạt động đầy đủ (đã kiểm chứng live qua giao diện)

| Bước | Kết quả |
|---|---|
| Upload qua UI (nút "Choose a file to upload") | ✅ file `mlbox-artifact-ui-test.txt` (85 B) vào danh sách, storage "117 B of 100 GB used", toast "File uploaded." |
| Download qua UI (nút "Download") | ✅ file tải về `~/Downloads/mlbox-artifact-ui-test.txt` (85 B, đúng nội dung) |
| Tắt storage | ✅ hỏi xác nhận "Turn off artifact storage? This permanently deletes 2 stored artifacts…" → Cancel giữ nguyên dữ liệu; "Delete files and turn off" → xoá hẳn (list rỗng, 0 B) + toast "Artifact storage is off." |
| Bật lại + upload | ✅ khôi phục được (storage ON, 1 artifact `ready`) |

Ghi chú thiết kế liên quan (xem Bug 16–24): tiêu đề card là "Storage" nhưng nhãn switch là "Keep artifacts";
switch nằm trên nhãn; số liệu storage ở Quota hiện "0 GB" cho 32 B.

## Dữ liệu còn lại

- Project `e2e-verify-2026-11-10`: storage **bật**, 1 artifact `mlbox-artifact-ui-test.txt` (85 B); sandbox đã
  **dừng** sau các phép thử GPU.
- Trong sandbox còn file `untitled.txt` (12 B, tạo bởi phiên khác — không phải của lần verify này) và
  `e2e-proof.txt` (27 B) trên EFS.

---

# Kết quả sửa (2026-11-11 ~02:00–02:40) — GPU đã chạy được

Đã có AWS credentials (SSO profile `AdministratorAccess-451058046864`) + kubectl ⇒ chẩn đoán và sửa
trực tiếp trên production.

## ✅ Bug 37 (GPU không spawn được) — ĐÃ SỬA & DEPLOY, verify bằng `nvidia-smi`

Ba nguyên nhân độc lập (mỗi nguyên nhân chặn GPU theo cách khác nhau):

1. **`extra_env` không hợp lệ trong `kubespawner_override`** (mọi profile GPU).
   Log Hub: `AttributeError: 'KubeSpawner' object has no attribute 'extra_env'` — spawn chết trước khi
   tạo pod. Sửa: `terraform/stacks/03-hub-app/values/hub-values.yaml.tpl` → dùng `environment` (option
   đúng của kubespawner).
2. **Device plugin chỉ chạy trên `tier=shared`** ⇒ node GPU dedicated không advertise `nvidia.com/gpu`
   ⇒ pod `Unschedulable: 1 Insufficient nvidia.com/gpu`. Sửa: `terraform/modules/gpu-stack/main.tf` bỏ
   `nodeSelector: tier=shared`, thêm toleration cho cả `tier=shared` và `tier=dedicated` (ConfigMap
   time-slicing vẫn `default: none` ⇒ node dedicated giữ nguyên 1 GPU).
3. **Pre-puller bỏ qua node GPU có taint** ⇒ lần spawn đầu phải tự pull image GPU (nhiều GB) và vượt
   `startTimeout 300s` ⇒ Hub bỏ pod ("did not start in 300 seconds"). Sửa: `prePuller.extraTolerations`
   (đúng key của chart 4.4.2, không phải `imagePuller`) + `singleuser.startTimeout: 900`.

**Kết quả verify trên production:**
- `gpu-dedicated` → pod Running trên node `ip-10-0-1-49` (tier=dedicated); `nvidia-smi` → **Tesla T4,
  15360 MiB**, driver 580.178.04; `torch 2.11.0+cu128` → `cuda True`, device "Tesla T4".
- `gpu-l4-shared` → Karpenter tự tạo node GPU shared mới (`ip-10-0-0-82`, tier=shared, gpu-family=T4),
  pod Running, `nvidia-smi -L` → **GPU 0: Tesla T4** ✓ (time-slicing hoạt động).
- Device plugin giờ chạy trên cả 2 node GPU; dcgm-exporter chạy trên node shared.

## ✅ Bug 38 (start no-op khi sandbox đang chạy) — đã sửa trong code (chưa deploy)

`web/bff/src/server.ts` (route start của project): trước đây trả `200 {ok:true, state:"ready"}` và **bỏ qua
profile được yêu cầu**; nay trả `409 SANDBOX_ALREADY_RUNNING` kèm state hiện tại, dashboard hiện thông báo
`projectRuntime.alreadyRunning`.

## ✅ Bug 37b (spawn fail bị nuốt im lặng) — đã sửa trong code (chưa deploy)

Route start nay trả `502 SANDBOX_START_FAILED` khi vòng đời spawn không đạt `ready`/`starting`, thay vì
báo `state: "stopped"` (UI tưởng mọi thứ bình thường).

## ✅ Bug 11 / 12 / 14 / 15 / 25 — đã sửa trong code (chưa deploy)

- **Bug 11**: `BillingPanel.quotaLabel` giờ map đủ resource của BFF (`concurrent_sandboxes`, `cpu_hours`,
  `gpu_hours`, `gpu_access`) + `quotaUnit` trả đúng đơn vị (trước: "5 hours" cho số sandbox,
  "300 hours" cho credit, raw key `concurrent_sandboxes`).
- **Bug 12**: `UsagePanel` vẽ thanh tiến độ theo **phần còn lại** (trước vẽ phần đã dùng ⇒ 293/300 credit
  còn lại nhưng thanh gần như trống); card storage dùng caption "còn X / Y GB" thay vì "đã dùng".
- **Bug 14**: nhãn "Personal Space" ở project detail đổi thành "Workspace" (trước gắn nhãn cá nhân cho
  project của organization).
- **Bug 15**: trang Subscription preselect **gói đang dùng** (trước chọn gói đầu tiên trong catalog ⇒ nút
  "Pay for Personal Free" trong khi account dùng Personal Pro).
- **Bug 25**: xoá khoá JSON trùng `usage.historyHeading` (en + vi) ⇒ nhãn "Last 30 days" mới không còn bị
  khoá cũ đè mất.

## ⚠️ Sự cố phát hiện khi sửa: Hub sập do state `02-platform` giữ password RDS cũ

- RDS event 14:09Z hôm nay: **"Reset master credentials"** cho `jhub-gpu-sandbox-dev-apse2-hub`.
- `02-platform` dùng `manage_master_user_password = true` ⇒ mật khẩu nằm trong Secrets Manager, nhưng
  output `db_url` trong state vẫn là bản cũ (hash khác secret hiện tại) ⇒ Hub restart với URL cũ ⇒
  **CrashLoopBackOff**: "Failed to connect to db".
- Sửa: `terraform apply 02-platform` (chỉ refresh output `db_url`, 0 thay đổi hạ tầng) rồi apply lại
  `03-hub-app` ⇒ Hub trở lại "JupyterHub is now running".
- **Bài học cho vận hành:** sau khi RDS reset master credentials, phải apply lại `02-platform` để refresh
  `db_url`, nếu không Hub sẽ crash-loop với lỗi DB (nhìn rất giống lỗi cấu hình).

## ✅ Ngoài ra

- `03-hub-app/terraform.tfvars` (file local, gitignored) vẫn trỏ image **ECR đã bị xoá**; đã cập nhật sang
  GHCR (`ghcr.io/im-yuuki/mlbox-{cpu,gpu}:dbcd98f…`) để không vô tình revert image khi apply.
- Plan `02-platform` chỉ đổi output, plan `05-gpu` chỉ đổi device plugin + replicas time-slicing (3→2),
  plan `03-hub-app` chỉ update Helm release — không có destroy/recreate.

## ✅ Deploy code dashboard/BFF (image `2096906`) và verify lại trên production

Sau khi CI build xong (PR #12 + 3 commit của lần sửa này), `04-dashboard` được apply với image
`ghcr.io/im-yuuki/mlbox-{dashboard,bff}:2096906dfa7ef9f69b9c61652000b2971e825e1f`.

| Kiểm tra | Kết quả |
|---|---|
| Bug 11 — nhãn/đơn vị entitlement | ✅ "Sandboxes running at once — 5 sandboxes running at once", "Credits — 300 credits / month", "GPU access — 1 GPU access", "Storage — 100 GB storage" (không còn raw key, không còn "5 hours") |
| Bug 15 — chọn gói | ✅ radio **Personal Pro** được chọn, CTA "Pay for Personal Pro" (trước: Personal Free ⇒ hạ gói) |
| Bug 17 (một phần) — tên gói hiện tại | ✅ "Current subscription: **Personal Pro**" (trước "personal_pro"). Lịch sử thanh toán vẫn hiện plan id (`personal_pro · Succeeded`) — chưa sửa |
| Bug 12 — thanh tiến độ + caption | ✅ "283.8 of 300 credits left", "100 of 100 GB left" (đồng nhất với tiêu đề "… left") |
| Bug 25 — khoá JSON trùng | ✅ tiêu đề "Last 30 days" hiện đúng (trước bị "Usage history" đè) |
| Bug 14 — nhãn Space | ✅ "Workspace" (trước "Personal Space" cho project của organization) |
| Bug 38 — start khi đang chạy | ✅ `409 SANDBOX_ALREADY_RUNNING` (start với profile khác không còn bị bỏ qua im lặng) |
| GPU sau khi deploy BFF mới | ✅ `gpu-l4-shared` → pod Running, `nvidia-smi` → Tesla T4 15360 MiB, home = EFS (`8.0E`), file `e2e-proof.txt` còn nguyên |

Còn lại (chưa xử lý, đã ghi ở trên): Bug 13 (thuật ngữ team ↔ organization) và nhóm lỗi
UI/thiết kế 16–24: cần chốt tên gọi với bạn.

---

# Lần sửa tiếp (2026-11-11 ~03:00) — quota theo Space, lỗi form inline, thông báo theo locale

Yêu cầu đã chốt: **project thuộc Space nào thì quota/resource/subscription phải thuộc Space đó.**

## ✅ Bug 10 — Quota, credits, storage và subscription theo Space đang chọn

- BFF `GET /v1/usage` nhận `?spaceId=`, kiểm tra user là thành viên của Space đó (không thuộc → 403),
  mặc định là Space cá nhân. Mọi số liệu (credits pool, storage của Space, số sandbox chạy đồng thời,
  credit sessions, storage theo project, lịch sử 30 ngày) lấy theo Space đó.
- Footprint của Hub cũng lọc theo Space: mỗi server Hub đặt tên theo Project, nên server thuộc Space
  nào được suy từ Project đó (server legacy "default" thuộc Space cá nhân).
- Dashboard: `/quota` (UsagePanel) và `/subscription` (BillingPanel) gửi `spaceId` của Space đang chọn
  trong switcher; `/api/bff/usage` forward query string; danh sách gói lọc theo `spaceType` của Space.
- Route start vốn đã tính theo Space của project (`spaceAndPlanForProject`), nên nay số hiển thị và số
  bị tính cùng một phạm vi.

## ✅ Bug 26 — Lỗi form hiện inline, không biến thành toast biến mất

`FeedbackAlert` giờ render `Alert` (role="alert") cho lỗi/cảnh báo tại chỗ, còn **thành công** vẫn là
toast. Trước đó mọi lỗi (kể cả lỗi đăng nhập) chỉ là toast 4 giây ở góc màn hình.

## ✅ Bug 27 — Thông báo lỗi theo locale thay vì tiếng Việt của BFF

- BFF trả `error` (mã) + `message` (tiếng Việt). Dashboard giờ dùng mã để tra bản dịch
  (namespace `bffErrors`, en + vi) và chỉ rơi về `message` của server khi mã lạ.
- Áp dụng cho login, register, verify (gửi lại mã), forgot/reset password.

## ✅ Bug 17 (phần lịch sử thanh toán) — Hiện tên gói thay vì plan id

Dòng lịch sử thanh toán hiện "Personal Pro · Succeeded" thay vì "personal_pro · Succeeded".

## ✅ Bug 13 — Thống nhất thuật ngữ: dùng **Team**, bỏ mô hình organization phân cấp

Quyết định: mô hình organization phân cấp đã bị bỏ, giữ mô hình đơn giản — mỗi Space (cá nhân hoặc
tổ chức) chứa một nhóm phẳng, và UI gọi nhóm đó là **Team**.

- `en.json` đã gọi "Team" ở navbar/switcher; `vi.json` còn trộn "Tổ chức" với "nhóm" → đã thống nhất
  "Nhóm" (navbar.organization, noOrganizations, home.features.organizations).
- Vai trò dùng một từ vựng: owner = "Chủ nhóm", admin = "Quản trị viên", member = "Thành viên",
  viewer = "Người xem" (trước: navbar dùng "Chủ sở hữu"/"Quản trị" còn card thành viên dùng "Owner"/
  "Quản trị", lời mời dùng "Quản trị viên"/"Chỉ xem").
- Copy tiếng Anh lẫn tiếng Việt trong câu tiếng Việt đã sửa (teams.subtitle, orgMembersHint,
  dangerBody, invitations.incoming).

## Vẫn chưa xử lý

- Lịch sử thanh toán chưa có ngày; số liệu storage ở Quota làm tròn "0 GB" cho 32 B.
- Nhóm lỗi UI/thiết kế 16–24 (empty state không có CTA, chip instance ở list, banner "Sandboxes running
  at once" lệch style, chart không có trục/giá trị, v.v.): cần một vòng thiết kế riêng.

## Dữ liệu còn lại từ lần verify này

- Organization `e2e-org-2026-11-11` (id `org:79c6539d-8b4e-411b-8f87-3d08baa979b3`) + project `org-project-e2e`
  (`67c74720-e6f9-4651-9f39-0a319ab87528`, sandbox đã **stop**), 1 lời mời pending
  `e2e-invite-2026-11-11@example.com`.
- Sandbox personal `e2e-verify-2026-11-10` vẫn **đang chạy** (từ 11/11 01:08) — stop trên trang project nếu
  không dùng nữa.
