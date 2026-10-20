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

echo "== Dependências do serviço Node"
(cd servicos/cadastros-node && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

echo "== Dependências do serviço Python"
(cd servicos/atendimentos-python && { test -d .venv || python3 -m venv .venv; } && .venv/bin/pip install -q -r requirements.txt)

echo "== Compilação do serviço Go"
(cd servicos/sync-go && go build -o sync-go .)

echo "== Serviços systemd"
sudo cp implantacao/systemd/medicalfield-*.service /etc/systemd/system/
sudo systemctl daemon-reload
for servico in cadastros atendimentos sync; do
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
systemctl --no-pager --lines=0 status medicalfield-cadastros medicalfield-atendimentos medicalfield-sync | grep -E '●|Active:'
