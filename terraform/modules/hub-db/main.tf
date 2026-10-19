# RDS Postgres for the hub (replaces Z2JH's SQLite). Master password managed by RDS in Secrets Manager.

resource "aws_db_subnet_group" "hub" {
  name       = "${var.cluster_name}-hub"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "hub_db" {
  name        = "${var.cluster_name}-hub-db"
  description = "Hub DB, EKS nodes only"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "hub_db" {
  security_group_id            = aws_security_group.hub_db.id
  referenced_security_group_id = var.allowed_security_group_id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Postgres from EKS nodes"
}

resource "aws_db_instance" "hub" {
  identifier = "${var.cluster_name}-hub"

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage           = var.allocated_storage
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "jhub"
  username                    = "jhub_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.hub.name
  vpc_security_group_ids = [aws_security_group.hub_db.id]
  publicly_accessible    = false
  multi_az               = false # lab Single-AZ; true in prod

  backup_retention_period    = var.backup_retention_days
  backup_window              = "17:00-18:00" # UTC ~ early morning Sydney, few users
  copy_tags_to_snapshot      = true
  delete_automated_backups   = true
  skip_final_snapshot        = true # lab; in prod set false + final_snapshot_identifier
  deletion_protection        = var.deletion_protection
  auto_minor_version_upgrade = true

  tags = var.tags
}
