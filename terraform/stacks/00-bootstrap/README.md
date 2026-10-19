# 00-bootstrap: creates the S3 state bucket + DynamoDB lock table. Runs once per account; its own state stays local.
# On apply it also writes backend.hcl directly into ../01-foundation, ../02-gpu and ../03-hub,
# composing the bucket/table names from the current AWS account ID - nothing gets typed by hand.
