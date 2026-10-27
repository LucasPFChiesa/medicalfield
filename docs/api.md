# APIs

- **Base:** `https://medicalfield.duckdns.org/api`
- **Swagger:** https://medicalfield.duckdns.org/docs/ (tem um seletor para as três APIs)
- **Coleção Postman:** [postman/MedicalField.postman_collection.json](../postman/MedicalField.postman_collection.json), organizada por API

O sistema tem três APIs, uma em cada linguagem, divididas como pede o professor:

| API | Linguagem | Pasta | Responsabilidade |
|---|---|---|---|
| **API 1** | Python (FastAPI) | `servicos/api1-autenticacao-python` | Autenticação, logs e documentos (PDF e e-mail) |
| **API 2** | Go | `servicos/api2-prontuarios-go` | Prontuários e sincronização do app |
| **API 3** | Node.js (Express) | `servicos/api3-atendimentos-node` | Pessoas, medicamentos e atendimentos |

O navegador sempre chama o mesmo endereço (`/api/...`). O Nginx olha o caminho e encaminha para a API dona dele ([implantacao/nginx-medicalfield.conf](../implantacao/nginx-medicalfield.conf)).

## Autenticação (Bearer token)

1. `POST /api/auth/login` (API 1) confere a senha com o hash bcrypt e devolve um **JWT** válido por 8 horas.
2. Todas as outras rotas exigem o cabeçalho `Authorization: Bearer <token>`.
3. As três APIs validam o token sozinhas, com o mesmo segredo `JWT_SEGREDO`, sem consultar a API 1 a cada requisição.

Sem token, ou com token inválido, a resposta é **401**. Perfil sem permissão recebe **403**. As especificações OpenAPI (`/api/openapi/*.json`) são públicas porque só descrevem as rotas. Os erros seguem o formato `{"erro": "mensagem", "detalhes": ["..."]}` nas três APIs.

## API 1 – Autenticação, logs e documentos (Python, porta interna 8001)

| Método | Endpoint | Perfil | Ação |
|---|---|---|---|
| POST | `/auth/login` | público | Autentica e retorna `{token, profissional}` |
| POST | `/log` | todos | Envia os logs locais gravados pelo app offline |
| POST | `/email/enviar` | todos | Envia a ficha do atendimento em PDF anexada: `{"atendimento_id", "destinatario"}` |
| GET | `/documento/pdf?atendimento_id=` | todos | Gera a ficha de atendimento em PDF (download) |
| GET | `/auth/eu` | todos | Conteúdo do token atual |
| GET / POST / PUT / DELETE | `/profissional[/{id}]` | admin | Profissionais (DELETE desativa) |
| GET | `/auditoria?servico=&limite=` | admin | Logs de acesso das três APIs e do app |

A ficha usa dados da API 3 (atendimento), da API 2 (prontuário) e do cadastro da pessoa. A API 1 só **lê** essas tabelas no banco; ela não grava nelas.

## API 2 – Prontuários e sincronização (Go, porta interna 8002)

| Método | Endpoint | Perfil | Ação |
|---|---|---|---|
| GET | `/prontuario?busca=` | todos | Todos os prontuários (filtro opcional pelo nome do paciente) |
| GET | `/prontuario/{id}` | todos | Prontuário por id (aceita o id do prontuário ou da pessoa) |
| POST | `/prontuario` | todos | Cadastra prontuário (um ativo por pessoa) |
| PUT | `/prontuario/{id}` | todos | Cria ou atualiza, com controle de versão (`versao_base`) |
| DELETE | `/prontuario/{id}` | admin | Exclusão lógica |
| POST | `/sync/push` | todos | Recebe a fila de operações feitas offline (até 200) |
| GET | `/sync/pull?desde=N` | todos | Tudo que mudou depois do cursor N, mais o novo cursor |
| GET | `/sync/operacoes?limite=` | todos | Rastro das operações recebidas (portal) |
| GET | `/sync/operacoes/{op_id}` | todos | Uma operação com a versão do dispositivo e a do servidor |

