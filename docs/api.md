# APIs

- **Base:** `https://medicalfield.duckdns.org/api`
- **Swagger:** https://medicalfield.duckdns.org/docs/ (tem um seletor para os três serviços)
- **Coleção Postman:** [postman/MedicalField.postman_collection.json](../postman/MedicalField.postman_collection.json)

Todas as rotas exigem `Authorization: Bearer <token>`, com duas exceções:
- `POST /api/auth/login`;
- as especificações OpenAPI em `/api/openapi/*.json`, que só descrevem as rotas e não contêm dados.

Os erros seguem o formato `{"erro": "mensagem", "detalhes": ["..."]}` nos três serviços.

## Cadastros – Node.js (porta interna 3001)

| Método | Endpoint | Perfil | Ação |
|---|---|---|---|
| POST | `/auth/login` | público | Autentica e retorna `{token, profissional}` |
| GET | `/auth/eu` | todos | Conteúdo do token atual |
| GET | `/pessoa?busca=` | todos | Lista pessoas (filtro opcional por nome ou CPF) |
| GET | `/pessoa/{id}` | todos | Obtém uma pessoa |
| POST | `/pessoa` | todos | Cadastra nova pessoa (`id` opcional, gerado pelo cliente) |
| PUT | `/pessoa/{id}` | todos | Cria ou atualiza; com `versao_base`, devolve 409 se o registro mudou |
| DELETE | `/pessoa/{id}` | admin | Exclusão lógica |
| GET | `/prontuario` | todos | Todos os prontuários de todas as pessoas |
| GET | `/prontuario/{id}` | todos | Prontuário de uma pessoa (aceita o id da pessoa ou do prontuário) |
| POST | `/prontuario` | todos | Cadastra prontuário (um ativo por pessoa) |
| PUT / DELETE | `/prontuario/{id}` | todos / admin | Atualiza / exclusão lógica |
| GET | `/medicamento` | todos | Todos os medicamentos |
| GET | `/medicamento/{id}` | todos | Um medicamento |
| POST / PUT / DELETE | `/medicamento[/{id}]` | admin | Mantém o catálogo |
| GET / POST / PUT / DELETE | `/profissional[/{id}]` | admin | Profissionais (DELETE desativa) |
| GET | `/auditoria?servico=&limite=` | admin | Logs de acesso de todos os serviços |

## Atendimentos – Python/FastAPI (porta interna 8001)

| Método | Endpoint | Perfil | Ação |
|---|---|---|---|
| GET | `/atendimento?paciente_id=` | todos | Lista atendimentos |
| GET | `/atendimento/{pessoaId}` | todos | Todos os atendimentos de uma pessoa (como no documento do projeto) |
| GET | `/atendimento/detalhe/{id}` | todos | Um atendimento com os medicamentos administrados |
| POST | `/atendimento` | todos | Cadastra atendimento |
| PUT | `/atendimento/{id}` | todos | Cria ou atualiza com controle de versão (`versao_base`) |
| DELETE | `/atendimento/{id}` | admin | Exclusão lógica |
| GET | `/atendimento/{id}/pdf` | todos | Ficha de atendimento em PDF (download) |
| POST | `/atendimento/{id}/email` | todos | Envia a ficha em anexo: `{"destinatario": "..."}` |

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
- Se `prontuario_id` não for enviado, o serviço usa o prontuário ativo do paciente.
- Se `profissional_id` não for enviado, o responsável é o profissional do token.

## Sincronização – Go (porta interna 8002)

| Método | Endpoint | Ação |
|---|---|---|
| POST | `/sync/push` | Recebe a fila do dispositivo (até 200 operações) e devolve o resultado de cada uma |
| GET | `/sync/pull?desde=N` | Tudo que mudou depois do cursor N, mais o novo cursor |
| GET | `/sync/operacoes?limite=` | Rastro das operações recebidas (usado pelo portal) |
| POST | `/log` | Logs gravados pelo app enquanto estava offline |

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
| `aplicada` | Gravada no serviço dono |
| `duplicada` | Esse `op_id` já tinha sido processado; nada foi gravado de novo |
| `conflito` | Resolvido pela estratégia da entidade; o registro que ficou no servidor vem em `registro` |
| `erro` | Não gravada; `retentar: true` indica falha temporária |

Resposta de `GET /sync/pull`:

```json
{ "cursor": 57, "pacientes": [...], "prontuarios": [...], "atendimentos": [...], "medicamentos": [...], "profissionais": [...] }
```
