#!/usr/bin/env bash
# Executa todos os testes automáticos usando o banco medicalfield_teste.
# Os serviços de produção não são afetados: os de teste sobem em outras portas.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "${ARQUIVO_ENV:-$raiz/.env}"
set +a
export DB_NOME=medicalfield_teste

echo "== Recriando o banco de testes"
"$raiz/banco/criar_banco.sh" --recriar medicalfield_teste >/dev/null

echo "== Cadastros (Node)"
(cd "$raiz/servicos/cadastros-node" && node --test test/*.test.js 2>&1 | grep -E '^(not )?ok|^# (pass|fail)')

echo "== Atendimentos (Python)"
(cd "$raiz/servicos/atendimentos-python" && .venv/bin/pytest -q -p no:warnings)

echo "== Sincronização (Go)"
(cd "$raiz/servicos/sync-go" && go test -v ./... 2>&1 | grep -E '^(--- |ok|FAIL)')

echo "== Integração entre os três serviços"
"$raiz/banco/criar_banco.sh" --recriar medicalfield_teste >/dev/null
export PORTA_CADASTROS=13001 PORTA_SYNC=18002
export URL_CADASTROS=http://127.0.0.1:13001 URL_ATENDIMENTOS=http://127.0.0.1:18001 URL_SYNC=http://127.0.0.1:18002
logs="$(mktemp -d)"
(cd "$raiz/servicos/cadastros-node" && node src/servidor.js >"$logs/cadastros.log" 2>&1) &
(cd "$raiz/servicos/atendimentos-python" && .venv/bin/uvicorn app.main:app --port 18001 >"$logs/atendimentos.log" 2>&1) &
(cd "$raiz/servicos/sync-go" && go run . >"$logs/sync.log" 2>&1) &
trap 'pkill -P $$ || true; fuser -k 13001/tcp 18001/tcp 18002/tcp >/dev/null 2>&1 || true' EXIT

for porta in 13001 18001 18002; do
    for _ in $(seq 60); do
        curl -s -o /dev/null "http://127.0.0.1:$porta/" && break
        sleep 0.5
    done
done
node --test "$raiz/testes/integracao.test.js" 2>&1 | grep -E '^(not )?ok|^# (pass|fail)|^\s+(error|expected|actual):'
echo "Logs dos serviços de teste em $logs"
