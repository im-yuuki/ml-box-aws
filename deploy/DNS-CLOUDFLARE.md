# DNS/ACM: delegate nameserver từ Cloudflare sang Route53

Bố cục deploy sau khi tách stack:

```
00-bootstrap     S3 state + DDB lock
01-foundation    VPC + EKS + Karpenter (NodePool cpu-user + gpu-shared-l4)
02-platform      S3 workspace + RDS + Cognito + ECR + LB controller + ALB/TG + Route53 aliases
   >>> KHOẢNG NGHỈ: delegate subdomain mlbox sang Route53, đổi NS ở parent Cloudflare, chờ ACM ISSUED <<<
03-hub-app       JupyterHub (Z2JH) + TargetGroupBinding + listener + profile CPU
04-dashboard     Dashboard + BFF + apex listener rule

99-unverified-gpu device plugin + DCGM + L4 shared [TÙY CHỌN - chỉ apply khi có GPU quota]
```

## Vì sao phải có khoảng nghỉ

Zone Route53 và chứng thư ACM được tạo ở `00-bootstrap`; ALB và alias record được tạo ở
`02-platform`. Cần hoàn tất NS delegation và để ACM chuyển sang `ISSUED` trước khi
apply các stack phụ thuộc vào HTTPS listener.

## Trỏ NS: Cloudflare -> Route53 (zone do Route53 quản lý)

Zone `mlbox.june8th.me` do **Route53** giữ, Cloudflare chỉ là nơi khai báo nameserver.
Sau khi apply `00-bootstrap`, Terraform đã tạo sẵn:

- zone Route53 `mlbox.june8th.me` (output `route53_zone_id`)
- ACM validation CNAME records trong zone Route53
- chứng thư ACM cho `notebook.mlbox.june8th.me` và `mlbox.june8th.me`

Việc cần làm ở parent Cloudflare: tạo/cập nhật NS delegation cho subdomain `mlbox` bằng
4 nameserver từ `terraform -chdir=terraform/stacks/00-bootstrap output route53_zone_nameservers`.
Sau khi ACM chuyển sang `ISSUED`, apply `02-platform` để tạo ALB và các A-alias record.

> Lưu ý: khi Cloudflare mất quyền authoritative với zone này, **mọi bản ghi khác đang
> nằm ở Cloudflare của zone `mlbox.june8th.me` sẽ ngừng phục vụ** và phải tạo lại trong
> Route53. Chỉ zone này bị ảnh hưởng, các zone khác của Cloudflare không đổi.

Không tạo CNAME/TXT validation thủ công trong Cloudflare. Route53 là authoritative cho
subdomain `mlbox`, nên `00-bootstrap` tự quản lý validation CNAME; Cloudflare chỉ giữ
bản ghi NS delegation ở parent zone.

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
