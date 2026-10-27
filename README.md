# MedicalField – Prontuário Médico de Emergência

Trabalho final da disciplina **Arquiteturas de Software** (Univates, 2026/B, prof. Fabrício).

Sistema *offline-first* para equipes de atendimento pré-hospitalar. O socorrista registra pacientes, prontuários e atendimentos (sinais vitais, Glasgow, Manchester, START e medicamentos administrados) mesmo sem internet. Quando a conexão volta, os registros são sincronizados com o servidor central.

O sistema roda em duas máquinas:

- **VM da Univates (plataforma central):** **https://medicalfield.duckdns.org**
  - Portal administrativo: `/portal/`
  - Documentação das APIs (Swagger): `/docs/`
- **Notebook do socorrista (app de campo):** rode `./iniciar-local.sh` na pasta do projeto. Ele liga o app e abre o navegador em **http://localhost:8080/socorrista/**. Os dados ficam no notebook e vão para a VM na sincronização.

## Os dois comandos

Os dois são executados no seu computador, na pasta do projeto:

| Comando | Para que serve |
|---|---|
| `./iniciar-local.sh` | Liga o **app do socorrista** neste computador e abre o navegador. Deixe o terminal aberto; Ctrl+C desliga |
| `./iniciar-vm.sh` | **Atualiza a VM**: envia o código, reinstala e reinicia os serviços e confere se tudo responde. Só é preciso depois de mudar o código, porque na VM os serviços já sobem sozinhos |

## Visão geral

| Parte | Tecnologia | Responsabilidade |
|---|---|---|
| App do socorrista | HTML, CSS, JavaScript, Service Worker, IndexedDB | Operação offline, fila de envio, simulador de conectividade |
| Portal administrativo | HTML, CSS, JavaScript | Consulta e CRUD dos dados centrais, auditoria |
| API 1 – Autenticação, logs e documentos | Python + FastAPI | Login (JWT), profissionais, logs e auditoria, ficha em PDF, envio por e-mail |
| API 2 – Prontuários | Go (biblioteca padrão + pgx) | Prontuários e sincronização do app (push/pull, idempotência, conflitos) |
| API 3 – Pessoas, medicamentos e atendimentos | Node.js + Express | Pessoas, catálogo de medicamentos e atendimentos |
| Banco central | PostgreSQL 18 | Dados consolidados e auditoria |
| Servidor | Ubuntu 26.04 (VM Univates), Nginx, systemd, Let's Encrypt | Hospedagem, HTTPS e proxy reverso |

Detalhes em [docs/arquitetura.md](docs/arquitetura.md).

## Estrutura de pastas

```
banco/                  scripts SQL (estrutura, permissões, dados fictícios) e criar_banco.sh
servicos/
  api1-autenticacao-python/ API 1, Python: autenticação, logs, PDF e e-mail (app/, tests/)
  api2-prontuarios-go/      API 2, Go: prontuários e sincronização (*.go, *_test.go, openapi.json)
  api3-atendimentos-node/   API 3, Node.js: pessoas, medicamentos e atendimentos (src/, test/, openapi.json)
web/
  comum/                CSS e módulos JS usados pelo portal e pelo app
  portal/               portal administrativo
  socorrista/           app do socorrista (PWA)
  docs/                 Swagger UI das três APIs
implantacao/            systemd, Nginx e script de instalação na VM
testes/                 integração dos serviços, roteiro de 17 passos no navegador (Playwright)
postman/                coleção com todas as rotas
docs/                   documentação do projeto
```

## Documentação

- [Arquitetura e decisões](docs/arquitetura.md)
- [Modelo de dados](docs/banco.md)
- [APIs](docs/api.md) (e Swagger em `/docs/`)
- [Offline-first e sincronização](docs/sincronizacao.md)
- [Os seis padrões de projeto](docs/padroes.md)
- [Roteiro dos 17 testes](docs/roteiro-17-passos.md)
- [Testes automatizados](docs/testes.md)
- [Implantação no Ubuntu Server](docs/implantacao.md)
- [Roteiro de apresentação](docs/apresentacao.md)

## Configuração

Todas as senhas e segredos ficam no arquivo `.env`, que não vai para o git. Copie o modelo e preencha os campos:

```bash
cp .env.exemplo .env
```

| Variável | Uso |

|---|---|
| `DB_SENHA_API3`, `DB_SENHA_API1`, `DB_SENHA_API2` | Senha do usuário de banco de cada serviço |
| `SENHA_DEMO` | Senha dos profissionais fictícios criados pelo `003_seed.sql` |
| `JWT_SEGREDO` | Segredo compartilhado para assinar e validar os tokens |
| `SMTP_HOST`, `SMTP_PORTA`, `SMTP_USUARIO`, `SMTP_SENHA`, `SMTP_REMETENTE` | Envio da ficha por e-mail (no Gmail, use uma senha de app) |

### Usuários de demonstração

**Acesso principal: tipo CRM, número `admin`, senha `admin`.** Funciona no portal e no app do socorrista; o tipo CRM já vem selecionado nas duas telas.

Os demais profissionais fictícios também usam a senha `admin` (valor de `SENHA_DEMO` no `.env`).

| Profissional | Tipo | Número | Perfil |
|---|---|---|---|
| Helena Vasconcelos | CRM | admin | admin |
| Rafael Kunzler | CRM | 20002-RS | médico |
| Juliana Schmitt | COREN | 300003-RS | enfermeiro |
| Marcos Dalpiaz | SOCORRISTA | SOC-0042 | socorrista |

## Executar localmente

Pré-requisitos: Node.js 22, Python 3.12 ou superior, Go 1.25 ou superior e PostgreSQL. É preciso ter um usuário administrador do PostgreSQL com o mesmo nome do usuário do sistema (`sudo -u postgres createuser --superuser $USER`).

```bash
banco/criar_banco.sh                       # cria o banco medicalfield com dados fictícios
set -a; source .env; set +a

(cd servicos/api3-atendimentos-node && npm install && npm start) &
(cd servicos/api1-autenticacao-python && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt \
   && .venv/bin/uvicorn app.main:app --port 8001) &
(cd servicos/api2-prontuarios-go && go run .) &
```

No navegador, as rotas `/api/...` precisam passar pelo Nginx, que direciona cada caminho ao serviço certo (ver [implantacao/nginx-medicalfield.conf](implantacao/nginx-medicalfield.conf)). Para desenvolvimento local, use a mesma configuração apontando `root` para a pasta `web/`.

## Testes

```bash
testes/rodar_testes.sh                     # unitários dos 3 serviços + integração entre eles
cd testes && npm install && npx playwright test   # roteiro de 17 passos no Chrome
```

Os resultados da última execução estão em [docs/testes.md](docs/testes.md).
