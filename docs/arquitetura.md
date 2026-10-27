# Arquitetura

## Desenho

```
   NOTEBOOK DO SOCORRISTA (máquina local)        QUALQUER COMPUTADOR
   ┌───────────────────────────────────────┐     ┌──────────────────────────────┐
   │ App do socorrista (PWA)               │     │ Portal administrativo        │
   │ http://localhost:8080/socorrista/     │     │ https://.../portal/          │
   │ ligar: ./iniciar-local.sh             │     │ somente online               │
   │ Service Worker  → arquivos offline    │     │                              │
   │ IndexedDB       → dados + fila outbox │     │                              │
   │ Simulador ONLINE/OFFLINE              │     │                              │
   └──────────────────┬────────────────────┘     └──────────────┬───────────────┘
                      │ só na sincronização                     │
                      └──────────── HTTPS (internet) ───────────┘
                                         │
   VM DA UNIVATES (plataforma central)   │
                ┌────────────────────────▼─────────────────────────┐
                │ Nginx (VM Univates) – arquivos estáticos (web/)  │
                │ e proxy reverso por caminho da URL               │
                └───┬──────────────────────┬──────────────────┬────┘
   /api/auth, /log, /email,      /api/prontuario,     /api/pessoa,
   /documento, /profissional,    /api/sync            /api/medicamento,
   /auditoria                              │          /api/atendimento
                    ▼                      ▼                     ▼
       ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
       │ API 1                │ │ API 2                │ │ API 3                │
       │ Python + FastAPI     │ │ Go                   │ │ Node.js + Express    │
       │ 127.0.0.1:8001       │ │ 127.0.0.1:8002       │ │ 127.0.0.1:3001       │
       │ login e emissão JWT  │ │ prontuários          │ │ pessoas              │
       │ profissionais        │ │ sync push / pull     │ │ medicamentos         │
       │ logs e auditoria     │ │ idempotência         │ │ atendimentos (sinais │
       │ ficha PDF, e-mail    │ │ conflitos (Strategy) │ │ vitais, Glasgow...)  │
       └──────────┬───────────┘ └───┬──────────────┬───┘ └──────────┬───────────┘
                  │                 │  HTTP PUT    ▲                │
                  │                 └──────────────┼────────────────┘
                  │        (a API 2 grava pessoa e atendimento pela API 3)
                  ▼                        ▼                        ▼
              ┌──────────────────────────────────────────────────────────────┐
              │ PostgreSQL – banco medicalfield                              │
              │ um usuário por API: mf_api1, mf_api2, mf_api3, cada um com   │
              │ permissão de escrita só nas tabelas que são suas             │
              └──────────────────────────────────────────────────────────────┘
```

As três APIs rodam diretamente no Ubuntu, gerenciadas pelo **systemd** (`medicalfield-api1`, `medicalfield-api2`, `medicalfield-api3`). Não há contêineres, e só o Nginx fica exposto à internet (portas 80 e 443).

## Duas máquinas

O sistema é dividido em duas partes, que rodam em computadores diferentes:

| Onde | O que roda | Como |
|---|---|---|
| **Notebook do socorrista** | Só o app do socorrista: arquivos do app (HTML, CSS, JS) e dados locais | `iniciar-local.sh` liga um servidor local simples (`python3 -m http.server`) em `http://localhost:8080`. Os dados ficam no IndexedDB do navegador do notebook |
| **VM da Univates** | Plataforma central: portal, as três APIs, PostgreSQL e Nginx | systemd + Nginx com HTTPS em `https://medicalfield.duckdns.org` |

- O app do notebook **não depende da VM para funcionar**: abre, faz login offline e grava tudo localmente.
- Ele só fala com a VM na **sincronização**: envia a fila (push) e baixa as novidades (pull) pela API em HTTPS. O endereço da VM fica em [web/socorrista/config.js](../web/socorrista/config.js).
- **Por que `localhost`:** o navegador só libera Service Worker e criptografia (`crypto.subtle`) em endereços seguros, que são HTTPS ou `localhost`. Por isso o app no notebook funciona sem certificado e sem túnel.
- **CORS:** como o app (`http://localhost:8080`) e a API (`https://medicalfield.duckdns.org`) têm endereços diferentes, o navegador só permite as chamadas se a VM autorizar. O Nginx autoriza apenas origens `localhost`/`127.0.0.1` ([implantacao/nginx-cors.conf](../implantacao/nginx-cors.conf)).
- A VM também continua servindo uma cópia do app em `/socorrista/`, útil como reserva se o notebook não tiver o projeto.

## Tecnologias

| Camada | Escolha | Motivo |
|---|---|---|
| Frontend | HTML, CSS e JavaScript puro (módulos ES) | O foco do trabalho não é a interface; sem build, fácil de explicar |
| Offline | Service Worker + IndexedDB | São os recursos nativos do navegador para app offline e banco local |
| API 1 | Python 3.14 + FastAPI | Validação declarativa (Pydantic), Swagger automático, bcrypt/JWT e boas bibliotecas de PDF (fpdf2) e e-mail (`smtplib`) |
| API 2 | Go 1.26 (`net/http`) | Bom para a sincronização, que processa lotes e chama outra API; gera um único executável |
| API 3 | Node.js 22 + Express 5 | Mesma linguagem do frontend, ótimo para os CRUDs de pessoas, medicamentos e atendimentos |
| Banco | PostgreSQL 18 | Relacional, com transações, triggers, `jsonb` e controle de permissões por usuário |
| Autenticação | JWT (HS256) | Cada API valida o token sozinha, sem consultar a API de login |
| Servidor | Nginx + systemd + Let's Encrypt | HTTPS é obrigatório para o Service Worker funcionar |
| Documentação | OpenAPI 3 + Swagger UI, Postman | Exigência do trabalho |
| Testes | `node:test`, pytest, `go test`, Playwright | Ferramenta padrão de cada linguagem e um navegador real para o offline |

