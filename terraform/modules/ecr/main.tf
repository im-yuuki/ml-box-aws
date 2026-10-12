# ECR cho image chuẩn (build image nằm ngoài Terraform, mục 8 doc).

resource "aws_ecr_repository" "images" {
  for_each = toset(var.repo_names)

  name                 = "${var.project}/${each.value}"
  image_tag_mutability = "MUTABLE" # lab; prod cân nhắc IMMUTABLE cho release tag
  tags                 = var.tags

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "images" {
  for_each   = toset(var.repo_names)
  repository = aws_ecr_repository.images[each.value].name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Giữ 10 image mới nhất"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
