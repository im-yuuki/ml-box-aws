# gpu-stack: device plugin time-slicing (shared) + DCGM exporter. No MIG.
# Verify before apply:
# 1. Label the shared nodes: `nvidia.com/device-plugin.config=any` (t4 shared pool; label khai báo trong NodePool).
#    Time-slicing config "any" giữ tên chuẩn `nvidia.com/gpu` (renameByDefault=false).
# 2. Test pod: `resources.nvidia.com/gpu: 1`, run nvidia-smi, spawn 2 pods/GPU (replicas=2 @ 8GB commit, T4 16GB).
# 3. `renameByDefault=false` giữ nguyên tên `nvidia.com/gpu` — Karpenter và NodePool chỉ biết resource này.
# Rename cũ (`nvidia.com/gpu.shared`) đã bỏ vì shared pods unschedulable.
