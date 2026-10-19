#!/usr/bin/env bash
# Cria o banco, os usuários dos serviços e os dados de demonstração.
# Uso: banco/criar_banco.sh [--recriar] [nome_do_banco]
#   nome padrão: medicalfield (os testes automáticos usam medicalfield_teste)
# Lê as senhas do arquivo indicado em ARQUIVO_ENV (padrão: .env na raiz).
# Precisa ser executado por um usuário com permissão de administrador no PostgreSQL.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "${ARQUIVO_ENV:-$raiz/.env}"
set +a

recriar=false
if [[ "${1:-}" == "--recriar" ]]; then
    recriar=true
    shift
fi
banco="${1:-medicalfield}"

psql_admin=(psql -v ON_ERROR_STOP=1 -q -d postgres)

if $recriar; then
    echo "Removendo o banco $banco..."
    "${psql_admin[@]}" -c "DROP DATABASE IF EXISTS \"$banco\" WITH (FORCE)"
fi

"${psql_admin[@]}" -c "CREATE DATABASE \"$banco\""

psql_mf=(psql -v ON_ERROR_STOP=1 -q -d "$banco")
"${psql_mf[@]}" -f "$raiz/banco/001_schema.sql"
"${psql_mf[@]}" -f "$raiz/banco/002_permissoes.sql" \
    -v nome_banco="$banco" \
    -v senha_cadastros="$DB_SENHA_CADASTROS" \
    -v senha_atendimentos="$DB_SENHA_ATENDIMENTOS" \
    -v senha_sync="$DB_SENHA_SYNC"
"${psql_mf[@]}" -f "$raiz/banco/003_seed.sql" -v senha_demo="$SENHA_DEMO"

echo "Banco $banco criado."
