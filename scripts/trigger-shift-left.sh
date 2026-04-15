#!/usr/bin/env bash
# Trigger AEM shift-left via da-agent POST /chat (Bedrock will call aem_shift_left_content_create).
# Prerequisites: da-agent running (`npm run dev`), AWS Bedrock in .dev.vars, AEM_SHIFT_LEFT_A2A_URL set, valid IMS token.
#
# Usage:
#   export IMS_TOKEN='eyJ...'   # stage IMS access token
#   ./scripts/trigger-shift-left.sh
#
# Optional env:
#   CHAT_URL     default http://127.0.0.1:4002/chat
#   ORG, SITE    default aemsites / da-block-collection
#   PAGE_PATH    default /index.html  (repo path for pageContext)
#   PROMPT       override user message (should ask to use the shift-left tool)
#
# Wrangler terminal should show: [da-agent] AEM shift-left A2A → POST https://…/a2a/ …

set -euo pipefail

CHAT_URL="${CHAT_URL:-http://127.0.0.1:4002/chat}"
ORG="${ORG:-aemsites}"
SITE="${SITE:-da-block-collection}"
PAGE_PATH="${PAGE_PATH:-/index.html}"

if [[ -z "${IMS_TOKEN:-}" ]]; then
  echo "error: set IMS_TOKEN to your stage Adobe IMS access token (JWT)." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)." >&2
  exit 1
fi

PROMPT="${PROMPT:-Use the aem_shift_left_content_create tool to draft one short hero headline for a hiking boots landing page.}"

BODY="$(jq -n \
  --arg tok "$IMS_TOKEN" \
  --arg org "$ORG" \
  --arg site "$SITE" \
  --arg path "$PAGE_PATH" \
  --arg prompt "$PROMPT" \
  '{
    imsToken: $tok,
    pageContext: { org: $org, site: $site, path: $path, view: "browse" },
    messages: [ { role: "user", content: $prompt } ]
  }')"

echo "POST $CHAT_URL (stream) — watch this terminal for [da-agent] AEM shift-left A2A …" >&2
curl -sN -X POST "$CHAT_URL" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
echo >&2
