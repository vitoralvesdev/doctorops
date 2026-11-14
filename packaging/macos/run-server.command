#!/bin/sh
# Executado pelo Terminal dentro do .app. Feche a janela (ou Ctrl+C) para parar.
RES="$(cd "$(dirname "$0")" && pwd)"

case "$(uname -m)" in
  arm64) NODE="$RES/runtime/node-arm64" ;;
  *) NODE="$RES/runtime/node-x64" ;;
esac

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

(
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -fsS --max-time 1 "$URL/api/capabilities" >/dev/null 2>&1; then
      open "$URL"
      break
    fi
    sleep 0.25
    i=$((i + 1))
  done
) &

cd "$RES"
echo "DoctorOps - porta $PORT. Feche esta janela ou use Ctrl+C para parar."
TX_PACKAGED=1 exec "$NODE" "$RES/app/dist/server.js"
