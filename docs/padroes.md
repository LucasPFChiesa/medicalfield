# Padrões de projeto

Os três primeiros são os sugeridos pelo documento do trabalho. Os outros três foram escolhidos porque já resolviam problemas reais do sistema.

## 1. Repository

**Problema:** as telas do app não devem saber se o dado vem do IndexedDB, da fila de envio ou da API. Se cada tela abrisse transações do IndexedDB e montasse requisições, a regra de "gravar local + enfileirar" estaria repetida em todo lugar.

**Solução:** objetos com operações de alto nível (`listar`, `buscar`, `salvar`) que escondem o armazenamento.

| Onde | Arquivo | O que faz |
|---|---|---|
| App (local) | [web/socorrista/repositorios.js](../web/socorrista/repositorios.js), `criarRepositorioLocal()` → `pacientes`, `prontuarios`, `atendimentos` | `salvar()` grava o registro e o comando da outbox na mesma transação |
| App (remoto) | mesmo arquivo, objeto `servidor` | Único ponto que chama a API; respeita o simulador offline |
| Node | [servicos/cadastros-node/src/repositorio.js](../servicos/cadastros-node/src/repositorio.js) | `criarRepositorio()` usado por pessoas, prontuários e medicamentos (upsert com versão, exclusão lógica) |
| Python | [servicos/atendimentos-python/app/repositorio.py](../servicos/atendimentos-python/app/repositorio.py) | Todo o SQL de atendimentos; `main.py` só chama funções |

**Na apresentação:** mostrar `paginaPacientes()` em `app.js`, que só chama `pacientes.listar()`, e depois o `salvar()` com a transação de duas stores.

## 2. Strategy

**Problema:** o algoritmo para resolver conflito de versão depende da entidade. Para dados cadastrais, a alteração mais recente pode prevalecer. Para um atendimento já consolidado, não é seguro sobrescrever.

**Solução:** a interface `EstrategiaConflito`, com duas implementações, e um mapa que escolhe a estratégia por entidade.

| Arquivo | Conteúdo |
|---|---|
| [servicos/sync-go/conflitos.go](../servicos/sync-go/conflitos.go) | `UltimaEscritaVence`, `ServidorVence`, mapa `estrategias` |
| [servicos/sync-go/push.go](../servicos/sync-go/push.go) | `processarOperacao()` usa `estrategias[op.Entidade].ClienteVence(...)` sem saber qual é |

**Na apresentação:**
1. Editar uma pessoa no portal.
2. Editar a mesma pessoa no app em modo OFFLINE.
3. Voltar para ONLINE.

O histórico mostra a mensagem `Conflito resolvido por "última escrita vence"`. Os testes estão em `conflitos_test.go` e em `testes/integracao.test.js`.

## 3. Observer

**Problema:** quando a conexão muda, várias partes precisam reagir: o indicador do topo, o botão Sincronizar, a tela de login e o envio automático da fila. O módulo de conexão não deveria conhecer todas elas.

**Solução:** `conectividade.js` mantém uma lista de ouvintes (`assinar`) e avisa todos quando o estado muda. O aviso vem do simulador ou dos eventos `online`/`offline` do navegador.

| Arquivo | Papel |
|---|---|
| [web/socorrista/conectividade.js](../web/socorrista/conectividade.js) | Sujeito: `assinar()`, `definirSimulador()`, `avisar()` |
| [web/socorrista/app.js](../web/socorrista/app.js) (final do arquivo) | Dois observadores: um atualiza a tela; o outro dispara `sincronizarComAviso()` quando a conexão **volta** e há pendências |

**Na apresentação:** no passo 14, basta mudar o simulador para ONLINE; a fila é enviada sozinha.

## 4. Command

**Problema:** uma ação feita offline precisa ser **guardada para executar depois**, sobreviver ao fechamento do navegador, poder ser reenviada e ser identificada de forma única.

**Solução:** cada gravação vira um objeto-comando persistido na outbox, com tudo que é necessário para executá-lo depois:

```
{ op_id, entidade, acao, entidade_id, versao_base, dados, tentativas }
```

| Arquivo | Papel |
|---|---|
| [web/socorrista/repositorios.js](../web/socorrista/repositorios.js) | Cria o comando (`fila.add(...)`) |
| [web/socorrista/outbox.js](../web/socorrista/outbox.js) | Enfileira o envio e trata o resultado de cada comando |
| [servicos/sync-go/push.go](../servicos/sync-go/push.go) | Executa o comando (`Operacao`) no servidor; o `op_id` garante que ele roda uma vez só |

**Na apresentação:** no passo 12, abrir a tela **Sincronização** (ou o DevTools > Application > IndexedDB > outbox) e mostrar os três comandos.

## 5. Chain of Responsibility (middlewares)

**Problema:** toda requisição precisa passar por log e autenticação antes de chegar à rota. Repetir isso em cada rota seria fácil de esquecer.

**Solução:** uma cadeia de manipuladores. Cada elo faz sua parte e decide se passa adiante (`next()`) ou encerra a requisição, como no caso de 401 ou 403.

| Serviço | Cadeia |
|---|---|
| Node | `registrarAcesso` → `verificarToken` → `permitir('admin')` → rota ([app.js](../servicos/cadastros-node/src/app.js)) |
| Python | middleware `registrar_acesso` → dependência `profissional_atual` → `exigir_admin` → rota ([main.py](../servicos/atendimentos-python/app/main.py)) |
| Go | `registrarAcesso(exigirToken(mux))`, com `http.Handler` encadeados ([main.go](../servicos/sync-go/main.go)) |

**Na apresentação:** fazer uma chamada no Postman sem token (401) e mostrar a linha correspondente na tela **Auditoria**.

## 6. Singleton

**Problema:** abrir uma conexão com o banco a cada requisição é lento e pode esgotar as conexões do PostgreSQL. No navegador, abrir o IndexedDB várias vezes também é desnecessário.

**Solução:** uma única instância compartilhada por processo.

| Onde | Arquivo | Instância |
|---|---|---|
| Node | [src/db.js](../servicos/cadastros-node/src/db.js) | `export const pool`; o módulo ES é carregado uma vez, então todos importam o mesmo pool |
| Python | [app/db.py](../servicos/atendimentos-python/app/db.py) | `pool = ConnectionPool(...)` no nível do módulo |
| Go | [main.go](../servicos/sync-go/main.go) | variável `banco *pgxpool.Pool`, criada uma vez em `main()` |
| App | [web/socorrista/db-local.js](../web/socorrista/db-local.js) | `abrirBanco()` guarda a promessa da conexão em `conexao` e a reaproveita |

**Na apresentação:** mostrar `abrirBanco()`, com `conexao ??= new Promise(...)`.
