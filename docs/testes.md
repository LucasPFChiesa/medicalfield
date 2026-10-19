# Testes automatizados

Última execução: 13/10/2026, com os serviços na VM da Univates.

## Como executar

```bash
testes/rodar_testes.sh            # na VM ou em máquina com PostgreSQL: unitários + integração
cd testes && npx playwright test  # roteiro de 17 passos no Chrome, contra https://medicalfield.duckdns.org
npx newman run postman/MedicalField.postman_collection.json --env-var senha=...   # coleção Postman
```

O `rodar_testes.sh`:
1. recria o banco **medicalfield_teste**, separado do banco de produção;
2. roda os testes de cada serviço;
3. sobe os três serviços em portas alternativas (13001, 18001 e 18002), apontando para esse banco;
4. executa o teste de integração entre eles.

## Resultados

### Cadastros – Node (`node:test`): 8 de 8

[servicos/cadastros-node/test/api.test.js](../servicos/cadastros-node/test/api.test.js)

- login com senha errada é recusado
- rotas exigem token
- lista os dados de demonstração
- CRUD de pessoa com controle de versão e exclusão lógica
- validação devolve mensagens compreensíveis
- prontuário é obtido pelo id da pessoa e é único por pessoa
- somente admin cadastra medicamentos e profissionais
- cada requisição gera log com profissional, status e duração

### Atendimentos – Python (pytest): 7 de 7

[servicos/atendimentos-python/tests/test_atendimentos.py](../servicos/atendimentos-python/tests/test_atendimentos.py)

- `test_exige_token`
- `test_cria_e_consulta_atendimento`
- `test_validacoes`
- `test_controle_de_versao_e_exclusao`
- `test_gera_pdf`
- `test_envia_email_com_anexo`
- `test_log_de_acesso`

### Sincronização – Go (`go test`): 4 de 4

[servicos/sync-go/conflitos_test.go](../servicos/sync-go/conflitos_test.go)

- `TestUltimaEscritaVence`
- `TestServidorVence`
- `TestEstrategiaPorEntidade`
- `TestValidarOperacao`

### Integração dos três serviços: 8 de 8

[testes/integracao.test.js](../testes/integracao.test.js)

- os três serviços exigem token
- pull inicial traz os dados de apoio e um cursor
- push grava nos serviços donos e o reenvio não duplica
- conflito em paciente: última escrita vence
- conflito em atendimento: servidor vence
- operação inválida volta como erro sem retentar
- medicamento cadastrado no servidor chega ao dispositivo pelo pull
- logs offline do app e logs dos três serviços ficam na auditoria

### Navegador – Playwright com Chrome: 3 de 3

[testes/e2e/roteiro.spec.js](../testes/e2e/roteiro.spec.js)

- **roteiro de avaliação (17 passos):** portal e cliente em sessões separadas. O passo 9 insere o medicamento via `psql` na VM. O passo 12 confirma que nenhuma requisição `/api/` sai do navegador em modo offline. O passo 16 confere o download do PDF. O passo 17 envia um e-mail real.
- **sem rede de verdade:** o app abre pelo Service Worker com a rede do navegador desligada, aceita o login offline e recusa senha errada.
- **internet cai sem o navegador perceber:** com `navigator.onLine` ainda verdadeiro, as requisições falham; o indicador passa para "Sem rede" e volta para "Online" sozinho quando o servidor responde de novo.

### Postman (Newman): 34 requisições, 37 verificações, 0 falhas

## O que cada requisito tem de teste

| Requisito | Onde é testado |
|---|---|
| Login e autorização | Node 1, 2 e 7; Python 1 e 4; integração 1 |
| CRUD | Node 4, 6 e 7; Python 2 e 4 |
| Integração entre microsserviços | integração 3, 4 e 5 (Go chamando Node e Python) |
| Persistência local (IndexedDB) | Playwright: passo 12 e teste "sem rede" |
| Persistência central | integração 3; Playwright: passos 8 e 15 |
| Operação offline | Playwright: passos 12 a 14 e teste "sem rede" |
| Sincronização bidirecional | integração 2, 3 e 7; Playwright: passos 6, 11 e 14 |
| Idempotência | integração 3; Postman: "Reenviar o mesmo push" |
| Conflitos | Go 1 a 3; integração 4 e 5 |
| Logs | Node 8; Python 7; integração 8 |
| PDF | Python 5; Playwright: passo 16 |
| E-mail | Python 6 (SMTP simulado, confere destinatário e anexo); Playwright: passo 17 e Postman (envio real pelo Gmail) |

## Limitações

- O envio real de e-mail foi aceito pelo servidor SMTP do Gmail: a API devolveu sucesso depois do `send_message`. A **chegada na caixa de entrada** precisa ser conferida manualmente (conta `lpfctest@gmail.com`).
- O teste do Playwright e a coleção Postman rodam contra o servidor publicado e criam registros reais. Para voltar ao estado inicial, use `banco/criar_banco.sh --recriar` na VM.
- A interface foi testada automaticamente no Chrome. Edge (que também é Chromium) e Firefox não foram testados de forma automatizada.
