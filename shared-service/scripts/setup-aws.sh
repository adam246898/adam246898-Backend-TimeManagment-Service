#!/bin/bash
# Creates the gateway's AWS resources in Floci (or real AWS). Safe to run more than once.
# Needs: Floci running, and the "floci" AWS CLI profile (AWS_PROFILE=floci in ~/.bashrc).
# Optional: export INTERNAL_TOKEN=... first, so it is stored in Secrets Manager (never in Git).
# Run from the gateway folder:   bash scripts/setup-aws.sh
set -euo pipefail

POOL_NAME="habit-tracker-users"
CLIENT_NAME="habit-tracker-web"
SECRET_NAME="gateway/secrets"
LOG_GROUP="/habit-tracker/gateway"
METRIC_NAMESPACE="HabitTracker"
METRIC_NAME="GatewayRejectedRequests"
ALARM_NAME="gateway-rejected-requests"

echo "Account: $(aws sts get-caller-identity --query Account --output text)"

# --- 1. Cognito user pool: passwords of 10+ characters with a digit; e-mail is the user name ---
POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" --output text)
if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then
  POOL_ID=$(aws cognito-idp create-user-pool --pool-name "$POOL_NAME" --username-attributes email \
    --policies 'PasswordPolicy={MinimumLength=10,RequireUppercase=false,RequireLowercase=false,RequireNumbers=true,RequireSymbols=false}' \
    --query UserPool.Id --output text)
  echo "user pool ready: $POOL_NAME ($POOL_ID, created)"
else
  echo "user pool ready: $POOL_NAME ($POOL_ID, already existed)"
fi

# --- 2. App client for the website: user name + password login, 1-hour access tokens ---
CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --max-results 60 \
  --query "UserPoolClients[?ClientName=='$CLIENT_NAME'].ClientId | [0]" --output text)
if [ -z "$CLIENT_ID" ] || [ "$CLIENT_ID" = "None" ]; then
  CLIENT_ID=$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL_ID" --client-name "$CLIENT_NAME" \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --access-token-validity 1 --token-validity-units AccessToken=hours \
    --query UserPoolClient.ClientId --output text)
  echo "app client ready: $CLIENT_NAME ($CLIENT_ID, created)"
else
  echo "app client ready: $CLIENT_NAME ($CLIENT_ID, already existed)"
fi

# --- 3. The "admin" group: members are Admins (contract 3.3) ---
aws cognito-idp get-group --user-pool-id "$POOL_ID" --group-name admin >/dev/null 2>&1 || \
  aws cognito-idp create-group --user-pool-id "$POOL_ID" --group-name admin --description "Platform administrators" >/dev/null
echo "group ready: admin"

# --- 4. Secrets Manager: the internal token shared with the services ---
if [ -n "${INTERNAL_TOKEN:-}" ]; then
  SECRET_JSON=$(node -e 'process.stdout.write(JSON.stringify({ INTERNAL_TOKEN: process.env.INTERNAL_TOKEN }))')
  if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" --secret-string "$SECRET_JSON" >/dev/null
  else
    aws secretsmanager create-secret --name "$SECRET_NAME" --secret-string "$SECRET_JSON" >/dev/null
  fi
  echo "secret ready: $SECRET_NAME"
else
  echo "secret skipped: export INTERNAL_TOKEN first to store it in $SECRET_NAME"
fi

# --- 5. CloudWatch: log group, metric filter on 401/403/429 and alarm (> 10 in 5 minutes) ---
if [ -z "$(aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" \
      --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" --output text)" ]; then
  aws logs create-log-group --log-group-name "$LOG_GROUP"
fi
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 14
aws logs put-metric-filter --log-group-name "$LOG_GROUP" --filter-name gateway-rejected \
  --filter-pattern '{ ($.statusCode = 401) || ($.statusCode = 403) || ($.statusCode = 429) }' \
  --metric-transformations "metricName=$METRIC_NAME,metricNamespace=$METRIC_NAMESPACE,metricValue=1,defaultValue=0"
aws cloudwatch put-metric-alarm --alarm-name "$ALARM_NAME" \
  --alarm-description "More than 10 rejected requests (401/403/429) at the gateway in 5 minutes" \
  --namespace "$METRIC_NAMESPACE" --metric-name "$METRIC_NAME" --statistic Sum --period 300 \
  --evaluation-periods 1 --threshold 10 --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching
echo "log group, metric filter and alarm ready: $LOG_GROUP"

echo
echo "Done. Put these lines in your .env:"
echo "  COGNITO_USER_POOL_ID=$POOL_ID"
echo "  COGNITO_CLIENT_ID=$CLIENT_ID"
echo "  SECRETS_ID=$SECRET_NAME"
echo "  CLOUDWATCH_LOG_GROUP=$LOG_GROUP"
