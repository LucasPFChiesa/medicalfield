#!/usr/bin/env bash
# Liga ou atualiza a plataforma central na VM da Univates.
# Uso (no seu computador, na pasta do projeto): ./iniciar-vm.sh
#
# 1. Envia o código desta pasta para /opt/medicalfield na VM.
# 2. Roda implantacao/instalar.sh lá: dependências, compilação do Go,
#    reinício das 3 APIs (systemd: medicalfield-api1, api2, api3) e recarga do Nginx.
# 3. Confere se o portal e as APIs respondem pela internet.
#
# O banco de dados NÃO é apagado. Para voltar aos dados de exemplo, rode na
# VM: cd /opt/medicalfield && banco/criar_banco.sh --recriar
#
# Os serviços já sobem sozinhos quando a VM liga; este comando só é preciso
# depois de mudar o código.
set -euo pipefail

VM_SSH="univates@177.44.248.50"
VM_URL="https://medicalfield.duckdns.org"

cd "$(dirname "$0")"

echo "== 1/3 Enviando o código para a VM"
rsync -az \
    --exclude .git --exclude node_modules --exclude .venv \
    --exclude test-results --exclude playwright-report \
    --exclude servicos/api2-prontuarios-go/api2 \
    ./ "$VM_SSH:/opt/medicalfield/"

echo "== 2/3 Instalando e reiniciando os serviços"
ssh "$VM_SSH" /opt/medicalfield/implantacao/instalar.sh

echo "== 3/3 Conferindo pela internet"
sleep 2
for rota in /portal/ /api/ping /api/openapi/api1.json /api/openapi/api2.json /api/openapi/api3.json; do
    status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$VM_URL$rota")
    echo "   $status  $rota"
done
echo "Portal: $VM_URL/portal/   (login CRM / admin / admin)"
