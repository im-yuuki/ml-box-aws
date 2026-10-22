# Deploy — ML Box web theme · JupyterHub (Z2JH 4.4.2) values patch

> Tài liệu **hướng dẫn áp dụng theme** ML Box vào stack `terraform/stacks/04-hub-app/`
> (helm_release `jupyterhub`, chart Z2JH 4.4.2, JupyterHub app **5.5.2** — xác nhận qua
> `Chart.yaml` appVersion của tag `4.4.2`).
>
> **Không sửa file `main.tf` / `values/hub-values.yaml.tpl` trong bước tài liệu này** —
> bạn sẽ tự paste các đoạn YAML/TF bên dưới sau.

Nguồn theme (layout đã chốt, xem `web/theme/README.md`):

```
web/theme/hub/templates/*.html        # page/login/home/spawn_pending overrides
web/theme/hub/static/heroui.css       # CSS build, tokens đã inlined
web/theme/hub/static/motion.js        # Motion vendored (vanilla framer)
web/theme/hub/static/logo.svg
```

---

## 0. Kết quả kiểm chứng docs (đọc trước)

| Mục | Kết luận | Nguồn đã tra cứu |
|---|---|---|
| `hub.extraFiles` schema Z2JH 4.4.2 | **VERIFIED — nhưng KHÔNG có dạng `{mountPath, files: [sources]}`** như dự kiến ban đầu. Schema thật: mỗi key = **1 file**, `{mountPath, data \| stringData \| binaryData, mode}`; `additionalProperties: false` → schema `files: [...]` sẽ **fail helm validate**. Nội dung phải *inline trong values* (hoặc `--set-file`), không có `src` trỏ tới file cục bộ. Ở dưới dùng ConfigMap + `extraVolumes` thay vì nhét CSS/JS inline vào yaml tpl. | [`values.schema.yaml @ 4.4.2`](https://github.com/jupyterhub/zero-to-jupyterhub-k8s/blob/4.4.2/jupyterhub/values.schema.yaml) — anchor `extraFiles` & section "Common uses" |
| Mount theo **thư mục** bằng extraFiles | **KHÔNG hỗ trợ** — 1 entry = 1 file, mount bằng `subPath`; giới hạn ~1MB/Secret | cùng schema, mục "Limitations" |
| Static files của hub | Tornado đặt `static_path = <data_files_path>/static`, prefix `<hub.base_url>static/` → file mount vào `/usr/local/share/jupyterhub/static/...` sẽ được serve tại **`/hub/static/...`** | [`jupyterhub/app.py @ 5.3.0`](https://github.com/jupyterhub/jupyterhub/blob/5.3.0/jupyterhub/app.py) (init_webapp) + schema Z2JH "Common uses" #1 |
| `c.JupyterHub.template_paths` | **VERIFIED** (config trait). app.py **tự nối thêm** thư mục template mặc định vào cuối danh sách nếu thiếu → `{% extends "page.html" %}` vẫn resolve đúng template gốc (custom dir đứng trước). | app.py @ 5.3.0 (ChoiceLoader) + [docs templates](https://jupyterhub.readthedocs.io/en/stable/howto/templates.html) |
| `c.JupyterHub.extra_static_paths` | **KHÔNG TỒN TẠI trên Hub** (none trong app.py @1.5.0 / 4.1.6 / 5.3.0 / main). Đây là traitlet của *jupyter_server/notebook* (single-user), không phải của Hub. **Cấm dùng** — set cũng bị traitlets từ chối. | app.py raw @ các tag kể trên |
| `c.JupyterHub.template_vars` | **VERIFIED**: Dict tùy ý, hỗ trợ callable; giá trị được trộn vào namespace của mọi template. | app.py @ 5.3.0 + `handlers/base.py` `template_namespace` (main) |
| Tên template var: `hub_title`, `hub_subtitle`, `page_logo` | **UNVERIFIED (hiệu ứng built-in)**: docs JupyterHub 5 chỉ ghi nhận `announcement` (+ `announcement_login/home/spawn/logout`) có hiệu lực mặc định; `page.html` mặc định của JH5 **không** đọc `hub_title/page_logo`. 3 biến trên chỉ có tác dụng nếu **template override** của team (web/theme/hub/templates) tự đọc chúng. Logo out-of-the-box hãy dùng `logo_file` (dòng dưới). | [docs templates](https://jupyterhub.readthedocs.io/en/stable/howto/templates.html) + `share/jupyterhub/templates/page.html` |
| `c.JupyterHub.logo_file` | **VERIFIED**: chỉ đường dẫn file logo → serve tại `{base_url}logo` (redirect về `/hub/logo`); navbar `page.html` render `<img src="{{ base_url }}logo">` | app.py @ 5.3.0 (`logo_file`, LogoHandler, `/logo`) + `page.html` |
| `LabApp.custom_css` (JupyterLab 4) | **VERIFIED**: traitlet Bool có thật (`labapp.py @ v4.4.7`); khi True, render `<link href="{base_url}custom/custom.css">` trong `jupyterlab/static/index.html` (đã decode từ wheel 4.4.7); đường dẫn `static_custom_path` mặc định = `[<jupyter config_dir>/custom, ...]` (jupyter_server `serverapp.py @ v2.16.0`) → file phải nằm đúng `<config_dir>/custom/custom.css`, tên **bắt buộc là `custom.css`** | [`jupyterlab/labapp.py v4.4.7`](https://github.com/jupyterlab/jupyterlab/blob/v4.4.7/jupyterlab/labapp.py), wheel `jupyterlab-4.4.7-py3`, [`jupyter_server/serverapp.py v2.16.0`](https://github.com/jupyter-server/jupyter_server/blob/v2.16.0/jupyter_server/serverapp.py) |
| `LabApp.custom_css` trên **Notebook 7** | **UNVERIFIED** — chưa tra nguồn Notebook 7; chỉ nên dựa vào khi singleuser mặc định `/lab` (hiện `singleuser.defaultUrl: /lab` trong values tpl) | — |

Danh sách biến template builtin có sẵn (đã verify trong `template_namespace`): `base_url`, `prefix`, `user`, `login_url`, `login_service`, `logout_url`, `static_url`... → trong template override có thể viết `{{ base_url }}hub/static/heroui/heroui.css`.

---

## 1. Patch values — khuyến nghị: ConfigMap + `extraVolumes` (Patch A)

Vì extraFiles 4.4.2 = 1-file-per-key + content inline (không mount dir, không `src`), còn theme lại là **1 thư mục templates + 3 file static**, cách sạch nhất trong Terraform là:

1. Tạo 2 ConfigMap từ thư mục theme (Terraform hoặc kubectl — §3).
2. Mount vào hub pod qua `hub.extraVolumes` / `hub.extraVolumeMounts` (**verified** — k8s native syntax).
3. Bật qua `hub.extraConfig`.

### 1.1 Đoạn paste vào `values/hub-values.yaml.tpl` (bên trong nút `hub:` sẵn có)

> Đặt `extraConfig.theming` cạnh key `10-spawn-hook` hiện có; các snippet extraConfig chạy theo thứ tự alphabet key — `10-spawn-hook` chạy trước `theming`, không xung đột.

```yaml
hub:
  # ... (giữ nguyên db/serviceAccount/config/extraConfig.10-spawn-hook hiện có) ...
  extraConfig:
    # --- ML Box theme (Branding) ---
    theming: |
      # Overrides có ưu tiên cao hơn template mặc định (ChoiceLoader: custom dir đứng trước).
      c.JupyterHub.template_paths = ["/etc/jupyterhub/custom/templates"]

      # Logo out-of-the-box: LogoHandler serve file này tại {base_url}logo (=> /hub/logo).
      c.JupyterHub.logo_file = "/usr/local/share/jupyterhub/static/heroui/logo.svg"

      # template_vars: Dict tùy ý (hỗ trợ callable). Chỉ 'announcement' có hiệu lực
      # built-in; 'hub_title'/'hub_subtitle'/'page_logo' là biến tùy chọn cho các
      # template override của web/theme/hub/templates (chúng tự đọc var này trong Jinja).
      c.JupyterHub.template_vars = {
          "hub_title": "ML Box",
          "hub_subtitle": "GPU notebooks for teams",
          "page_logo": "hub/static/heroui/logo.svg",  # template dùng: {{ base_url }}{{ page_logo }}
          "announcement": "",  # để trống; chỉ hiện khi template render {{ announcement }}
      }

  extraVolumes:
    - name: hub-theme-templates
      configMap:
        name: hub-theme-templates
        optional: true          # cho phép apply values trước khi ConfigMap đã có
    - name: hub-theme-static
      configMap:
        name: hub-theme-static
        optional: true

  extraVolumeMounts:
    - name: hub-theme-templates
      mountPath: /etc/jupyterhub/custom/templates
      readOnly: true
    # Static PHẢI nằm dưới data_files_path/static để được serve (KHÔNG có
    # JupyterHub.extra_static_paths trên Hub — đã verify app.py JH5).
    - name: hub-theme-static
      mountPath: /usr/local/share/jupyterhub/static/heroui
      readOnly: true
```

URL static sau khi mount (base_url = `/`):

- CSS: `{{ base_url }}hub/static/heroui/heroui.css` → `/hub/static/heroui/heroui.css`
- JS: `{{ base_url }}hub/static/heroui/motion.js`
- Logo: `{{ base_url }}hub/static/heroui/logo.svg` hoặc `{base_url}logo`

> Templates mount tại `/etc/jupyterhub/custom/templates` (chỉ dùng cho Jinja loader, không cần serve). Theme templates override page/login/home/spawn_pending và **chỉ override block** theo hợp đồng `web/theme/README.md`.

### 1.2 Lưu ý

- `optional: true` nghĩa là nếu thiếu ConfigMap, steer vẫn deploy (pod start như cũ) — rollback an toàn. Nếu muốn nghiêm ngặt hơn, bỏ `optional`.
- 3 file static (`heroui.css`, `motion.js`, `logo.svg`) đều là text nên hợp với ConfigMap `data`; tổng dung lượng << 1 MB giới hạn của ConfigMap/Secret mount.
- Template override theo cơ chế Jinja search-order: file cùng *tên* trong custom dir sẽ ghi đè template mặc định (vì vậy hợp đồng yêu cầu chỉ override block, dùng `{% extends "templates/page.html" %}` / `"page.html"` — không copy nguyên template gốc).

---

## 2. Phương án B (nếu không dùng ConfigMap): `hub.extraFiles` theo schema thật 4.4.2

Mỗi **từng file** một entry, nội dung **inline trong values** (`stringData`) hoặc qua `--set-file`:

```yaml
hub:
  extraFiles:
    theme_page_html:
      mountPath: /usr/local/share/jupyterhub/templates/page.html   # tự override template mặc định
      stringData: |
        {# nội dung file web/theme/hub/templates/page.html #}
    theme_login_html:
      mountPath: /usr/local/share/jupyterhub/templates/login.html
      stringData: |
        {# nội dung file web/theme/hub/templates/login.html #}
    # ... home.html, spawn_pending.html tương tự ...
    theme_heroui_css:
      mountPath: /usr/local/share/jupyterhub/static/heroui/heroui.css
      stringData: |
        /* nội dung web/theme/hub/static/heroui.css */
    theme_motion_js:
      mountPath: /usr/local/share/jupyterhub/static/heroui/motion.js
      stringData: |
        /* nội dung web/theme/hub/static/motion.js */
    theme_logo_svg:
      mountPath: /usr/local/share/jupyterhub/static/heroui/logo.svg
      stringData: |
        <!-- nội dung web/theme/hub/static/logo.svg -->
```

Với file cục bộ lớn, dùng `--set-file` tránh inline trong yaml:

```bash
base64 web/theme/hub/static/logo.svg > /tmp/logo.svg.b64
helm upgrade jupyterhub -n hub ... \
  --set-file hub.extraFiles.theme_logo_svg.binaryData=/tmp/logo.svg.b64
```

Nhược điểm: phải thêm entry mỗi khi thêm file, templates/CSS nằm text trong values → khó review. **Chỉ dùng khi không muốn thêm ConfigMap.** Khi dùng Patch B vẫn cần phần `extraConfig.theming` như §1.1 (trừ `template_paths`/`extraVolumes`+`extraVolumeMounts` nếu đã mount thẳng vào `/usr/local/share/jupyterhub/templates` — schema Z2JH "Common uses" #1 ghi rõ cách này được server tự pick up vì default `template_paths` đã chứa `data_files_path/templates`).

---

## 3. Tạo ConfigMap (thay thế "kustomize-style", ngắn gọn)

Hai cách, chọn một:

**a) kubectl out-of-band (nhanh nhất, không đụng Terraform):**

```bash
kubectl create configmap hub-theme-templates -n hub \
  --from-file=web/theme/hub/templates/ --save-config
kubectl create configmap hub-theme-static -n hub \
  --from-file=web/theme/hub/static/ --save-config
```

> `--from-file=<dir>` lấy key = tên file trong dir. Cả 3 file static và 4 template đều là text nên ổn với ConfigMap (không cần binaryData). Muốn tái tạo thường xuyên qua IaC thì dùng cách (b).

**b) Terraform (xuyên suốt lifecycle):** thêm vào stack 04-hub-app (file mới, ví dụ `k8s_theme.tf`) — **requires `kubernetes` provider trong stack này (hiện main.tf chưa khai — UNVERIFIED, cần thêm provider block trước):**

```hcl
resource "kubernetes_config_map_v1" "hub_theme_templates" {
  metadata {
    name      = "hub-theme-templates"
    namespace = "hub"
  }
  data = {
    for f in fileset(path.module, "../../../web/theme/hub/templates/*.html") :
    basename(f) => file(f)
  }
}

resource "kubernetes_config_map_v1" "hub_theme_static" {
  metadata {
    name      = "hub-theme-static"
    namespace = "hub"
  }
  data = {
    for f in fileset(path.module, "../../../web/theme/hub/static/*") :
    basename(f) => file(f)
  }
}
```

> Nếu không muốn thêm `kubernetes` provider vào stack 04-hub-app, dùng cách (a) + ghi chú trong runbook là đủ (ConfigMap stateless, dễ tái tạo).

---

## 4. Single-user (JupyterLab) — theme extension `@mlbox/jlab-heroui-theme`

Mục tiêu: notebook pods khởi động với theme Light/Dark theo tokens HeroUI. Hai lựa chọn:

### 4a) (khuyến nghị) pip-install prebuilt theme extension vào `cpu_image` / `gpu_image`

Đây là cơ chế chuẩn của JupyterLab 4: prebuilt extension = pip package chứa `jupyter/labextensions/<name>/` + package.json metadata, server tự load, **không cần** build lại app. Wheel làm sẵn (xem `web/theme/lab/jlab-heroui-theme/`).

```dockerfile
# Trong Dockerfile của cpu_image / gpu_image
# Copy wheel vào build context trước, hoặc COPY từ builder stage:
COPY wheels/@mlbox_jlab_heroui_theme-0.1.0-py3-none-any.whl /tmp/wheels/

# Không cần index/RGBA ngoài: --no-index để đảm bảo chỉ dùng wheel vendored
RUN pip install --no-index --find-links=/tmp/wheels \
      "@mlbox-jlab-heroui-theme==0.1.0" \
    && rm -rf /tmp/wheels
```

Sau đó `jupyter labextension list` trong image phải hiện `heroui-light`, `heroui-dark` enabled
(hai plugin CSS-only theo hợp đồng `web/theme/README.md`).

> **Đánh giá:** cơ chế labextension prebuilt là cơ chế chuẩn JupyterLab 4 (docs extension dev);
> pattern docker cụ thể ở trên là *best practice*, kiểm chứng cuối bằng `jupyter labextension list` và trang `/lab`.

### 4b) (fallback verified-cơ-chế) inject CSS bằng `singleuser.extraFiles` + `LabApp.custom_css`

Đã verify ở JupyterLab 4.4.7: khi `c.LabApp.custom_css = True`, trang `/lab` tự link
`{base_url}custom/custom.css`, được serve từ `static_custom_path` mặc định
`[<ServerApp.config_dir>/custom, ...]` → với image docker-stacks (jovyan) đó là
`/home/jovyan/.jupyter/custom/custom.css`.

```yaml
singleuser:
  extraFiles:
    heroui_jupyter_server_config:
      mountPath: /home/jovyan/.jupyter/jupyter_server_config.py   # bật cờ custom_css
      stringData: |
        c.LabApp.custom_css = True
    heroui_lab_css:
      mountPath: /home/jovyan/.jupyter/custom/custom.css          # TÊN FILE BẮT BUỘC custom.css
      stringData: |
        /* flat CSS build từ cùng tokens: :root + [data-theme="dark"] + prefers-color-scheme;
           selector specificity cao hơn hoặc !important cho token đối xứng
           vì theme CSS (jp-ThemedContainer) được nạp SAU custom.css (đầu <head>) */
```

**Đánh giá rõ ràng:**

- Cơ chế (`LabApp.custom_css` traitlet + link trong `jupyterlab/static/index.html` 4.4.7 +
  `static_custom_path` trong jupyter_server 2.16): **VERIFIED từ source**.
- **Thứ tự cascade:** custom.css nạp ở đầu `<head>`; CSS của theme JupyterLab đang chọn (vd. JupyterLab Dark) được frontend inject *sau* khi app khởi động → theme có thể **ghi đè** rule cùng tầm quan trọng của custom.css. Vì vậy fallback này coi là **best-effort**: chỉ ổn khi flat CSS dùng `!important`/selector đủ mạnh; và **không theo được tính năng đổi theme Light/Dark của Lab** (user đổi theme trong Settings sẽ không đổi custom.css) — đây là lý do chính nên dùng 4a.
- Config dir trên image thật (`/home/jovyan/.jupyter`) là *giả định theo docker-stacks* —
  nếu image dựng khác, chạy `jupyter --config-dir` trong image để chốt. **UNVERIFIED cho image cụ thể.**
- Notebook 7 (`/tree`): **UNVERIFIED**, không khuyến khích dựa vào.
- Không dùng `ServerApp.extra_static_paths` để "inject CSS" — nó chỉ serve file, tự link phải tự làm
  (không có hook trong trang Lab như custom_css).

**Khuyến nghị:** ưu tiên 4a. 4b chỉ dùng khi tạm chưa build được wheel (VD giai đoạn đầu demo).

---

## 5. Runbook apply & verify

### 5.1 Apply

```bash
# 1. (nếu dùng Patch A + Terraform CMap) tạo ConfigMap trước (§3)
# 2. Paste values theo §1.1 (hoặc §2), rồi:
terraform -chdir=terraform/stacks/04-hub-app init
terraform -chdir=terraform/stacks/04-hub-app plan   # theo dõi: helm_release.jupyterhub sẽ upgrade
terraform -chdir=terraform/stacks/04-hub-app apply
```

### 5.2 Verify mount & config trong pod hub

```bash
ns=hub
# Volumes & mount như mong đợi trong Deployment:
kubectl -n $ns get deploy hub -o yaml | grep -A4 "hub-theme"        # volumes/mounts
# File trong container:
kubectl -n $ns exec deploy/hub -c hub -- ls /etc/jupyterhub/custom/templates
kubectl -n $ns exec deploy/hub -c hub -- ls /usr/local/share/jupyterhub/static/heroui
# Config đã render vào jupyterhub_config.py (chart generate file này cho hub):
kubectl -n $ns exec deploy/hub -c hub -- \
  grep -nE "template_paths|template_vars|logo_file|extra_static" /usr/local/etc/jupyterhub/jupyterhub_config.py
kubectl -n $ns exec deploy/hub -c hub -- head -3 /usr/local/share/jupyterhub/static/heroui/logo.svg
# Smoke cuối: logs start pod phải "Running JupyterHub" bình thường, không có TraitletsError/warn config:
kubectl -n $ns logs deploy/hub -c hub --tail=100 | grep -iE "error|traitlet"
```

### 5.3 Checklist trình duyệt (dùng domain `hub.<domain>`, HTTPS qua ALB+ACM)

| # | Kiểm | URL / thao tác | Kỳ vọng |
|---|---|---|---|
| 1 | Login page render | `/hub/login` | Template override chỉ thay block (heading/button), CTA "Sign in with AWS Cognito" hoạt động |
| 2 | CSS + logo nạp | devtools Network | `200` cho `/hub/static/heroui/heroui.css`, `/hub/static/heroui/motion.js`; `/hub/logo` trả SVG ML Box |
| 3 | Home | `/hub/home` | Title/tagline "ML Box / GPU notebooks for teams" do template override |
| 4 | Spawn | bấm "Start my server" | `spawn_pending.html`: progress + shimmer Motion; và trang vẫn dùng được khi JS fail (progressive enhancement) |
| 5 | Light/Dark hub | bật dark mode (nút `dark-theme-toggle` sẵn có) + toggle `prefers-color-scheme` trong devtools | CSS override đúng nhánh `[data-theme="dark"]`/media query theo đặc tả web/theme |
| 6 | Reduced motion | OS "reduce motion" ON | Không còn animation entrance/shimmer |
| 7 | JupyterLab • 4a | spawn CPU profile → `/lab` | UI theo theme light; Settings → Theme → "heroui-dark" đổi được sang dark |
| 8 | JupyterLab • 4b (fallback) | spawn CPU → `/lab` | `<link .../custom/custom.css>` trong `<head>`; kiểm tra các rule mới không bị theme mặc định đè (specificity/`!important`) |
| 9 | Proxy/ALB | HTTP→HTTPS | Chỉ 443, không lỗi mixed content với static hub |

### 5.4 Rollback

- Values: **xóa nguyên block** đã thêm trong `hub:` (extraConfig `theming`, `extraVolumes`, `extraVolumeMounts`) → `terraform apply` lại. Helm sẽ steer deployment không còn volume/mounts; pod thay thế sẽ chạy như trước khi patch.
- ConfigMap: có thể để lại (đã `optional: true`) hoặc `kubectl -n hub delete cm hub-theme-templates hub-theme-static` nếu muốn sạch.
- Singleuser 4a: revert Dockerfile/image (`profileList` trỏ lại image cũ; spawn lại để user pod thay).
- Singleuser 4b: xóa 2 key trong `singleuser.extraFiles` → terraform apply.

---

## 6. Điểm chưa verify / cần chốt lại khi áp dụng

1. **`{mountPath, files: [sources]}` không hợp lệ cho Z2JH 4.4.2** — schema thật là `{mountPath, data|stringData|binaryData, mode}` (1 file/entry). Đã chốt Patch A (ConfigMap) là đường chính.
2. `hub_title` / `hub_subtitle` / `page_logo`: **không có hiệu ứng built-in** trong JH5; chỉ sống nếu template override của team đọc chúng. Logo built-in nên đi qua `logo_file`.
3. Kubernetes provider chưa có trong stack 04-hub-app (main.tf chỉ chain helm_release) — nếu chọn ConfigMap bằng Terraform, cần thêm provider block; hoặc dùng kubectl §3a.
4. Path config dir single-user (`/home/jovyan/.jupyter`): giả định docker-stacks, phải verify bằng `jupyter --config-dir` trên image thật trước khi dùng 4b.
5. Notebook 7 tương thích `LabApp.custom_css`: UNVERIFIED.
6. Các config sẵn có (`10-spawn-hook`, Cognito auth,…) không bị đụng tới; mọi key thêm mới đều dùng tên riêng, không phủ đè key hiện hữu.
