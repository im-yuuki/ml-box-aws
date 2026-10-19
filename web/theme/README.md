# ML Box Web Theme — HeroUI design layer

Đây là tầng 1 (Branding) của lộ trình UX: theme cho **JupyterHub hub pages** và
**JupyterLab workspace**, dùng design tokens của HeroUI v3.

## Hợp đồng chung (đọc trước khi sửa bất kỳ file nào)

### Single source of truth
- `tokens/heroui-tokens.css` — TẤT CẢ màu/radius/motion lấy từ đây.
  Cấm hard-code màu oklch/hex mới. Nếu thiếu token, thêm vào file này trước
  rồi tham chiếu `var(--token)`.
- Light = `:root`, dark = `[data-theme="dark"]` + `prefers-color-scheme`
  fallback. Không dùng cơ chế dark khác.

### Cấu trúc thư mục (đã chốt — không đổi tên)
```
web/theme/
  tokens/heroui-tokens.css     # nền tảng (đã có)
  hub/                         # JupyterHub hub pages
    templates/                 # Jinja override: page/login/home/spawn_pending
    static/heroui.css          # CSS build (Tailwind) — tokens đã được inlined
    static/motion.js           # Motion (framer-motion vanilla) — vendored
    static/logo.svg
    build/                     # nguồn Tailwind: input.css + config + package.json
  lab/jlab-heroui-theme/       # prebuilt JupyterLab theme extension (light+dark)
deploy/
  hub-values-theme.patch.md    # hướng dẫn apply values Z2JH (đã viết — Patch A)
```

### Cách mount đã verify với Z2JH 4.4.2 (bắt buộc bám theo)
- Templates: ConfigMap + `hub.extraVolumeMounts` vào `/etc/jupyterhub/custom/templates`,
  đọc qua `c.JupyterHub.template_paths`.
- Static: KHÔNG có `c.JupyterHub.extra_static_paths` trên Hub (traitlet đó là của
  jupyter_server — single-user side). Static phải mount vào
  `/usr/local/share/jupyterhub/static/heroui/` — tornado serve tại
  `/hub/static/heroui/...`. Templates trong page.html phải link đúng:
  `{{ base_url }}hub/static/heroui/heroui.css` và `.../motion.js`.
- Chi tiết đầy đủ (Patch A trong `deploy/hub-values-theme.patch.md`).

### Branding
- Tên sản phẩm: **ML Box**. Tagline gợi ý: "GPU notebooks for teams".
- Accent duy nhất: `var(--accent)` (xanh HeroUI). Không thêm màu thương hiệu mới.
- Typography: hệ font stack của HeroUI (Inter/ui-sans fallback system-ui).

### Motion (framer-motion)
- Hub pages là Jinja server-rendered → không có React. Dùng **Motion**
  (vanilla JS của đội framer-motion, gói `motion`), vendored vào
  `hub/static/motion.js`. Chỉ animate entrance (fade-up stagger), spinner,
  progress shimmer. Progressive enhancement: trang phải dùng được nếu JS fail.
- Easing/duration tham chiếu token `--ease-out/--duration-*` trong CSS.

### Nguyên tắc chất lượng
- Hub templates luôn `{% extends "page.html" %}` và chỉ override block
  (heading, message, …) — KHÔNG copy nguyên template gốc của JupyterHub 5,
  để upgrade chart (Z2JH 4.4.2) không vỡ.
- JupyterLab: theme extension dạng prebuilt, 2 plugin `heroui-light` +
  `heroui-dark`, chỉ CSS — không đụng DOM Lumino.
- Mọi animation phải có `prefers-reduced-motion: reduce` fallback.
