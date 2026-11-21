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

echo "Account: $(aws sts get-caller-identity --query Account --output text)"

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

echo
echo "Done. Put these lines in your .env:"
echo "  KMS_KEY_ID=$KEY_ALIAS"
echo "  SECRETS_ID=$SECRET_NAME"
echo "  CLOUDWATCH_LOG_GROUP=$LOG_GROUP"
