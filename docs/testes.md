# Testes automatizados

Última execução: 27/10/2026, depois da reorganização das três APIs, com o sistema na VM da Univates.

## Como executar

```bash
testes/rodar_testes.sh            # na VM: testes de cada API + integração entre elas
cd testes && npx playwright test  # roteiro de 17 passos no Chrome (portal na VM)
postman collection run postman/MedicalField.postman_collection.json   # coleção Postman
```

O `rodar_testes.sh`:
1. recria o banco **medicalfield_teste**, separado do banco de produção;
2. roda os testes de cada API;
3. sobe as três APIs em portas alternativas (18001, 18002 e 13001), apontando para esse banco;
4. executa o teste de integração entre elas.

## Resultados

### API 1 – Autenticação, logs e documentos (Python, pytest): 8 de 8

[servicos/api1-autenticacao-python/tests/test_api1.py](../servicos/api1-autenticacao-python/tests/test_api1.py)

- login devolve token e dados públicos (sem `senha_hash`)
- login com senha errada é recusado
- rotas exigem token
- profissionais: somente admin, registro duplicado (409), desativação impede o login
- `GET /documento/pdf` gera o PDF (e 404 para atendimento inexistente)
- `POST /email/enviar` monta o e-mail com o PDF anexado (SMTP simulado)
- `POST /log` grava os logs do app e `GET /auditoria` mostra (somente admin)
- o middleware grava o log de acesso com profissional, status e duração

### API 2 – Prontuários e sincronização (Go, `go test`): 5 de 5

[servicos/api2-prontuarios-go/conflitos_test.go](../servicos/api2-prontuarios-go/conflitos_test.go)

- `TestUltimaEscritaVence`
- `TestServidorVence`
- `TestEstrategiaPorEntidade`
- `TestValidarOperacao`
- `TestValidarProntuario`

As rotas de prontuário são testadas com banco no teste de integração (abaixo).

### API 3 – Pessoas, medicamentos e atendimentos (Node, `node:test`): 9 de 9

[servicos/api3-atendimentos-node/test/api.test.js](../servicos/api3-atendimentos-node/test/api.test.js)

- rotas exigem token
- lista os dados de demonstração
- CRUD de pessoa com controle de versão e exclusão lógica
- validação de pessoa devolve mensagens compreensíveis
- somente admin cadastra medicamentos
- cria e consulta atendimento por id
- validação de atendimento (faixas, triagem, Glasgow completa, paciente inexistente)
- atendimento: controle de versão e exclusão lógica
- cada requisição gera log com profissional, status e duração

### Integração entre as três APIs: 9 de 9

[testes/integracao.test.js](../testes/integracao.test.js)

- as três APIs exigem token
- pull inicial traz os dados de apoio e um cursor
- push grava nas APIs donas e o reenvio não duplica
- conflito em paciente: última escrita vence
- conflito em atendimento: servidor vence
- prontuário pela API 2: busca pela pessoa, único por pessoa e controle de versão
- operação inválida volta como erro sem retentar
- medicamento cadastrado no servidor chega ao dispositivo pelo pull
- logs offline do app e logs das três APIs ficam na auditoria

### Navegador – Playwright com Chrome: 3 de 3

[testes/e2e/roteiro.spec.js](../testes/e2e/roteiro.spec.js)

Executado duas vezes: com o app do socorrista aberto pela VM (`CLIENTE_URL=https://medicalfield.duckdns.org`) e com o app em `localhost`.

- **roteiro de avaliação (17 passos):** portal e cliente em sessões separadas. O passo 9 insere o medicamento via `psql` na VM. O passo 12 confirma que nenhuma requisição `/api/` sai do navegador em modo offline. O passo 16 baixa o PDF da API 1 e o passo 17 envia um e-mail real pela API 1.
- **sem rede de verdade:** o app abre pelo Service Worker com a rede do navegador desligada, aceita o login offline e recusa senha errada.
- **internet cai sem o navegador perceber:** com `navigator.onLine` ainda verdadeiro, as requisições falham; o indicador passa para "Sem rede" e volta para "Online" sozinho quando o servidor responde de novo.

### Postman (Postman CLI): 30 requisições, 33 verificações, 0 falhas

A coleção é organizada por API, na ordem em que uma depende da outra.

## Verificações da reorganização

- **Rotas antigas não existem mais:** `/api/atendimento/{id}/pdf`, `/api/atendimento/detalhe/{id}` e `/api/openapi/cadastros.json` respondem 404. Nenhum arquivo do portal ou do app chama essas rotas.
- **Dados preservados:** a contagem do banco de produção era a mesma antes e depois da migração (5 pacientes, 5 prontuários, 3 atendimentos, 10 medicamentos).

## O que cada requisito tem de teste

| Requisito | Onde é testado |
|---|---|
| Login e autorização | API 1: testes 1 a 4; API 3: teste 1; integração 1 |
| CRUD | API 3: testes 3, 5, 6 e 8; integração 6 (prontuário) |
| Integração entre as APIs | integração 3, 4 e 5 (API 2 chamando a API 3) |
| Persistência local (IndexedDB) | Playwright: passo 12 e teste "sem rede" |
| Persistência central | integração 3; Playwright: passos 8 e 15 |
| Operação offline | Playwright: passos 12 a 14 e teste "sem rede" |
| Sincronização bidirecional | integração 2, 3 e 8; Playwright: passos 6, 11 e 14 |
| Idempotência | integração 3; Postman: "Reenviar o mesmo push" |
| Conflitos | API 2: testes 1 a 3; integração 4 e 5 |
| Logs | API 1: testes 7 e 8; API 3: teste 9; integração 9 |
| PDF | API 1: teste 5; Playwright: passo 16 |
| E-mail | API 1: teste 6 (SMTP simulado); Playwright: passo 17 e Postman (envio real pelo Gmail) |

## Limitações

- O envio real de e-mail foi aceito pelo servidor SMTP do Gmail: a API devolveu sucesso depois do `send_message`. A **chegada na caixa de entrada** precisa ser conferida manualmente (conta `lpfctest@gmail.com`).
- O teste do Playwright e a coleção Postman rodam contra o servidor publicado e criam registros reais. Para voltar ao estado inicial, use `banco/criar_banco.sh --recriar` na VM.
- A interface foi testada automaticamente no Chrome. Edge (que também é Chromium) e Firefox não foram testados de forma automatizada.
