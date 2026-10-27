#!/usr/bin/env bash
# Cria o banco, os usuários das APIs e os dados de demonstração.
# Uso: banco/criar_banco.sh [--recriar | --permissoes] [nome_do_banco]
#   (sem opção)   cria um banco novo
#   --recriar     apaga e cria de novo (volta aos dados de exemplo)
#   --permissoes  só reaplica as permissões, sem apagar nenhum dado
#   nome padrão: medicalfield (os testes automáticos usam medicalfield_teste)
# Lê as senhas do arquivo indicado em ARQUIVO_ENV (padrão: .env na raiz).
# Precisa ser executado por um usuário com permissão de administrador no PostgreSQL.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "${ARQUIVO_ENV:-$raiz/.env}"
set +a

modo="${1:-}"
if [[ "$modo" == "--recriar" || "$modo" == "--permissoes" ]]; then
    shift
fi
banco="${1:-medicalfield}"

psql_admin=(psql -v ON_ERROR_STOP=1 -q -d postgres)
psql_mf=(psql -v ON_ERROR_STOP=1 -q -d "$banco")

aplicar_permissoes() {
    "${psql_mf[@]}" -f "$raiz/banco/002_permissoes.sql" \
        -v nome_banco="$banco" \
        -v senha_api1="$DB_SENHA_API1" \
        -v senha_api2="$DB_SENHA_API2" \
        -v senha_api3="$DB_SENHA_API3"
}

if [[ "$modo" == "--permissoes" ]]; then
    aplicar_permissoes
    echo "Permissões do banco $banco atualizadas."
    exit 0
fi

if [[ "$modo" == "--recriar" ]]; then
    echo "Removendo o banco $banco..."
    "${psql_admin[@]}" -c "DROP DATABASE IF EXISTS \"$banco\" WITH (FORCE)"
fi

"${psql_admin[@]}" -c "CREATE DATABASE \"$banco\""
"${psql_mf[@]}" -f "$raiz/banco/001_schema.sql"
aplicar_permissoes
"${psql_mf[@]}" -f "$raiz/banco/003_seed.sql" -v senha_demo="$SENHA_DEMO"

echo "Banco $banco criado."
