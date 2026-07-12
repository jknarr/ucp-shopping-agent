#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_id="${GOOGLE_CLOUD_PROJECT:-gen-lang-client-0893499492}"
region="${GOOGLE_CLOUD_REGION:-us-central1}"
service="${CLOUD_RUN_SERVICE:-gemini-agent}"
merchant_url="${MERCHANT_BASE_URL:-https://demo-merchant.jknarr.workers.dev}"
handler_url="${PAYMENT_HANDLER_MODULE_URL:-https://paze.jknarr.workers.dev/paze-handler.js}"

gcloud run deploy "$service" \
  --project "$project_id" \
  --region "$region" \
  --source "$root_dir" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars "MERCHANT_BASE_URL=$merchant_url,PAYMENT_HANDLER_MODULE_URL=$handler_url,ADK_MODEL=gemini-3.1-flash-lite,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$project_id,GOOGLE_CLOUD_LOCATION=global" \
  --remove-secrets "GOOGLE_API_KEY" \
  --quiet

service_url="$(
  gcloud run services describe "$service" \
    --project "$project_id" \
    --region "$region" \
    --format='value(status.url)'
)"

gcloud run services update "$service" \
  --project "$project_id" \
  --region "$region" \
  --update-env-vars "AGENT_PUBLIC_URL=$service_url,CHAT_ORIGIN=$service_url" \
  --quiet

printf 'Gemini agent: %s\n' "$service_url"
