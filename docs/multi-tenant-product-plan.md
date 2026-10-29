# ML Box WebUI — product và multi-tenant implementation plan

> **Trạng thái:** target design và kế hoạch triển khai; chưa phải mô tả tính năng đã có. Ứng dụng hiện vẫn là MVP single-user, sandbox-first. Dùng tài liệu này cùng [`dashboard-architecture.md`](dashboard-architecture.md) và [`TODO.md`](../TODO.md) khi giao việc cho agent.

## Mục tiêu sản phẩm

Chuyển dashboard từ giao diện quản lý sandbox cá nhân thành nơi quản lý project có dữ liệu bền vững, trong đó sandbox chỉ là runtime tạm thời. Hỗ trợ người dùng cá nhân và tổ chức nhỏ/vừa (vài chục thành viên), ưu tiên mô hình dễ giải thích, dễ quản trị và tenant isolation rõ ràng.

```text
User
└── Space (Personal hoặc Organization; sở hữu subscription và quota)
    └── Team (phẳng, không có team con)
        └── Project (thuộc đúng một Team)
            ├── Sandbox (runtime tạm thời, tối đa một người sử dụng)
            └── Artifacts (dữ liệu project bền vững)
```

Mỗi Personal Space cũng có một Team mặc định (có thể ẩn trong UI) để mọi Project tuân theo cùng mô hình ba cấp. Một user có thể thuộc nhiều Space và nhiều Team trong cùng Space. Không hỗ trợ chia sẻ Project giữa các Space trong phiên bản đầu.

## Từ vựng và trách nhiệm

| Khái niệm | Ý nghĩa |
|---|---|
| User | Danh tính đăng nhập; định danh nội bộ bằng Cognito `sub`, không dùng email làm khóa. |
| Space | Ranh giới tenant, thành viên, subscription, entitlement/quota và usage. `type` là `personal` hoặc `organization`; Organization không phải một tầng riêng. Mỗi user được tạo Personal Space tự động. |
| Team | Nhóm phẳng thuộc một Space, dùng để quản lý thành viên và quyền mặc định trên Project. Team không chứa Team khác. |
| Project | Đơn vị bền vững, thuộc đúng một Team trong cùng Space; lưu metadata, cấu hình và quan hệ tới artifacts/runtime. |
| Sandbox | Runtime tạm thời 1:1 với Project. Dừng/xóa runtime không xóa Project hoặc Artifacts. MVP chỉ một user vận hành sandbox tại một thời điểm; không có notebook collaboration/shared runtime. |
| Artifact | Tệp/dữ liệu bền vững của Project, không phụ thuộc vòng đời Sandbox. |
| Subscription / Entitlement | Plan giả lập và hạn mức theo Space; không phải thanh toán thật. |
| Usage ledger | Các khoảng/đơn vị sử dụng được quy về Space, Project, Sandbox, User và resource. |

Space là ranh giới của quota và dữ liệu; Project luôn thuộc một Team; Sandbox và Artifact luôn được kiểm tra quyền qua Project. Đổi Space đang xem chỉ đổi ngữ cảnh UI, không tự cấp quyền.

## UX và branding

### Hướng thương hiệu

- Tính cách: kỹ thuật, chính xác, dễ tiếp cận; phục vụ người làm ML và nhóm nhỏ, không tạo cảm giác dashboard cloud đại trà.
- Đề xuất logo: biểu tượng chiếc hộp mở, tạo chữ **M/B** bằng khoảng âm; tránh hình GPU, robot hoặc khối lập phương literal.
- Bảng màu đề xuất: Ink `#17171C`, Canvas `#F7F8FA`, Electric Blue `#4D7CFE`, Signal Mint `#45D6A5`, Warm Amber `#F0B85A`, White `#FFFFFF`.
- Typography đề xuất: IBM Plex Sans cho giao diện và IBM Plex Mono cho giá trị kỹ thuật/cấu hình.
- `web/theme/tokens/heroui-tokens.css` tiếp tục là nguồn token dùng chung. Áp dụng nhất quán cho Dashboard, Hub và Lab; không tạo token palette thứ hai.
- Đây là hướng thiết kế đã đề xuất từ trao đổi, chưa phải asset cuối. Trước khi chốt cần xem trong light/dark mode, kiểm tra tương phản và rà lại token hiện có.

### Logo pack cần bàn giao

