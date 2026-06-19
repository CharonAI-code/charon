#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-install}"
ROOT="${CHARON_AEON_ROOT:-$(pwd)}"
cd "$ROOT"

json_escape() {
  node -e 'let s=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => s += c); process.stdin.on("end", () => process.stdout.write(JSON.stringify(s)));'
}

emit_json() {
  local status="$1"
  local message="$2"
  local committed="${3:-false}"
  local pushed="${4:-false}"
  printf '{\n'
  printf '  "schema": "charon.aeonSetup.v1",\n'
  printf '  "mode": %s,\n' "$(printf '%s' "$MODE" | json_escape)"
  printf '  "status": %s,\n' "$(printf '%s' "$status" | json_escape)"
  printf '  "message": %s,\n' "$(printf '%s' "$message" | json_escape)"
  printf '  "committed": %s,\n' "$committed"
  printf '  "pushed": %s,\n' "$pushed"
  printf '  "workflow": ".github/workflows/aeon.yml",\n'
  printf '  "policy": "charon.aeon.yml"\n'
  printf '}\n'
}

charon() {
  if [[ -n "${CHARON_BIN:-}" ]]; then
    "$CHARON_BIN" "$@"
  else
    npx -y github:CharonAI-code/charon "$@"
  fi
}

case "$MODE" in
  ""|setup|install|enable|repair) MODE="install" ;;
  status|check|verify) MODE="status" ;;
  test|smoke) MODE="test" ;;
  *) MODE="install" ;;
esac

if [[ ! -f ".github/workflows/aeon.yml" ]]; then
  emit_json "blocked" "Aeon workflow not found: .github/workflows/aeon.yml" false false
  exit 2
fi

if [[ ! -f "aeon.yml" ]]; then
  emit_json "blocked" "Aeon config not found: aeon.yml" false false
  exit 2
fi

if [[ "$MODE" != "status" ]]; then
  if ! charon enforce aeon >/tmp/charon-aeon-enforce.out 2>/tmp/charon-aeon-enforce.err; then
    if grep -qiE "permission|denied|workflow" /tmp/charon-aeon-enforce.err /tmp/charon-aeon-enforce.out 2>/dev/null; then
      emit_json "blocked" "GitHub blocked workflow modification. Give this repo workflow write permission, then ask me to set up Charon again." false false
    else
      emit_json "failed" "$(cat /tmp/charon-aeon-enforce.err /tmp/charon-aeon-enforce.out 2>/dev/null | tail -n 20)" false false
    fi
    exit 1
  fi
fi

if ! charon enforce aeon status | grep -q "AEON ENFORCED"; then
  emit_json "failed" "Charon enforce status did not report AEON ENFORCED." false false
  exit 1
fi

if [[ "$MODE" != "status" ]]; then
  if ! charon aeon smoke | grep -q "AEON MVP SMOKE PASS"; then
    emit_json "failed" "Charon Aeon smoke check did not pass." false false
    exit 1
  fi
fi

committed=false
pushed=false

if [[ "$MODE" != "status" ]] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add .github/workflows/aeon.yml charon.aeon.yml
  if ! git diff --cached --quiet; then
    git config user.name >/dev/null 2>&1 || git config user.name "Charon Setup"
    git config user.email >/dev/null 2>&1 || git config user.email "setup@charon.codes"
    git commit -m "Enable Charon for AEON" >/dev/null
    committed=true
  fi
  if [[ "${CHARON_SETUP_NO_PUSH:-}" != "1" ]] && git remote get-url origin >/dev/null 2>&1; then
    if git push origin HEAD >/dev/null; then
      pushed=true
    else
      emit_json "blocked" "Charon setup committed locally, but git push failed. Check repository push permissions." "$committed" false
      exit 1
    fi
  fi
fi

emit_json "ok" "Charon is enabled for this AEON repo. Status: AEON ENFORCED. Smoke: AEON MVP SMOKE PASS." "$committed" "$pushed"
