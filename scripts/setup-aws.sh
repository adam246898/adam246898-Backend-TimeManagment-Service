#!/bin/bash
# Creates time-service's AWS resources in Floci (or real AWS). Safe to run more than once.
# Needs: Floci running, and the "floci" AWS CLI profile (AWS_PROFILE=floci in ~/.bashrc).
#
# Optional: export these first, so they are stored in Secrets Manager (never type them into Git):
#   export INTERNAL_TOKEN=...  GOOGLE_CLIENT_ID=...  GOOGLE_CLIENT_SECRET=...
#
# Run from the time-service folder:   bash scripts/setup-aws.sh
set -euo pipefail

SERVICE=time-service
KEY_ALIAS="alias/$SERVICE-google-tokens"
SECRET_NAME="$SERVICE/secrets"
LOG_GROUP="/habit-tracker/$SERVICE"
METRIC_NAMESPACE="HabitTracker"
METRIC_NAME="TimeServiceRejectedRequests"
ALARM_NAME="$SERVICE-rejected-requests"
BUCKET="$SERVICE-backups"
ROLE_NAME="$SERVICE-role"
POLICY_NAME="$SERVICE-least-privilege"
REGION="${AWS_REGION:-us-east-1}"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "Account: $ACCOUNT"

# --- 1. KMS key: encrypts users' Google refresh tokens and this service's secret ---
if aws kms describe-key --key-id "$KEY_ALIAS" >/dev/null 2>&1; then
  echo "kms key ready: $KEY_ALIAS (already existed)"
else
  KEY_ID=$(aws kms create-key --description "$SERVICE: Google refresh tokens" --query KeyMetadata.KeyId --output text)
  aws kms create-alias --alias-name "$KEY_ALIAS" --target-key-id "$KEY_ID"
  echo "kms key ready: $KEY_ALIAS (created)"
fi

# --- 2. Secrets Manager: Google client secret and the internal token, encrypted with the key ---
SECRET_JSON=$(node -e '
  const v = {};
  for (const k of ["INTERNAL_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) if (process.env[k]) v[k] = process.env[k];
  process.stdout.write(JSON.stringify(v));')
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
  if [ "$SECRET_JSON" != "{}" ]; then
    aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" --secret-string "$SECRET_JSON" >/dev/null
    echo "secret ready: $SECRET_NAME (new value stored)"
  else
    echo "secret ready: $SECRET_NAME (already existed, unchanged)"
  fi
else
  aws secretsmanager create-secret --name "$SECRET_NAME" --kms-key-id "$KEY_ALIAS" \
    --description "$SERVICE secrets" --secret-string "$SECRET_JSON" >/dev/null
  echo "secret ready: $SECRET_NAME (created)"
fi

# --- 3. CloudWatch: log group, metric filter on 401/403/429, alarm (> 10 in 5 minutes) ---
if [ -z "$(aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" \
      --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" --output text)" ]; then
  aws logs create-log-group --log-group-name "$LOG_GROUP"
fi
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 14
echo "log group ready: $LOG_GROUP"

# put-metric-filter and put-metric-alarm overwrite an existing one with the same name.
aws logs put-metric-filter --log-group-name "$LOG_GROUP" --filter-name "$SERVICE-rejected" \
  --filter-pattern '{ ($.statusCode = 401) || ($.statusCode = 403) || ($.statusCode = 429) }' \
  --metric-transformations "metricName=$METRIC_NAME,metricNamespace=$METRIC_NAMESPACE,metricValue=1,defaultValue=0"
echo "metric filter ready: $SERVICE-rejected"

aws cloudwatch put-metric-alarm --alarm-name "$ALARM_NAME" \
  --alarm-description "More than 10 rejected requests (401/403/429) in 5 minutes" \
  --namespace "$METRIC_NAMESPACE" --metric-name "$METRIC_NAME" \
  --statistic Sum --period 300 --evaluation-periods 1 --threshold 10 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching
echo "alarm ready: $ALARM_NAME"

# --- 4. S3: private, KMS-encrypted, versioned bucket for backups of the time_* tables ---
# Report section 15: backups encrypted with KMS in S3; older than 30 days move to Glacier, deleted after a year.
KEY_ARN=$(aws kms describe-key --key-id "$KEY_ALIAS" --query KeyMetadata.Arn --output text)
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "bucket ready: $BUCKET (already existed)"
else
  aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  echo "bucket ready: $BUCKET (created)"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  "{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"aws:kms\",\"KMSMasterKeyID\":\"$KEY_ARN\"},\"BucketKeyEnabled\":true}]}" >/dev/null
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled >/dev/null
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"backups-to-glacier-then-expire","Status":"Enabled","Filter":{"Prefix":"backups/"},"Transitions":[{"Days":30,"StorageClass":"GLACIER"}],"Expiration":{"Days":365}}]}' >/dev/null
echo "bucket settings ready: public access blocked, KMS encryption, versioning, lifecycle (Glacier after 30 days)"

# --- 5. IAM: service-c's own least-privilege role (report section 8.1) ---
# It may use ONLY its own KMS key, its own secret, its own log group and its own backup bucket. No "Resource": "*".
SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --query ARN --output text)
LOG_ARN="arn:aws:logs:$REGION:$ACCOUNT:log-group:$LOG_GROUP"
mkdir -p infra/iam
node -e '
const [keyArn, secretArn, logArn, bucket] = process.argv.slice(1);
const fs = require("fs");
fs.writeFileSync("infra/iam/time-service-trust.json", JSON.stringify({
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" }],
}, null, 2) + "\n");
fs.writeFileSync("infra/iam/time-service-policy.json", JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    { Sid: "UseOwnKmsKey", Effect: "Allow", Action: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"], Resource: keyArn },
    { Sid: "ReadOwnSecret", Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: secretArn },
    { Sid: "WriteOwnLogs", Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: [logArn, `${logArn}:*`] },
    { Sid: "ListOwnBackups", Effect: "Allow", Action: ["s3:ListBucket"], Resource: `arn:aws:s3:::${bucket}` },
    { Sid: "ReadWriteOwnBackups", Effect: "Allow", Action: ["s3:PutObject", "s3:GetObject"], Resource: `arn:aws:s3:::${bucket}/backups/*` },
  ],
}, null, 2) + "\n");
' "$KEY_ARN" "$SECRET_ARN" "$LOG_ARN" "$BUCKET"
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "role ready: $ROLE_NAME (already existed)"
else
  aws iam create-role --role-name "$ROLE_NAME" --description "service-c (time-service): least privilege" \
    --assume-role-policy-document file://infra/iam/time-service-trust.json >/dev/null
  echo "role ready: $ROLE_NAME (created)"
fi
# put-role-policy overwrites the policy with the same name, so the role always matches the file.
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" \
  --policy-document file://infra/iam/time-service-policy.json
aws iam get-instance-profile --instance-profile-name "$ROLE_NAME" >/dev/null 2>&1 || {
  aws iam create-instance-profile --instance-profile-name "$ROLE_NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE_NAME" --role-name "$ROLE_NAME"
}
echo "policy ready: $POLICY_NAME (own key, own secret, own log group, own backups only)"

echo
echo "Done. Put these lines in your .env:"
echo "  KMS_KEY_ID=$KEY_ALIAS"
echo "  SECRETS_ID=$SECRET_NAME"
echo "  CLOUDWATCH_LOG_GROUP=$LOG_GROUP"
echo "  BACKUP_BUCKET=$BUCKET"
