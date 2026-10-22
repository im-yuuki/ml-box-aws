# DNS thủ công ở Cloudflare (giữa 2 stack)

Bố cục deploy sau khi tách stack:

```
00-bootstrap     S3 state + DDB lock
01-foundation    VPC + EKS + Karpenter (NodePool cpu-user + gpu-shared-l4)
02-platform      S3 workspace + RDS + Cognito + ECR + LB controller + ALB/TG + ACM cert
   >>> KHOẢNG NGHỈ: cập nhật DNS ở Cloudflare (2 bản ghi bên dưới) <<<
03-hub-app       JupyterHub (Z2JH) + TargetGroupBinding + listener + profile CPU
04-dashboard     Dashboard + BFF + apex listener rule

99-unverified-gpu device plugin + DCGM + L4 shared [TÙY CHỌN - chỉ apply khi có GPU quota]
```

## Vì sao phải có khoảng nghỉ

ALB và chứng thư ACM nằm ở `02-platform`, nên **sau khi apply xong 02-platform** thì
mới có đủ thông tin để trỏ DNS. Không có bước này thì `https://notebook.<domain>` không mở được.

## Trỏ NS: Cloudflare -> Route53 (zone do Route53 quản lý)

Zone `mlbox.june8th.me` do **Route53** giữ, Cloudflare chỉ là nơi khai báo nameserver.
Sau khi apply `02-platform` với `manage_route53 = true`, Terraform đã tạo sẵn:

- zone Route53 `mlbox.june8th.me` (zone id trong output `zone_id` của module)
- CNAME `_010010825fc1365b34bee431731aac0a.notebook.mlbox.june8th.me` -> giá trị validate của ACM
- A-alias `notebook.mlbox.june8th.me` -> ALB

Việc cần làm ở Cloudflare: đổi nameserver của zone `mlbox.june8th.me` sang 4 NS của
Route53 (đọc từ zone, hoặc `terraform -chdir=terraform/stacks/02-platform output zone_nameservers`).

> Lưu ý: khi Cloudflare mất quyền authoritative với zone này, **mọi bản ghi khác đang
> nằm ở Cloudflare của zone `mlbox.june8th.me` sẽ ngừng phục vụ** và phải tạo lại trong
> Route53. Chỉ zone này bị ảnh hưởng, các zone khác của Cloudflare không đổi.

Vì sao không dùng CNAME + TXT trong Cloudflare như phương án "grey cloud": phiên bản
này Route53 là nguồn chính (như các lần deploy trước) nên Terraform tự lo cả TXT validate
lẫn A-alias, Cloudflare chỉ trỏ NS một lần rồi không phải đụng vào zone nữa.

## Sau khi trỏ NS xong

1. Chờ chứng thư ACM chuyển sang `ISSUED` (thường 1-3 phút):
   ```bash
   aws acm describe-certificate --certificate-arn <certificate_arn> --query status --output text
   ```
2. Apply `03-hub-app`. Stack này tự poll chờ cert `ISSUED` (tối đa 15 phút) rồi mới tạo listener HTTPS.
3. Apply `04-dashboard` để tạo dashboard ở apex `https://mlbox.<domain>`.
4. Áp theme:
   ```bash
   deploy/apply-hub-theme.sh
   ```
5. Kiểm tra trình duyệt: `https://notebook.<domain>/hub/login` → đăng nhập Cognito → `/hub/home` → spawn profile "CPU only"; dashboard ở `https://mlbox.<domain>`.

`99-unverified-gpu` không nằm trong luồng bắt buộc. Chỉ apply stack này sau khi AWS cấp GPU quota, rồi mới bật GPU profile trong `03-hub-app`.

## Lưu ý khi cần làm lại cert

Cert ACM không cần bản ghi TXT sau khi đã `ISSUED` (nhưng đừng xoá CNAME validate trong
Route53 nếu muốn re-create cert sau này - Terraform sẽ tạo lại khi apply).
Nếu đổi domain, phải tạo lại cert + zone/record mới, rồi apply lại `02-platform` trước khi apply `03-hub-app`.