- Wordmark ngang ML Box, symbol độc lập, phiên bản compact cho navbar, favicon/app icon.
- Bản màu, đơn sắc và đảo màu; SVG nguồn và export raster cần thiết.
- Quy định clear space, kích thước nhỏ nhất, nền được phép và cách dùng sai cần tránh.
- Logo trong ứng dụng ưu tiên dễ đọc ở kích thước nhỏ; không dùng tagline để thay cho tên sản phẩm.

### Khung dashboard

```text
[ Logo · Space switcher ]       [ Search projects in this Space ]       [ Preferences ] [ Avatar ]
```

- Space switcher cạnh logo; hiển thị Personal/Organization và quyền truy cập hiện tại.
- Search mặc định trong Space đang chọn; kết quả phải thể hiện tên Project/Team. Không trộn dữ liệu nhiều Space ngầm.
- Preferences là menu gọn cho theme và ngôn ngữ. Avatar menu chứa Usage, Account, billing/space management theo quyền và Sign out.
- Trang chính chuyển thành Projects; Project page có trạng thái runtime, loại sandbox, artifacts và settings.
- Gợi ý route đích: `/projects`, `/projects/[projectId]`, `/projects/[projectId]/settings`, `/projects/[projectId]/artifacts`, `/teams`, `/members`, `/usage`, `/settings/billing`. Route hiện có `/sandboxes` được giữ làm alias/redirect trong giai đoạn chuyển đổi.
- UI cần có responsive, keyboard focus, loading/empty/error/unauthorized states và bản dịch `en`/`vi`.

## Thành viên và quyền truy cập

### Vai trò cố định

Không cho admin tự tạo permission hay role tùy biến ở phiên bản đầu.

| Scope | Role | Quyền chính |
|---|---|---|
| Space | Owner | Quản trị toàn bộ Space, thành viên, Team, billing và dữ liệu; mỗi Space phải luôn có ít nhất một Owner và không thể bị khóa bởi Project override. |
| Space | Admin | Quản trị thành viên/Team/Project và billing trong Space; không thể bị khóa khỏi Project bởi override. |
| Space | Member | Thành viên thường; quyền Project đến từ Team membership hoặc cấp trực tiếp. Không tự động thấy mọi Project. |
| Space | Viewer | Chỉ đọc; không thể làm Team Lead và giới hạn read-only áp dụng cả khi quyền Team/Project khác cấp cao hơn. |
| Team | Lead | Quản lý membership của Team và có quyền Manager mặc định trên Project của Team. |
| Team | Member | Có quyền Contributor mặc định trên Project của Team. |
| Project | Manager / Contributor / Viewer | Quyền trực tiếp cho user cùng Space, thay thế quyền Team được kế thừa ở Project đó. |
| Project | Blocked | Ngoại lệ deny trực tiếp: chặn quyền kế thừa Team cho user tại Project cụ thể. Không áp dụng với Space Owner/Admin. |

### Quy tắc quyết định quyền

1. Mặc định deny: session hợp lệ không đồng nghĩa với quyền truy cập Space/Project.
2. Owner/Admin có quyền quản trị trên toàn Space; Project override không thể khóa họ.
3. Team Lead/Member chỉ kế thừa vào Project thuộc Team đó; không cấp quyền sang Team khác.
4. Project direct assignment chỉ dành cho user đã là member của cùng Space. User từ Team khác trong Space có thể được thêm trực tiếp; không chia sẻ cross-Space.
5. Project role trực tiếp **thay thế** role kế thừa từ Team. `Blocked` chặn quyền kế thừa. Space Viewer vẫn bị giới hạn read-only.
6. Sandbox start/stop/change type và Artifact upload/download/delete là permission con của Project role, không có cơ chế cấp quyền độc lập để vượt qua quyền Project.
7. BFF xác thực lại membership/quyền trên mỗi thao tác; không tin `spaceId`, `projectId`, role hay Hub username do browser gửi mà chưa kiểm tra.

### Quản trị thành viên

- Owner/Admin mời thành viên vào Space, thu hồi hoặc vô hiệu membership và gán Space role.
- Owner/Admin tạo Team phẳng, gán Team Lead/Member và quản lý Team membership.
- Team Lead quản lý membership trong Team của mình nhưng không được sửa Space membership, billing hay quyền Team khác.
- Không cho phép xóa/hạ quyền Owner cuối cùng; Space Viewer không được gán Team Lead.
- Project Manager thêm user cùng Space làm collaborator và chọn Project role/Blocked; thao tác được audit.
- Thu hồi membership phải có hiệu lực ở các request tiếp theo; cần cân nhắc cache quyền và invalidation.

## Data model và ranh giới dịch vụ

