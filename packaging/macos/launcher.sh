#!/bin/sh
# Abre o servidor numa janela do Terminal (logs visíveis; Ctrl+C ou fechar encerra).
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

if curl -fsS --max-time 1 "$URL/api/capabilities" >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

open -a Terminal "$RES/run-server.command"