## API 3 – Pessoas, medicamentos e atendimentos (Node, porta interna 3001)

| Método | Endpoint | Perfil | Ação |
|---|---|---|---|
| GET | `/medicamento` | todos | Todos os medicamentos |
| POST | `/pessoa` | todos | Cadastra pessoa (`id` opcional, gerado pelo cliente) |
| GET | `/atendimento/{id}` | todos | Um atendimento com os medicamentos administrados |
| POST | `/atendimento` | todos | Cadastra atendimento |
| GET | `/pessoa?busca=`, `/pessoa/{id}` | todos | Lista e consulta pessoas |
| PUT / DELETE | `/pessoa/{id}` | todos / admin | Atualiza com `versao_base` / exclusão lógica |
| GET | `/medicamento/{id}` | todos | Um medicamento |
| POST / PUT / DELETE | `/medicamento[/{id}]` | admin | Mantém o catálogo |
| GET | `/atendimento?paciente_id=` | todos | Lista os atendimentos (de uma pessoa, se informado) |
| PUT / DELETE | `/atendimento/{id}` | todos / admin | Atualiza com `versao_base` / exclusão lógica |

Exemplo de corpo do `POST /atendimento`:

```json
{
  "paciente_id": "UUID da pessoa",
  "data_hora": "2026-10-13T14:30:00-03:00",
  "tipo_ocorrencia": "trauma",
  "local": "Av. Senador Alberto Pasqualini, 2000 - Lajeado",
  "descricao": "Queda de altura de 2 metros.",
  "pa_sistolica": 130, "pa_diastolica": 85, "fc": 98, "fr": 20, "spo2": 97,
  "temperatura": 36.5, "glicemia": 110,
  "glasgow_ocular": 4, "glasgow_verbal": 5, "glasgow_motora": 6,
  "manchester": "amarelo", "start": "amarelo",
  "medicamentos": [
    { "medicamento_id": "UUID", "dose": 1, "unidade": "g", "via": "IV", "horario": "2026-10-13T14:40:00-03:00" }
  ]
}
```

- `tipo_ocorrencia`: clinica, trauma, acidente_transito, queda, obstetrica, psiquiatrica ou outra.
- Se `prontuario_id` não for enviado, a API usa o prontuário ativo do paciente.
- Se `profissional_id` não for enviado, o responsável é o profissional do token.

## Como as APIs se comunicam

| De | Para | Quando |
|---|---|---|
| Navegador | qualquer API | Sempre por HTTPS, pelo Nginx |
| API 2 | API 3 | Na sincronização (push): pessoas e atendimentos vindos do app são gravados com `PUT /api/pessoa/{id}` e `PUT /api/atendimento/{id}`, repassando o token do profissional. O prontuário é gravado pela própria API 2 |
| API 1 | banco | Lê atendimento, pessoa e prontuário para montar a ficha em PDF |

## Sincronização: formato do push e do pull

Exemplo de `POST /sync/push`:

```json
{
  "dispositivo_id": "a3f0...",
  "operacoes": [
    { "op_id": "UUID", "entidade": "paciente", "acao": "criar", "entidade_id": "UUID", "versao_base": 0,
      "dados": { "id": "UUID", "nome": "Vítima", "alterado_no_cliente_em": "2026-10-13T15:00:00Z" } }
  ]
}
```

Cada resultado traz o `status` da operação:

| Status | Significado |
|---|---|
| `aplicada` | Gravada pela API dona |
| `duplicada` | Esse `op_id` já tinha sido processado; nada foi gravado de novo |
| `conflito` | Resolvido pela estratégia da entidade; o registro que ficou no servidor vem em `registro` |
| `erro` | Não gravada; `retentar: true` indica falha temporária |

Resposta de `GET /sync/pull`:

```json
{ "cursor": 57, "pacientes": [...], "prontuarios": [...], "atendimentos": [...], "medicamentos": [...], "profissionais": [...] }
```
