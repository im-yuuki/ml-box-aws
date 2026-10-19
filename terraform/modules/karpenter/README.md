# karpenter module: controller (Helm) + node IAM role/instance profile +
# EC2NodeClass/NodePool (cpu-user, gpu-shared-l4, gpu-dedicated) + EventBridge rules
# for the SQS interruption queue. No MIG. The EC2FullAccess controller policy is temporary (TODO narrow it).
