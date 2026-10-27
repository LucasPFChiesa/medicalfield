# Implantação no Ubuntu Server (VM Univates)

## Ambiente

| Item | Valor |
|---|---|
| VM | `univates@177.44.248.50`, Ubuntu 26.04 LTS, 1 vCPU, 1,6 GB RAM, acesso por chave SSH |
| Domínio | `medicalfield.duckdns.org` (DuckDNS, aponta para o IP fixo da VM) |
| Firewall | ufw libera 22, 80 e 443. Os serviços escutam só em `127.0.0.1` |
| Diretório | `/opt/medicalfield` |
| Variáveis | `/etc/medicalfield/medicalfield.env` (cópia do `.env`, permissão 640 `root:univates`) |

Antes da instalação, a VM foi inspecionada: só tinha serviços de base do sistema (ssh, fail2ban, auditd, cron) e nenhuma aplicação web. Nada foi removido.

## 1. Pacotes

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm golang-go postgresql nginx certbot python3-certbot-nginx python3-venv python3-pip
```

As versões instaladas foram Node 22.22, Go 1.26, PostgreSQL 18.6, Nginx 1.28, Python 3.14 e certbot 4.0.

## 2. Código e configuração

Da máquina de desenvolvimento:

```bash
rsync -az --exclude node_modules --exclude .venv --exclude testes/node_modules ./ univates@177.44.248.50:/opt/medicalfield/
```

O arquivo `.env` (com senhas) é enviado junto, mas não fica no git. Na VM, ele tem permissão `600`.

## 3. Banco de dados

```bash
sudo -u postgres createuser --superuser univates   # uma vez: permite rodar os scripts sem sudo
cd /opt/medicalfield
banco/criar_banco.sh                               # banco medicalfield + usuários dos serviços + dados fictícios
banco/criar_banco.sh medicalfield_teste            # banco usado pelos testes automáticos
```

O PostgreSQL só aceita conexões locais (configuração padrão). Cada serviço usa o próprio usuário (`mf_api3`, `mf_api1`, `mf_api2`) com senha.

## 4. Serviços e Nginx

```bash
/opt/medicalfield/implantacao/instalar.sh
```

O script [instalar.sh](../implantacao/instalar.sh) pode ser executado de novo a cada atualização. Ele:
1. copia o `.env` para `/etc/medicalfield/medicalfield.env`;
2. instala as dependências (`npm ci`, venv do Python com `pip`) e compila o Go (`go build`);
3. copia as unidades [systemd](../implantacao/systemd/) e reinicia os serviços;
4. publica o [site do Nginx](../implantacao/nginx-medicalfield.conf) na primeira vez e recarrega o Nginx.

**Usuário dos serviços:** a política da VM bloqueia `useradd`/`adduser` no sudo. Por isso os serviços rodam como `univates`. As unidades usam `NoNewPrivileges=true`, `ProtectSystem=full` e `PrivateTmp=true`.

| Unidade | Executa | Porta |
|---|---|---|
| `medicalfield-api3` | `node src/servidor.js` | 127.0.0.1:3001 |
| `medicalfield-api1` | `.venv/bin/uvicorn app.main:app` | 127.0.0.1:8001 |
| `medicalfield-api2` | binário `api2` | 127.0.0.1:8002 |

## 5. HTTPS

O Service Worker e o `crypto.subtle` (login offline) só funcionam em contexto seguro, por isso o HTTPS é obrigatório.

```bash
sudo certbot --nginx -d medicalfield.duckdns.org --non-interactive --agree-tos \
     --register-unsafely-without-email --redirect
```

O certbot acrescenta o bloco da porta 443 e o redirecionamento de HTTP para HTTPS no site do Nginx. A renovação automática fica no `certbot.timer`.

## 6. Notebook do socorrista (máquina local)

O app do socorrista roda no notebook, separado da VM. Pré-requisitos: Python 3 e o Chrome (ou Edge, ou Firefox).

```bash
git clone <repositório> && cd <pasta do projeto>
./iniciar-local.sh    # liga o app, abre o navegador; deixe o terminal aberto
```

O navegador abre em `http://localhost:8080/socorrista/`. Entre **uma vez com internet**. Esse primeiro acesso:
- guarda os arquivos do app (Service Worker);
- guarda a credencial para o login offline;
- baixa os dados da VM.

Depois disso o app funciona sem rede. Se quiser, instale como aplicativo pelo ícone "Instalar" da barra de endereço do Chrome.

O endereço da plataforma central está em `web/socorrista/config.js`. Na VM, o Nginx libera as chamadas vindas de `localhost` com o arquivo `nginx-cors.conf`, instalado em `/etc/nginx/snippets/medicalfield-cors.conf` pelo `instalar.sh`.

## Operação

```bash
systemctl status medicalfield-api3 medicalfield-api1 medicalfield-api2
journalctl -u medicalfield-api2 -f               # logs de acesso em tempo real
sudo systemctl restart medicalfield-api1
sudo nginx -t && sudo systemctl reload nginx
```

## Atualizar o sistema

Do seu computador, na pasta do projeto:

```bash
./iniciar-vm.sh
```

Ele envia o código (`rsync`), roda o `instalar.sh` na VM e confere as rotas principais pela internet. O banco de dados não é apagado.

Se algum arquivo do app do socorrista mudar, aumente a versão em `CACHE` no [sw.js](../web/socorrista/sw.js). Assim os navegadores trocam a cópia guardada para uso offline.
