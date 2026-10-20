# Arquitetura

## Desenho

```
   NOTEBOOK DO SOCORRISTA (máquina local)        QUALQUER COMPUTADOR
   ┌───────────────────────────────────────┐     ┌──────────────────────────────┐
   │ App do socorrista (PWA)               │     │ Portal administrativo        │
   │ http://localhost:8080/socorrista/     │     │ https://.../portal/          │
   │ ligar: ./iniciar-socorrista.sh        │     │ somente online               │
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
   /api/auth, /pessoa, /prontuario,   /api/atendimento     /api/sync, /api/log
   /medicamento, /profissional,            │                     │
   /auditoria                              │                     │
                    ▼                      ▼                     ▼
       ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
       │ cadastros            │ │ atendimentos         │ │ sincronização        │
       │ Node.js + Express    │ │ Python + FastAPI     │ │ Go                   │
       │ 127.0.0.1:3001       │ │ 127.0.0.1:8001       │ │ 127.0.0.1:8002       │
       │ login e emissão JWT  │ │ atendimentos         │ │ push (fila offline)  │
       │ pessoas, prontuários │ │ sinais vitais,       │ │ pull (cursor)        │
       │ medicamentos         │ │ Glasgow, triagem     │ │ idempotência         │
       │ profissionais        │ │ ficha PDF, e-mail    │ │ conflitos (Strategy) │
       │ consulta auditoria   │ │                      │ │ logs do app offline  │
       └──────────┬───────────┘ └──────────┬───────────┘ └───┬──────────────┬───┘
                  │       ▲                │      ▲          │ só leitura   │
                  │       └──── HTTP PUT ──┼──────┴──────────┘ (SELECT)     │
                  │          (o Go grava pela API do dono)                  │
                  ▼                        ▼                                ▼
              ┌──────────────────────────────────────────────────────────────┐
              │ PostgreSQL – banco medicalfield                              │
              │ um usuário por serviço: mf_cadastros, mf_atendimentos,       │
              │ mf_sync, cada um com permissão de escrita só no que é seu    │
              └──────────────────────────────────────────────────────────────┘
```

Os três serviços rodam diretamente no Ubuntu, gerenciados pelo **systemd**. Não há contêineres, e só o Nginx fica exposto à internet (portas 80 e 443).

## Duas máquinas

O sistema é dividido em duas partes, que rodam em computadores diferentes:

| Onde | O que roda | Como |
|---|---|---|
| **Notebook do socorrista** | Só o app do socorrista: arquivos do app (HTML, CSS, JS) e dados locais | `iniciar-socorrista.sh` liga um servidor local simples (`python3 -m http.server`) em `http://localhost:8080`. Os dados ficam no IndexedDB do navegador do notebook |
| **VM da Univates** | Plataforma central: portal, os três serviços, PostgreSQL e Nginx | systemd + Nginx com HTTPS em `https://medicalfield.duckdns.org` |

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
| Serviço 1 | Node.js 22 + Express 5 | Mesma linguagem do frontend, ótimo para API REST simples |
| Serviço 2 | Python 3.14 + FastAPI | Validação declarativa (Pydantic), Swagger automático e boas bibliotecas de PDF (fpdf2) e e-mail (`smtplib`) |
| Serviço 3 | Go 1.26 (`net/http`) | Bom para um serviço de "infraestrutura" que processa lotes e chama outros serviços; gera um único executável |
| Banco | PostgreSQL 18 | Relacional, com transações, triggers, `jsonb` e controle de permissões por usuário |
| Autenticação | JWT (HS256) | Cada serviço valida o token sozinho, sem consultar o serviço de login |
| Servidor | Nginx + systemd + Let's Encrypt | HTTPS é obrigatório para o Service Worker funcionar |
| Documentação | OpenAPI 3 + Swagger UI, Postman | Exigência do trabalho |
| Testes | `node:test`, pytest, `go test`, Playwright | Ferramenta padrão de cada linguagem e um navegador real para o offline |

## Por que três serviços e essa divisão

A divisão segue **quem é dono de cada dado**:

1. **Cadastros (Node)**: dados de apoio e identidade, que mudam pouco: profissionais, pessoas, prontuários e medicamentos. Também emite o token, porque é o único que lê `senha_hash`.
2. **Atendimentos (Python)**: o registro clínico do atendimento e tudo que deriva dele: medicamentos administrados, ficha PDF e e-mail.
3. **Sincronização (Go)**: não é dono de nenhum dado clínico. Recebe a fila do app, garante que cada operação seja aplicada uma única vez, decide os conflitos e encaminha a gravação ao dono.