## Por que três APIs e essa divisão

A divisão segue a organização definida pelo professor, e cada API é **dona** dos dados do seu assunto:

1. **API 1 – Autenticação, logs e documentos (Python):** login e emissão do token, profissionais, registro e consulta dos logs, ficha em PDF e envio por e-mail. É a única que lê `senha_hash`.
2. **API 2 – Prontuários e sincronização (Go):** cadastro e consulta de prontuários. Também recebe a fila do app (push), garante que cada operação seja aplicada uma única vez, decide os conflitos e devolve as novidades (pull).
3. **API 3 – Pessoas, medicamentos e atendimentos (Node):** cadastro de pessoas, catálogo de medicamentos e o registro clínico do atendimento, com os medicamentos administrados.

### Propriedade dos dados

| Tabela | Quem grava | Quem só lê |
|---|---|---|
| profissional | API 1 | API 2 e API 3 (sem `senha_hash`) |
| prontuario | API 2 | API 1 (ficha) e API 3 (confere o prontuário do atendimento) |
| sync_operacao | API 2 | – |
| paciente, medicamento, atendimento, medicamento_administrado | API 3 | API 1 (ficha) e API 2 (pull) |
| log_acesso | cada API insere as próprias linhas | API 1 (tela de auditoria) |

Essa regra é garantida **pelo banco**, não só pelo código ([banco/002_permissoes.sql](../banco/002_permissoes.sql)). O usuário `mf_api2` não tem permissão de `INSERT` em `paciente`. Por isso a API 2 é obrigada a chamar a API 3 para gravar uma pessoa vinda do app.

## Como as APIs se comunicam

- **Navegador → APIs:** sempre por HTTPS através do Nginx, que escolhe a API pelo caminho da URL. O navegador enxerga um único endereço.
- **API 2 → API 3 (sincronização):** HTTP interno (`127.0.0.1`), com `PUT /api/pessoa/{id}` e `PUT /api/atendimento/{id}`. A API 2 repassa o **token do próprio profissional**. Assim a API 3 valida a permissão e registra no log quem fez a operação. O prontuário é da API 2 e é gravado por ela mesma.
- **API 1 → banco (documentos):** para montar a ficha em PDF, a API 1 lê o atendimento, a pessoa e o prontuário direto no banco, só com permissão de leitura.
- **Autenticação entre APIs:** não existe "token de serviço". As três conhecem o `JWT_SEGREDO` e validam a assinatura localmente.

## Autenticação

1. `POST /api/auth/login` recebe o tipo de registro (CRM, COREN ou SOCORRISTA), o número e a senha.
2. A API 1 compara a senha com o hash **bcrypt** e devolve um JWT válido por 8 horas, com `sub` (id do profissional), `nome` e `perfil`.
3. Todas as outras rotas exigem `Authorization: Bearer <token>`. Cada API tem um middleware que valida o token.
4. **Perfis de acesso:**
   - `admin`: faz tudo, inclusive excluir registros, cadastrar medicamentos e profissionais e ver a auditoria;
   - demais perfis: cadastram e editam pessoas, prontuários e atendimentos.
5. **Login offline** (app do socorrista):
   - no login online, o app guarda um hash **PBKDF2-SHA256** (210 mil iterações, sal aleatório) da senha;
   - sem rede, o app compara a senha digitada com esse hash;
   - a senha em si nunca é gravada;
   - só entra offline quem já entrou online naquele dispositivo.

## Auditoria (logs de acesso)

Cada API tem um middleware que registra, ao final de toda requisição:
- data e hora;
- API (`api1`, `api2`, `api3`);
- IP do cliente (repassado pelo Nginx);
- id do profissional;
- método;
- rota;
- status;
- duração em milissegundos.

| API | Onde está o middleware |
|---|---|
| API 3 (Node) | [src/log.js](../servicos/api3-atendimentos-node/src/log.js) |
| API 1 (Python) | [app/logs.py](../servicos/api1-autenticacao-python/app/logs.py) |
| API 2 (Go) | [logs.go](../servicos/api2-prontuarios-go/logs.go) |

Os registros vão para a tabela `log_acesso` e também para o journal do systemd. A query string não é registrada, para não guardar dados clínicos usados em buscas. Senhas e tokens também nunca entram no log.

O app grava localmente as operações feitas (inclusive logins offline) e envia esse histórico para a API 1, em `POST /api/log`, na sincronização (`origem = 'cliente'`).

## Decisões e limitações conhecidas

- **Sem contêineres:** o professor dispensou, e o systemd já cuida de iniciar, reiniciar e registrar logs.
- **Usuário dos serviços:** a política da VM não permite criar usuários (`useradd` bloqueado no sudo). Os serviços rodam como `univates`, com `NoNewPrivileges`, `ProtectSystem=full` e `PrivateTmp`.
- **A ficha PDF é gerada no servidor.** Um atendimento feito offline só gera PDF depois de sincronizado.
- **Cursor do pull:** dois registros gravados ao mesmo tempo podem ser confirmados fora da ordem da sequência. Um pull feito exatamente nesse instante pode pular um deles. Com o volume deste projeto isso é muito improvável. Uma solução completa usaria uma margem de segurança no cursor ou o log de transações do PostgreSQL.
- **O token fica no IndexedDB** do dispositivo, para permitir sincronizar depois de um login offline. Ele expira em 8 horas; depois disso, o app pede um novo login online antes de sincronizar.