Đây là mô hình logic; tên bảng/API có thể được điều chỉnh khi triển khai nhưng không được phá các invariant phía trên.

```text
users(id = Cognito sub, email, created_at)
spaces(id, type, name, created_at)
space_memberships(space_id, user_id, role, status)
teams(id, space_id, name)
team_members(team_id, user_id, role)
projects(id, team_id, name, settings, created_by)
project_access(project_id, user_id, role | blocked, granted_by)
sandboxes(id, project_id UNIQUE, owner_user_id, hub_username, server_name, profile, state)
artifacts(id, project_id, object_key, metadata, created_by)
subscriptions(space_id, plan_code, status, started_at, current_period_end, mock_payment_reference)
entitlements(space_id, resource, limit, source)
usage_events(space_id, project_id, sandbox_id, user_id, resource, quantity, started_at, ended_at, source)
invitations(...)
audit_events(space_id, actor_user_id, action, target, metadata, created_at)
```

Ràng buộc quan trọng: một Project có đúng một Team; Team và Project cùng Space; mỗi Project có tối đa một Sandbox; một user/team/project membership chỉ tồn tại trong Space tương ứng. Dùng foreign key/unique constraint ở DB khi phù hợp, không chỉ dựa vào UI.

- Dùng `Cognito sub` ổn định cho khóa user và migration; email có thể đổi và chỉ là thuộc tính liên hệ.
- Dùng app-owned relational schema cho control plane. Không đọc/ghi trực tiếp schema database do JupyterHub sở hữu.
- PostgreSQL dashboard hiện tại chỉ là optional usage-history MVP, không phải organization database. Trước khi triển khai cần quyết định có mở rộng DB này hay tạo app DB riêng; ghi lại quyết định và migration/backup plan.
- Hub vẫn là API-only runtime. BFF kiểm tra Project access rồi mới gọi Hub với Hub service token; browser không được gọi Hub trực tiếp.
- Giữ user-owned Hub server trong MVP. `owner_user_id`/`hub_username` là runtime mapping; không chuyển sang shared runtime trong kế hoạch này.

## Project, Sandbox và Artifact lifecycle

- Tạo Project trước; khởi chạy, dừng, đổi profile/type Sandbox từ Project.
- Sandbox là runtime tạm; một Project tối đa một sandbox và một user vận hành cùng lúc. Đổi profile yêu cầu stop/restart theo khả năng Hub; không tạo implicit collaboration.
- Project metadata và Artifacts sống qua các lần stop/xóa runtime.
- Dùng object key có scope `spaces/{space_id}/projects/{project_id}/artifacts/{artifact_id}/...` và workspace tương ứng.
- Mọi upload/download đều được BFF authorize trước khi cấp presigned URL. Không để browser tự chọn key tùy ý; runtime credential nếu có phải được giới hạn theo Project. Rà lại workspace IAM hiện hữu vì comments về prefix không thay thế cho bucket policy/session-policy thực sự.
- Migration sandbox cũ: tạo Project mặc định trong Personal Space/Team của user, gắn named Hub server hiện có vào Project đó, giữ mapping và dữ liệu cũ. Không xóa hoặc đổi server trước khi có backup và kiểm tra migration idempotency.

## Subscription giả lập, quota và Turnstile

### Mock subscription

- Subscription và quota thuộc Space, không thuộc user hoặc sandbox.
- Chọn plan → (nếu bật bảo vệ) hoàn tất Turnstile → BFF xác thực → cập nhật subscription/entitlement ở trạng thái active ngay lập tức → ghi audit event và trả success.
- Không tích hợp Stripe, AWS Marketplace hay cổng thanh toán thật trong scope này. Giao diện phải nói rõ đây là mock/dev flow.
- Usage ledger quy usage về Space/Project/Sandbox/User; không dùng số liệu Hub realtime thay cho lịch sử/billing ledger. Chỉ enforce quota khi nguồn usage đáng tin cậy và policy được chốt.

### Đề xuất gói và giá MVP (chưa kiểm chứng)

Đây là giả thuyết để thử nghiệm mức sẵn lòng chi trả, không phải giá đã chốt hay tính năng đang có. Giá tính bằng USD/tháng; cần rà soát AWS cost và hành vi sử dụng trước khi bán thật.

