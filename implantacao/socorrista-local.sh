#!/usr/bin/env bash
# Liga o app do socorrista no notebook: http://localhost:8080/socorrista/
# Os arquivos do app e os dados ficam neste computador (IndexedDB do navegador).
# Só a sincronização fala com a plataforma central na VM (https://medicalfield.duckdns.org).
# "localhost" é tratado como endereço seguro pelo navegador, por isso o modo
# offline (Service Worker) funciona sem HTTPS e sem túnel.
set -euo pipefail

cd "$(dirname "$0")/../web"
echo "App do socorrista: http://localhost:8080/socorrista/  (Ctrl+C para parar)"
python3 -m http.server 8080 --bind 127.0.0.1
