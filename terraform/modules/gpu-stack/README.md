# gpu-stack: device plugin time-slicing (shared) + DCGM exporter. Không MIG.
# Verify trước apply:
# 1. Label node L4: nvidia.com/device-plugin.config=time-slicing-shared
#    (key label + cơ chế config theo node đối chiếu chart version đang dùng)
# 2. Pod test: resources nvidia.com/gpu.shared: 1, chạy nvidia-smi, spawn 3 pod/GPU
# 3. renameByDefault=true đổi resource thành nvidia.com/gpu.shared — pod không vô tình nhận nguyên GPU
