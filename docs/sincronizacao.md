# Offline-first e sincronização

## Ideia geral

O app do socorrista **sempre grava primeiro no próprio navegador** (IndexedDB), esteja online ou não. Cada gravação também cria um comando numa fila local chamada *outbox*. Enviar essa fila ao servidor é um passo separado:

- **online:** a fila é enviada logo depois da gravação;
- **offline:** a fila espera, e é enviada automaticamente quando a conexão volta (ou pelo botão **Sincronizar**).

Com isso existe **um único caminho de gravação**, o que deixa o comportamento previsível e fácil de testar. O servidor só passa a ter o registro depois que a fila é enviada. Por isso, no passo 13 do roteiro, o portal ainda não mostra o cadastro feito offline.

## Como o app funciona sem internet

1. **Service Worker** ([sw.js](../web/socorrista/sw.js)):
   - na primeira visita, guarda em cache o HTML, o CSS e os módulos JS do app;
   - nas próximas aberturas responde do cache, então a página abre mesmo sem rede;
   - se houver rede, atualiza a cópia em segundo plano;
   - não intercepta as chamadas `/api/`.
2. **IndexedDB** ([db-local.js](../web/socorrista/db-local.js)): guarda pacientes, prontuários, atendimentos, medicamentos, a fila, os logs e a sessão. Os dados continuam lá depois de fechar o navegador.
3. **Login offline** ([sessao.js](../web/socorrista/sessao.js)): compara a senha com um hash PBKDF2 guardado no último login online.
4. **Detecção de conexão** ([conectividade.js](../web/socorrista/conectividade.js)): `online = simulador em ONLINE e navigator.onLine e servidor alcançável`. O `navigator.onLine` sozinho não basta: no Linux, uma interface virtual (Docker, VPN) mantém o navegador "online" sem internet. Por isso o app faz um `GET /api/ping` a cada 5 segundos, respondido pelo próprio Nginx e sem gerar log, e só quando o simulador está em ONLINE. Qualquer requisição que falhe por rede também marca "Sem rede" na hora.

## Simulador de conectividade

A chave **Simular ONLINE / OFFLINE** fica no topo do app. Com OFFLINE, o repositório remoto ([repositorios.js](../web/socorrista/repositorios.js), função `chamarServidor`) recusa qualquer requisição antes de ela sair do navegador. O teste automático confirma que nenhuma chamada `/api/` acontece durante o passo 12.

O indicador mostra três estados:

| Indicador | Situação |
|---|---|
| **Online** | Simulador em ONLINE e com rede |
| **Offline** | Simulador em OFFLINE |
| **Sem rede** | Simulador em ONLINE, mas a rede real caiu |

## Cliente → servidor (push)

1. A tela chama, por exemplo, `pacientes.salvar(dados)`.
2. Numa **única transação do IndexedDB**, o app grava o registro local e o comando na outbox:
   ```js
   { op_id, entidade: 'paciente', acao: 'criar', entidade_id, versao_base, dados, tentativas: 0 }
   ```
   Se já existe um comando para o mesmo registro que ainda **nunca foi enviado**, ele é atualizado em vez de criar outro. Assim, a fila tem no máximo um comando não enviado por registro.
3. Ao sincronizar ([outbox.js](../web/socorrista/outbox.js)):
   - o app soma 1 em `tentativas` antes de enviar;
   - depois manda a fila inteira, na ordem em que foi feita (pessoa, depois prontuário, depois atendimento), para `POST /api/sync/push`.
4. A API 2, em Go ([push.go](../servicos/api2-prontuarios-go/push.go)) processa cada operação:
   1. Se o `op_id` já está em `sync_operacao` (e não deu erro), responde `duplicada` sem gravar nada (**idempotência**).
   2. Lê a versão atual do registro no banco (só leitura).
   3. Se o registro não existe, ou se a versão é igual à `versao_base`, encaminha a operação.
   4. Se a versão é diferente, há um **conflito**: a estratégia da entidade decide quem vence.
   5. Grava na API dona: o prontuário a própria API 2 grava; pessoa e atendimento vão por `PUT` para a API 3, com o token do profissional. A gravação usa `versao_base`; se alguém alterou o registro nesse meio-tempo, o dono responde 409, que vira `conflito`.
   6. Registra o resultado em `sync_operacao` (rastreabilidade) e devolve o registro como ficou no servidor.
