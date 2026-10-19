# gpu-stack: device plugin time-slicing (shared) + DCGM exporter. No MIG.
# Verify before apply:
# 1. Label the L4 nodes: nvidia.com/device-plugin.config=time-slicing-shared
#    (label key + per-node config mechanism matching the chart version in use)
# 2. Test pod: resources nvidia.com/gpu.shared: 1, run nvidia-smi, spawn 3 pods/GPU
# 3. renameByDefault=true renames the resource to nvidia.com/gpu.shared — pods must not accidentally get a whole GPU