| Space | Gói | Giá đề xuất | Giá trị chính |
|---|---|---:|---|
| Personal | Free | $0 | 1 Project, 5 GB lưu trữ, sandbox CPU và một hạn mức compute nhỏ hàng tháng |
| Personal | Plus | $8 | Tối đa 5 Project, 25 GB lưu trữ, nhiều giờ CPU hơn Free và quyền dùng GPU cơ bản khi có capacity |
| Personal | Pro | $19 | Hạn mức Project/lưu trữ/compute cao hơn Plus và ưu tiên trên shared GPU |
| Personal | Power | $39 | Hạn mức tự phục vụ cao nhất và ưu tiên shared GPU cao nhất; dedicated GPU tính riêng |
| Organization | Team | $19, tối đa 3 thành viên | Project dùng chung, role cơ bản và compute pool chung |
| Organization | Growth | $8/thành viên | Mở rộng thành viên, Team, lưu trữ dùng chung và theo dõi usage |
| Organization | Scale | $15/thành viên | Hạn mức cao hơn, quản trị bổ sung, audit history và hỗ trợ ưu tiên |
| Organization | Enterprise | Báo giá | Hạn mức theo hợp đồng, tùy chọn capacity riêng và SLA |

Nguyên tắc đóng gói:

- Free chỉ dành cho Personal Space; Organization Space luôn cần plan trả phí.
- Subscription mua quyền truy cập và hạn mức; không quảng cáo compute/GPU không giới hạn. Công khai compute allowance và hiển thị chi phí trước khi chạy vượt allowance.
- GPU chỉ được đưa vào cam kết của plan khi capacity vận hành ổn định. Dedicated GPU và phần compute vượt hạn mức phải được định giá riêng sau khi xác nhận cost/usage; không suy ra giá bán từ các con số giả thuyết trên.
- Để giảm phạm vi MVP, giai đoạn đầu chỉ cần thử Personal Free/Plus/Pro và Organization Team/Growth. Power, Scale và Enterprise có thể để “coming soon” đến khi có dữ liệu usage và cost.
- Trong MVP, các gói chỉ là mock subscription; không thu tiền thật. Không hiển thị các quota mô tả trên như entitlement đã triển khai cho đến khi quota nguồn đáng tin cậy được đo và enforce.

### Turnstile tùy chọn theo môi trường/luồng