5. O app trata cada resultado:

| Resultado | O que o app faz |
|---|---|
| `aplicada` / `duplicada` | Remove da fila e atualiza o registro local com a versão do servidor |
| `conflito` | Remove da fila, substitui o local pela versão vencedora e registra no histórico |
| `erro` | Mantém na fila com a mensagem. Com `retentar` (rede, serviço fora, token vencido), tenta de novo na próxima sincronização. Erros de validação podem ser descartados pelo usuário na tela Sincronização |

## Servidor → cliente (pull)

1. O app chama `GET /api/sync/pull?desde=<cursor>`, onde o cursor é o último valor recebido (0 na primeira vez).
2. O Go ([pull.go](../servicos/api2-prontuarios-go/pull.go)) abre uma transação `REPEATABLE READ` somente leitura e devolve todos os registros com `seq_alteracao > cursor`. A resposta inclui registros excluídos, e cobre pacientes, prontuários, atendimentos (com medicamentos), medicamentos e profissionais (só dados públicos).
3. O novo cursor é o maior `seq_alteracao` dessa mesma fotografia do banco.
4. O app grava tudo no IndexedDB, menos os registros que ainda têm operação pendente na fila: a alteração local prevalece até ser enviada.

O `seq_alteracao` vem de um trigger do banco. Por isso **qualquer** alteração aparece no pull, inclusive um `INSERT` feito direto no `psql` (passo 9 do roteiro).

## Como são evitados registros duplicados

1. **UUID gerado no dispositivo.** O mesmo registro tem o mesmo id em todo lugar, e os serviços fazem *upsert* por id (`PUT /recurso/{id}`).
2. **`op_id` por operação.** Se a resposta do push se perder e o app reenviar a mesma fila, o Go reconhece o `op_id` e responde `duplicada`.
3. **Chave primária no banco.** Mesmo numa corrida entre dois envios, o PostgreSQL não aceita dois registros com o mesmo id.

O teste de integração ([testes/integracao.test.js](../testes/integracao.test.js)) reenvia a mesma fila e confirma que o paciente continua com um único atendimento.

## Tratamento de conflitos

Um conflito acontece quando o dispositivo edita um registro a partir da versão N, mas no servidor ele já está na versão N+1 (por exemplo, editado pelo portal).

| Entidade | Estratégia | Regra |
|---|---|---|
| paciente, prontuário | **Última escrita vence** | Compara `alterado_no_cliente_em` do dispositivo com a do servidor e fica a mais recente |
| atendimento | **Servidor vence** | O registro clínico consolidado não é sobrescrito sem revisão. A versão do dispositivo fica guardada em `sync_operacao.payload_cliente` |

As estratégias estão em [conflitos.go](../servicos/api2-prontuarios-go/conflitos.go) (padrão Strategy). Os dois casos são testados em `testes/integracao.test.js`.

Um registro **excluído** no servidor sempre vence: a alteração do dispositivo vira conflito.

## Falhas e reenvio seguro

- **Rede caiu durante o envio:** os comandos já tinham `tentativas > 0` e ficam na fila. O próximo envio usa o mesmo `op_id`, então o que já tinha sido aplicado volta como `duplicada`.
- **Serviço dono fora do ar:** o resultado é `erro` com `retentar: true`. O comando fica na fila.
- **Token expirado:** o app pede novo login online. Os dados pendentes não se perdem.
- **Um registro foi editado de novo enquanto o envio anterior estava em andamento:** o comando novo passa a se basear na versão que o servidor devolveu, evitando um falso conflito.

## Rastreabilidade

| Onde | O que fica registrado |
|---|---|
| `sync_operacao` (servidor) | Quem enviou (profissional e dispositivo), o que, quando, resultado, mensagem e as duas versões em caso de conflito. Visível no portal em **Sincronizações** |
| `log_acesso` | Cada chamada HTTP das três APIs e as operações locais do app (`origem = 'cliente'`). Visível no portal em **Auditoria** |
| `historico_sync` (IndexedDB) | O resultado de cada operação enviada pelo dispositivo. Visível no app em **Sincronização** |
