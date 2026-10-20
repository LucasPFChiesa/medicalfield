#!/usr/bin/env bash
# Liga o app do socorrista neste computador e abre o navegador.
# Uso: ./iniciar-socorrista.sh        (Ctrl+C para desligar)
#
# - O app e os dados dele ficam aqui (IndexedDB do navegador).
# - A plataforma central fica na VM e está sempre ligada; o app só fala com ela
#   para sincronizar.
# - "localhost" é um endereço seguro para o navegador, então o modo offline
#   (Service Worker) funciona sem HTTPS e sem túnel.
set -euo pipefail

PORTA=8080
ENDERECO="http://localhost:$PORTA/socorrista/"
VM="https://medicalfield.duckdns.org"

cd "$(dirname "$0")/web"

echo "== Conferindo a plataforma central ($VM)"
if curl -fs -o /dev/null --max-time 5 "$VM/api/ping"; then
    echo "   VM respondendo: a sincronização vai funcionar."
else
    echo "   VM fora do alcance agora: o app abre e funciona offline, sincroniza quando a conexão voltar."
fi

if curl -fs -o /dev/null --max-time 2 "$ENDERECO"; then
    echo "== O app já estava ligado nesta máquina."
    xdg-open "$ENDERECO" >/dev/null 2>&1 &
    exit 0
fi

echo "== Ligando o app do socorrista em $ENDERECO"
python3 -m http.server "$PORTA" --bind 127.0.0.1 >/dev/null 2>&1 &
servidor=$!
trap 'kill $servidor 2>/dev/null; echo; echo "App do socorrista desligado."' EXIT

for _ in $(seq 20); do
    curl -fs -o /dev/null "$ENDERECO" && break
    sleep 0.3
done

xdg-open "$ENDERECO" >/dev/null 2>&1 || echo "   Abra no navegador: $ENDERECO"
echo "== Pronto. Login de demonstração: CRM / admin / admin"
echo "   Deixe este terminal aberto. Ctrl+C para desligar."
wait $servidor