### Propriedade dos dados

| Tabela | Quem grava | Quem só lê |
|---|---|---|
| profissional, paciente, prontuario, medicamento | cadastros | atendimentos, sync |
| atendimento, medicamento_administrado | atendimentos | sync |
| sync_operacao | sync | – |
| log_acesso | cada serviço insere as próprias linhas | cadastros (tela de auditoria) |

Essa regra é garantida **pelo banco**, não só pelo código ([banco/002_permissoes.sql](../banco/002_permissoes.sql)). O usuário `mf_sync` não tem permissão de `INSERT` em `paciente`. Por isso o serviço Go é obrigado a chamar a API do serviço de cadastros para gravar uma pessoa vinda do app.

## Como os serviços se comunicam

- **Navegador → serviços:** sempre por HTTPS através do Nginx, que escolhe o serviço pelo caminho da URL. O navegador enxerga um único endereço.
- **Sync → cadastros/atendimentos:** HTTP interno (`127.0.0.1`), com `PUT /api/pessoa/{id}`, `PUT /api/prontuario/{id}` e `PUT /api/atendimento/{id}`. O Go repassa o **token do próprio profissional**. Assim o serviço dono valida a permissão e registra no log quem fez a operação.
- **Autenticação entre serviços:** não existe "token de serviço". Os três conhecem o `JWT_SEGREDO` e validam a assinatura localmente.

## Autenticação

1. `POST /api/auth/login` recebe o tipo de registro (CRM, COREN ou SOCORRISTA), o número e a senha.
2. O serviço de cadastros compara a senha com o hash **bcrypt** e devolve um JWT válido por 8 horas, com `sub` (id do profissional), `nome` e `perfil`.
3. Todas as outras rotas exigem `Authorization: Bearer <token>`. Cada serviço tem um middleware que valida o token.
4. **Perfis de acesso:**
   - `admin`: faz tudo, inclusive excluir registros, cadastrar medicamentos e profissionais e ver a auditoria;
   - demais perfis: cadastram e editam pessoas, prontuários e atendimentos.
5. **Login offline** (app do socorrista):
   - no login online, o app guarda um hash **PBKDF2-SHA256** (210 mil iterações, sal aleatório) da senha;
   - sem rede, o app compara a senha digitada com esse hash;
   - a senha em si nunca é gravada;
   - só entra offline quem já entrou online naquele dispositivo.

## Auditoria (logs de acesso)

Cada serviço tem um middleware que registra, ao final de toda requisição:
- data e hora;
- serviço;
- IP do cliente (repassado pelo Nginx);
- id do profissional;
- método;
- rota;
- status;
- duração em milissegundos.

| Serviço | Onde está o middleware |
|---|---|
| Node | [src/log.js](../servicos/cadastros-node/src/log.js) |
| Python | [app/logs.py](../servicos/atendimentos-python/app/logs.py) |
| Go | [logs.go](../servicos/sync-go/logs.go) |

Os registros vão para a tabela `log_acesso` e também para o journal do systemd. A query string não é registrada, para não guardar dados clínicos usados em buscas. Senhas e tokens também nunca entram no log.

O app grava localmente as operações feitas (inclusive logins offline) e envia esse histórico em `POST /api/log` na sincronização (`origem = 'cliente'`).

## Decisões e limitações conhecidas

- **Sem contêineres:** o professor dispensou, e o systemd já cuida de iniciar, reiniciar e registrar logs.
- **Usuário dos serviços:** a política da VM não permite criar usuários (`useradd` bloqueado no sudo). Os serviços rodam como `univates`, com `NoNewPrivileges`, `ProtectSystem=full` e `PrivateTmp`.
- **A ficha PDF é gerada no servidor.** Um atendimento feito offline só gera PDF depois de sincronizado.
- **Cursor do pull:** dois registros gravados ao mesmo tempo podem ser confirmados fora da ordem da sequência. Um pull feito exatamente nesse instante pode pular um deles. Com o volume deste projeto isso é muito improvável. Uma solução completa usaria uma margem de segurança no cursor ou o log de transações do PostgreSQL.
- **O token fica no IndexedDB** do dispositivo, para permitir sincronizar depois de um login offline. Ele expira em 8 horas; depois disso, o app pede um novo login online antes de sincronizar.
