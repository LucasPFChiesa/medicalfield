#!/usr/bin/env bash
# Instala ou atualiza o MedicalField na VM (Ubuntu). Pode ser executado de novo
# a cada atualização do código. Precisa de sudo.
# Pré-requisitos: código em /opt/medicalfield, arquivo /opt/medicalfield/.env
# e banco criado com banco/criar_banco.sh (ver docs/implantacao.md).
set -euo pipefail

raiz=/opt/medicalfield
cd "$raiz"

echo "== Variáveis de ambiente (/etc/medicalfield/medicalfield.env)"
# Os serviços rodam com o usuário univates: a política da VM não permite
# criar usuários de sistema. O arquivo só é legível por esse usuário e pelo root.
sudo install -d -m 750 -o root -g univates /etc/medicalfield
sudo install -m 640 -o root -g univates "$raiz/.env" /etc/medicalfield/medicalfield.env

echo "== API 3 (Node): dependências"
(cd servicos/api3-atendimentos-node && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

echo "== API 1 (Python): dependências"
(cd servicos/api1-autenticacao-python && { test -d .venv || python3 -m venv .venv; } && .venv/bin/pip install -q -r requirements.txt)

echo "== API 2 (Go): compilação"
(cd servicos/api2-prontuarios-go && go build -o api2 .)

echo "== Serviços systemd"
# Serviços com os nomes antigos (antes da reorganização das APIs) são desligados e removidos.
for antigo in cadastros atendimentos sync; do
    if [[ -f /etc/systemd/system/medicalfield-$antigo.service ]]; then
        sudo systemctl disable --now --quiet "medicalfield-$antigo" || true
        sudo rm -f "/etc/systemd/system/medicalfield-$antigo.service"
    fi
done
sudo cp implantacao/systemd/medicalfield-api*.service /etc/systemd/system/
sudo systemctl daemon-reload
for servico in api3 api1 api2; do
    sudo systemctl enable --quiet "medicalfield-$servico"
    sudo systemctl restart "medicalfield-$servico"
done

echo "== Nginx"
# O arquivo publicado é o modelo + o que o certbot acrescentou; só é
# substituído se ainda não existir, para não apagar a configuração HTTPS.
if [[ ! -f /etc/nginx/sites-available/medicalfield ]]; then
    sudo cp implantacao/nginx-medicalfield.conf /etc/nginx/sites-available/medicalfield
fi
sudo install -m 644 implantacao/nginx-cors.conf /etc/nginx/snippets/medicalfield-cors.conf
sudo ln -sf /etc/nginx/sites-available/medicalfield /etc/nginx/sites-enabled/medicalfield
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

sleep 2
systemctl --no-pager --lines=0 status medicalfield-api1 medicalfield-api2 medicalfield-api3 | grep -E '●|Active:'
