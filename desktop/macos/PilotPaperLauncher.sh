#!/bin/bash
set -euo pipefail

APP_NAME="PilotPaper"
APP_URL="http://127.0.0.1:5173/"
APP_SUPPORT="$HOME/Library/Application Support/PilotPaper"
CURRENT_DIR="$APP_SUPPORT/app/current"
RUNTIME_DIR="$APP_SUPPORT/runtime"
LOG_DIR="$APP_SUPPORT/logs"
LOG_FILE="$LOG_DIR/pilotpaper-macos.log"
BUNDLE_RESOURCES="$(cd "$(dirname "$0")/../Resources" && pwd)"
BASELINE_DIR="$BUNDLE_RESOURCES/baseline"
BASELINE_RUNTIME="$BUNDLE_RESOURCES/runtime"
UPDATE_API="https://api.github.com/repos/descombesclovis-maker/PilotPaper-V2/releases/tags/pilotpaper-desktop-latest"

mkdir -p "$APP_SUPPORT" "$RUNTIME_DIR" "$LOG_DIR"
exec >>"$LOG_FILE" 2>&1
printf '\n===== PilotPaper macOS %s =====\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

notify_error() {
  /usr/bin/osascript -e 'display alert "PilotPaper" message '"'"'"$1"'"'"' as critical' >/dev/null 2>&1 || true
}

ensure_openai_key() {
  local vars="$APP_SUPPORT/.dev.vars"
  if [[ -f "$vars" ]] && /usr/bin/grep -q '^OPENAI_API_KEY=.' "$vars"; then
    return 0
  fi
  local key
  key=$(/usr/bin/osascript <<'APPLESCRIPT'
try
  set r to display dialog "Colle ta clé API OpenAI. Elle restera uniquement sur ce Mac." default answer "" with hidden answer buttons {"Annuler", "Enregistrer"} default button "Enregistrer" with title "Configuration PilotPaper"
  return text returned of r
on error number -128
  return ""
end try
APPLESCRIPT
)
  if [[ ${#key} -lt 20 ]]; then
    notify_error "Clé OpenAI absente ou invalide."
    exit 1
  fi
  printf 'OPENAI_API_KEY=%s\n' "$key" > "$vars"
  chmod 600 "$vars"
}

install_baseline_if_needed() {
  if [[ ! -d "$CURRENT_DIR" ]]; then
    mkdir -p "$CURRENT_DIR"
    /usr/bin/ditto "$BASELINE_DIR" "$CURRENT_DIR"
  fi
  if [[ ! -x "$RUNTIME_DIR/node" ]]; then
    /usr/bin/ditto "$BASELINE_RUNTIME/node" "$RUNTIME_DIR/node"
    chmod +x "$RUNTIME_DIR/node"
  fi
}

try_update() {
  local tmp="$APP_SUPPORT/.update"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  if ! /usr/bin/curl -fsSL --connect-timeout 5 --max-time 15 "$UPDATE_API" -o "$tmp/release.json"; then
    echo "Update check skipped: release unavailable"
    return 0
  fi
  local manifest_url payload_url
  manifest_url=$(/usr/bin/python3 - "$tmp/release.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
for a in x.get('assets',[]):
    if a.get('name')=='pilotpaper-macos-manifest.json':
        print(a.get('browser_download_url',''))
        break
PY
)
  payload_url=$(/usr/bin/python3 - "$tmp/release.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
for a in x.get('assets',[]):
    if a.get('name')=='PilotPaper-Mac-App.zip':
        print(a.get('browser_download_url',''))
        break
PY
)
  [[ -n "$manifest_url" && -n "$payload_url" ]] || { echo "No macOS update assets yet"; return 0; }
  /usr/bin/curl -fsSL --max-time 20 "$manifest_url" -o "$tmp/manifest.json" || return 0
  local remote_sha remote_version local_version
  remote_sha=$(/usr/bin/python3 - "$tmp/manifest.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1])).get('sha256',''))
PY
)
  remote_version=$(/usr/bin/python3 - "$tmp/manifest.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1])).get('version',''))
PY
)
  local_version=""
  [[ -f "$APP_SUPPORT/version.txt" ]] && local_version=$(cat "$APP_SUPPORT/version.txt")
  [[ -n "$remote_sha" && -n "$remote_version" ]] || return 0
  [[ "$remote_version" != "$local_version" ]] || return 0
  /usr/bin/curl -fL --max-time 300 "$payload_url" -o "$tmp/app.zip" || return 0
  local actual_sha
  actual_sha=$(/usr/bin/shasum -a 256 "$tmp/app.zip" | /usr/bin/awk '{print $1}')
  [[ "$actual_sha" == "$remote_sha" ]] || { echo "Update SHA mismatch"; return 0; }
  mkdir -p "$tmp/unpacked"
  /usr/bin/ditto -x -k "$tmp/app.zip" "$tmp/unpacked"
  local newdir="$APP_SUPPORT/app/new"
  local olddir="$APP_SUPPORT/app/previous"
  rm -rf "$newdir" "$olddir"
  mkdir -p "$newdir"
  /usr/bin/ditto "$tmp/unpacked" "$newdir"
  [[ -d "$CURRENT_DIR" ]] && mv "$CURRENT_DIR" "$olddir"
  mv "$newdir" "$CURRENT_DIR"
  printf '%s' "$remote_version" > "$APP_SUPPORT/version.txt"
  rm -rf "$olddir" "$tmp"
  echo "Updated to $remote_version"
}

wait_ready() {
  local i
  for i in $(seq 1 120); do
    if /usr/bin/curl -fsS --max-time 2 "$APP_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_server() {
  local node="$RUNTIME_DIR/node"
  local vite="$CURRENT_DIR/node_modules/vite/bin/vite.js"
  [[ -x "$node" ]] || { notify_error "Runtime Node embarqué introuvable."; exit 1; }
  [[ -f "$vite" ]] || { notify_error "Runtime Vite embarqué introuvable."; exit 1; }
  cd "$CURRENT_DIR"
  export DP_TEST_EXPORT=false
  export DP_TEST_FAST=false
  export DP_MAX_RETRIES=5
  export NODE_ENV=development
  export OPENAI_API_KEY="$(sed -n 's/^OPENAI_API_KEY=//p' "$APP_SUPPORT/.dev.vars" | head -n 1)"
  "$node" "$vite" --host 127.0.0.1 --port 5173 --strictPort >>"$LOG_FILE" 2>&1 &
  echo $! > "$APP_SUPPORT/pilotpaper.pid"
}

ensure_openai_key
install_baseline_if_needed
try_update || true

if ! /usr/bin/curl -fsS --max-time 2 "$APP_URL" >/dev/null 2>&1; then
  start_server
fi

if wait_ready; then
  /usr/bin/open "$APP_URL"
else
  notify_error "PilotPaper n'a pas démarré dans les deux minutes. Journal : $LOG_FILE"
  exit 1
fi
