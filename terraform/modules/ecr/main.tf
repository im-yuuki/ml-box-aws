# ECR for the standard images (the image build lives outside Terraform, handoff doc §8).

resource "aws_ecr_repository" "images" {
  for_each = toset(var.repo_names)

  name                 = "${var.project}/${each.value}"
  image_tag_mutability = "MUTABLE" # lab; consider IMMUTABLE for release tags in prod
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
      description  = "Keep the 10 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
