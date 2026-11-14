# 05-gpu: NVIDIA device plugin with time-slicing (2 replicas @ T4) + DCGM exporter.
# Renamed from 99-unverified-gpu on 2026-11-07 after the first apply; the old
# remote state key is kept as backup. L4 (g6) chưa có capacity ở Sydney — hiện
# chạy g4dn.xlarge (T4). Apply only after that region's GPU quota is granted.
# Cluster endpoint/CA resolve automatically from data "aws_eks_cluster".
# Quyết định time-slicing: renameByDefault=false — xem modules/gpu-stack.