- Mặc định tắt ở local/dev để signup và test flow không bị chặn. Có thể bật riêng cho đăng ký và mock checkout bằng config, ví dụ `TURNSTILE_REGISTER_ENABLED` và `TURNSTILE_CHECKOUT_ENABLED`.
- Khi registration protection bật: form `/register` hiển thị widget, gửi token cùng email/password tới BFF; BFF gọi Cloudflare Siteverify trước `SignUpCommand`. Khi tắt, ẩn widget và không yêu cầu token.
- Khi checkout protection bật: UI mock checkout cũng hiển thị widget và BFF verify trước khi activate plan. Không dùng client-side success làm bằng chứng.
- Site key là public config; secret chỉ ở BFF secret/env. Nếu tính năng đã bật mà token thiếu/sai/hết hạn hoặc Siteverify lỗi thì fail closed, không tạo user/subscription; trả lỗi có thể retry, không lộ secret/response nhạy cảm.
- Token chỉ sử dụng một lần, có thời hạn ngắn; không ghi token/secret vào log. Có thể dùng testing keys theo hướng dẫn Cloudflare ở dev/staging, không dùng secret production trong client.
- Có thể bật Register và Checkout độc lập để staging chỉ kiểm tra một flow. Việc disable phải là quyết định config rõ ràng, không tự fallback sang bỏ qua xác thực khi Siteverify lỗi.
- Tham khảo: [Cloudflare Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## Chuyển đổi API và tương thích

- Tạo API project/space/team/member/permission mới dưới BFF; giữ same-origin dashboard proxy pattern.
- Lấy User ID từ session đã verify; mọi API nhận Space/Project ID phải kiểm tra thuộc tính, membership và role ở server.
- API sandbox mới nhận `projectId` và action/profile; không nhận Hub username tùy ý. Resolve Hub server từ Project record.
- Giữ `/v1/sandboxes` và UI `/sandboxes` như compatibility alias trong khoảng migration; xóa chỉ sau khi không còn client/link cần dùng và có kiểm tra redirect.
- Session có thể lưu active Space để UX, nhưng server phải kiểm tra membership khi đọc session và ở mọi request nhạy cảm.

## Trình tự triển khai

Các phase phải được giao và hoàn thành theo dependency; mỗi phase cập nhật tài liệu/TODO, migration, tests và rollback notes tương ứng.

1. **Foundation & invariants:** chốt schema app-owned, Cognito `sub`, Personal Space/default Team bootstrap, foreign keys, migration framework và authorization test harness. Không migrate/xóa runtime ở phase này.
2. **Space/team membership & authorization:** membership, invitation lifecycle, fixed roles, flat Team CRUD, permission service, audit events, invalidation khi thu hồi quyền; test cross-tenant/default deny.
3. **Project-first domain & migration:** Project CRUD, đúng một owning Team, map sandbox hiện hữu thành Project trong Personal Space; API/UI project-first, giữ alias sandbox.
4. **Project-aware sandbox:** BFF authorize theo Project rồi proxy Hub; start/stop/profile, một runtime/user; test Hub ownership và quota failure/error states.
5. **Artifacts & isolation:** metadata + upload/download, S3 key migration, presigned URLs, IAM/runtime scope, backup/restore và không làm mất dữ liệu.
6. **Subscription, entitlement & usage:** schema theo Space, ledger có nguồn dữ liệu rõ ràng, UI Usage/Billing, mock plan activation và audit. Không tuyên bố billing thật.
7. **Turnstile:** thêm widget/config per-flow, server-side verification cho register và mock checkout; test disabled/enabled/invalid/expired/provider unavailable.
8. **WebUI + brand pack:** Space switcher, project search/list/detail, teams/members admin, menu preferences/avatar, i18n/accessibility/responsive, logo pack và áp dụng token nhất quán.
9. **Release/migration hardening:** acceptance test E2E với ít nhất hai Space và nhiều role, data backup/restore, runbook, rollout/rollback và cập nhật trạng thái docs.

Có thể tách UI/design asset thành công việc độc lập, nhưng không thay đổi tên khái niệm hoặc quy tắc quyền đã chốt nếu chưa cập nhật tài liệu này.

## Acceptance criteria tối thiểu

- User mới có Personal Space và default Team; Organization Space có thể mời nhiều user, mỗi user vào nhiều Team phẳng.
- Không có route/API nào cho phép đọc hoặc điều khiển dữ liệu Space khác bằng cách sửa ID ở client.
- Project luôn thuộc một Team trong cùng Space; access qua Team và direct override đúng theo quy tắc trên; Owner/Admin không thể bị khóa bởi override.
- Member bị thu hồi không thể tiếp tục truy cập Project, Artifact hoặc Sandbox bằng session cũ.
- Stop/delete Sandbox không xóa Project/Artifacts; runtime vẫn là 1:1 với Project và không hỗ trợ nhiều user đồng thời.
- Upload/download không vượt prefix Project được authorize; migration bảo toàn dữ liệu cũ và có thể chạy lại an toàn.
- Mock subscription cập nhật entitlement đúng Space, ghi audit event và không gọi payment provider thật.
- Turnstile tắt thì signup/checkout dev hoạt động không widget; bật thì widget hiện tại đúng form và chỉ BFF Siteverify thành công mới tiếp tục. Token sai/hết hạn/replay/provider error không tạo side effect.
- Các flow quan trọng có test `en`/`vi`, responsive và loading/empty/error/unauthorized states.

## Ngoài phạm vi phiên bản đầu

- Nested Team, organization unit/department hierarchy, project thuộc nhiều Team.
- Cross-Space collaboration hoặc chia sẻ Project giữa tổ chức.
- Shared/multi-user notebook runtime, đồng chỉnh sửa notebook.
- Custom roles/permission builder.
- Thu tiền thật, invoice/tax, Stripe/AWS Marketplace.
- Tuyên bố CPU/GPU/storage billing chính xác trước khi usage source và ledger được triển khai, kiểm chứng.

## Handoff cho agent tiếp theo

1. Đọc tài liệu này, [`TODO.md`](../TODO.md), [`dashboard-architecture.md`](dashboard-architecture.md), README và mọi `AGENTS.md` liên quan.
2. Trước khi code, kiểm tra `git status`, code hiện tại và tests; coi source là mô tả hành vi hiện tại, không coi các mục target là đã làm.
3. Chỉ nhận một phase/task có acceptance rõ; cập nhật TODO theo trạng thái thực tế. Không sửa schema Hub-owned DB hoặc bỏ compatibility/data migration mà chưa có plan.
4. Với thay đổi UI Next.js, đọc hướng dẫn versioned trong `web/dashboard/node_modules/next/dist/docs/` theo `web/dashboard/AGENTS.md`.
5. Chạy tests liên quan, báo rõ phần chưa test được; không triển khai production hoặc thay đổi Terraform state chỉ vì tài liệu yêu cầu.
