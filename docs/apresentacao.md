# Roteiro de apresentação (cerca de 15 minutos)

## 1. O problema (1 min)

- Equipes de resgate trabalham com sinal instável ou sem sinal.
- O registro do atendimento não pode depender da rede.
- Por isso o sistema é **offline-first**: grava no aparelho e sincroniza quando der.

## 2. Arquitetura (3 min)

Mostre o desenho de [arquitetura.md](arquitetura.md).

- **Três APIs em três linguagens**, na divisão pedida pelo professor:
  - API 1 (Python): autenticação, logs, PDF e e-mail;
  - API 2 (Go): prontuários e sincronização;
  - API 3 (Node): pessoas, medicamentos e atendimentos.
- Cada API só grava nas tabelas que são suas. A API 2, ao sincronizar, grava pessoa e atendimento **chamando a API 3**. Isso é garantido pelas permissões do PostgreSQL ([002_permissoes.sql](../banco/002_permissoes.sql)).
- O Nginx é a única porta de entrada e escolhe a API pelo caminho da URL.
- Cada API roda como uma unidade do systemd (`medicalfield-api1`, `api2`, `api3`), sem contêineres, na VM da Univates com HTTPS.

## 3. Roteiro do professor (8 min)

Siga [roteiro-17-passos.md](roteiro-17-passos.md), com portal e cliente lado a lado. Pontos para comentar durante o roteiro:

| Passo | O que falar |
|---|---|
| 6 e 11 | "O pull pede tudo que mudou depois do cursor. O trigger do banco numera toda alteração, por isso até o INSERT manual aparece." |
| 12 | Abrir DevTools > Application > IndexedDB > `outbox` e mostrar os 3 comandos (padrão **Command**). Na aba Network, não aparece nenhuma requisição. |
| 13 | "O servidor não sabe de nada ainda; os dados estão só no navegador." |
| 14 | "Não cliquei em nada: o **Observer** da conectividade disparou a fila quando voltou o ONLINE." |
| 15 | Portal > **Sincronizações**: cada operação com dispositivo, profissional e status. |
| 16 e 17 | O PDF é gerado pela API 1 (Python, fpdf2) e enviado por SMTP com anexo. |

## 4. Padrões de projeto (2 min)

Mostre cada um no código, conforme [padroes.md](padroes.md):

1. **Repository:** `repositorios.js` (app), `repositorio.js` (Node) e `repositorio.py` (Python).
2. **Strategy:** `conflitos.go`.
3. **Observer:** `conectividade.js` e os dois `assinar()` no final de `app.js`.
4. **Command:** os itens da outbox e o `push.go`.
5. **Chain of Responsibility:** os middlewares de log, token e perfil.
6. **Singleton:** os pools de conexão e o `abrirBanco()`.

## 5. Postman e auditoria (1 min)

- Rodar duas ou três rotas que o professor escolher, como "Push" e depois "Reenviar o mesmo push", para mostrar a idempotência.
- Abrir portal > **Auditoria**: data e hora, IP, profissional, método, rota, status e tempo em milissegundos, das três APIs e do app.

## Perguntas prováveis

**Por que essas linguagens?**
- Python na API 1 pela validação declarativa do FastAPI e pelas bibliotecas de PDF, e-mail e bcrypt.
- Go na API 2, que processa os lotes da sincronização e chama outra API; compilado num único executável.
- JavaScript (Node) na API 3: a mesma linguagem do frontend, para os CRUDs de pessoas, medicamentos e atendimentos.

**Por que três APIs e essa divisão?**
- É a divisão pedida pelo professor: API 1 (autenticação, logs e documentos), API 2 (prontuários) e API 3 (pessoas, medicamentos e atendimentos).
- Cada API é dona das tabelas do seu assunto, e o banco garante isso com um usuário por API.
- Cada uma pode ser reiniciada ou atualizada sem derrubar as outras. Exemplo: com a API 3 parada, o app continua gravando offline; o push devolve `erro` com `retentar` e nada se perde.

**Como funciona a autenticação?**
- Login na API 1 com bcrypt, que devolve um JWT de 8 horas.
- As três APIs validam a assinatura com o mesmo segredo, sem consultar a API 1.
- Offline, o app compara a senha com um hash PBKDF2 guardado no último login online.

**Como funciona o IndexedDB?**
- É um banco de objetos dentro do navegador, com "stores" (como tabelas), índices e transações.
- Os dados ficam no disco do dispositivo e sobrevivem ao fechamento do navegador.
- O app usa uma transação para gravar o registro e o comando da fila ao mesmo tempo.

**Como a aplicação funciona sem internet?**
- O Service Worker guarda os arquivos do app e serve a página sem rede.
- O IndexedDB guarda os dados.
- O simulador só impede que o app faça requisições. Uma queda real de rede funciona igual (teste "sem rede" do Playwright).

**Como evitar duplicados?**
- O UUID é gerado no dispositivo e os serviços fazem upsert por id.
- O `op_id` de cada operação faz o reenvio devolver `duplicada`.
- A chave primária do banco também impede duplicatas.

**E se dois profissionais editarem o mesmo registro?**
- O controle de versão detecta o conflito.
- Paciente e prontuário: vence a alteração mais recente.
- Atendimento: o servidor vence.
- As duas versões ficam guardadas em `sync_operacao`.

**Como os microsserviços se comunicam?**
- HTTP/JSON. O navegador fala com eles pelo Nginx.
- Na sincronização, a API 2 (Go) chama a API 3 (Node) por HTTP interno, repassando o token do profissional.
- A API 1 lê do banco os dados do atendimento para montar a ficha em PDF.

**O sistema decide algo clínico?**
- Não.
- O total de Glasgow é só a soma dos três componentes.
- Os alertas de medicamento e de alergia apenas avisam e nunca bloqueiam o registro.
