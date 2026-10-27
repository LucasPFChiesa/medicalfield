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

echo "== API 1 - autenticação, logs e documentos (Python)"
(cd "$raiz/servicos/api1-autenticacao-python" && .venv/bin/pytest -q -p no:warnings)

echo "== API 2 - prontuários e sincronização (Go)"
(cd "$raiz/servicos/api2-prontuarios-go" && go test -v ./... 2>&1 | grep -E '^(--- |ok|FAIL)')

echo "== API 3 - pessoas, medicamentos e atendimentos (Node)"
(cd "$raiz/servicos/api3-atendimentos-node" && node --test test/*.test.js 2>&1 | grep -E '^(not )?ok|^# (pass|fail)')

echo "== Integração entre as três APIs"
"$raiz/banco/criar_banco.sh" --recriar medicalfield_teste >/dev/null
export PORTA_API3=13001 PORTA_API2=18002
export URL_API1=http://127.0.0.1:18001 URL_API2=http://127.0.0.1:18002 URL_API3=http://127.0.0.1:13001
logs="$(mktemp -d)"
(cd "$raiz/servicos/api1-autenticacao-python" && .venv/bin/uvicorn app.main:app --port 18001 >"$logs/api1.log" 2>&1) &
(cd "$raiz/servicos/api2-prontuarios-go" && go run . >"$logs/api2.log" 2>&1) &
(cd "$raiz/servicos/api3-atendimentos-node" && node src/servidor.js >"$logs/api3.log" 2>&1) &
trap 'pkill -P $$ || true; fuser -k 13001/tcp 18001/tcp 18002/tcp >/dev/null 2>&1 || true' EXIT

for porta in 13001 18001 18002; do
    for _ in $(seq 60); do
        curl -s -o /dev/null "http://127.0.0.1:$porta/" && break
        sleep 0.5
    done
done
node --test "$raiz/testes/integracao.test.js" 2>&1 | grep -E '^(not )?ok|^# (pass|fail)|^\s+(error|expected|actual):'
echo "Logs das APIs de teste em $logs"
