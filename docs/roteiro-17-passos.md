# Roteiro de testes (17 passos do professor)

## Preparação

- Use duas janelas do navegador lado a lado:
  - **Portal:** https://medicalfield.duckdns.org/portal/
  - **Cliente (no notebook):** rode `./iniciar-socorrista.sh` (o navegador abre em http://localhost:8080/socorrista/)
- Deixe um terminal aberto com acesso à VM: `ssh univates@177.44.248.50`.
- Login simples: tipo **CRM**, número **admin**, senha **admin** (portal e cliente). Os outros usuários de exemplo também usam a senha `admin`.
- Para começar com o banco limpo, só com os dados fictícios: na VM, rode `cd /opt/medicalfield && banco/criar_banco.sh --recriar` e depois `sudo systemctl restart 'medicalfield-*'`.
- No cliente, para começar do zero, abra o DevTools > Application > Storage > **Clear site data**.

| # | Onde | Ação | Resultado esperado |
|---|---|---|---|
| 1 | Portal | Entrar com **CRM / admin / admin** (Helena, perfil admin) | Menu do portal com o nome no topo |
| 2 | Portal | Menu **Pacientes**, depois **Medicamentos** (e **Profissionais**) | 5 pacientes, 10 medicamentos, 4 profissionais |
| 3 | Portal | Menu **Prontuários** | 5 prontuários com o nome do paciente |
| 4 | Portal | Menu **Atendimentos** | 3 atendimentos de exemplo com triagem e Glasgow |
| 5 | Cliente | Simulador em **ONLINE**; entrar com **CRM / admin / admin** (ou ID de socorrista **SOC-0042**, senha **admin**, para o atendimento sair em nome do socorrista Marcos) | Topo mostra "Online" e o nome |
| 6 | Cliente | No primeiro login a sincronização é automática (ou clique em **Sincronizar**) | Mensagem "Sincronização concluída: … registro(s) recebido(s)"; telas Pacientes e Medicamentos preenchidas |
| 7 | Cliente | **Registrar atendimento**: escolher um paciente, tipo, descrição, sinais vitais, Glasgow, Manchester e um medicamento → **Salvar** | Mensagem "Sincronização concluída: 1 enviada(s)"; etiqueta **sincronizado** |
| 8 | Portal | **Atendimentos** → **Atualizar** | Novo atendimento no topo da lista; **Ver** mostra os detalhes |
| 9 | VM | Inserir medicamento direto no banco (comando abaixo) e, no portal, abrir **Medicamentos** → **Atualizar** | O medicamento novo aparece |
| 10 | Portal | **Atendimentos** → **Atualizar** | Mesma lista do passo 8 |
| 11 | Cliente | Clicar **Sincronizar** e abrir **Medicamentos** | O medicamento inserido no passo 9 aparece |
| 12 | Cliente | Simulador em **OFFLINE**. Em **Pacientes** → **Novo paciente** → salvar. Na ficha do paciente: preencher o prontuário → **Criar prontuário**. Clicar **Registrar atendimento** → preencher → salvar | Cada gravação mostra "Guardado no dispositivo (offline) e pendente de envio"; contador do botão Sincronizar em **3**; tela **Sincronização** lista as 3 operações |
| 13 | Portal | **Pacientes**, **Prontuários** e **Atendimentos** → **Atualizar** | O paciente, o prontuário e o atendimento novos **não aparecem** |
| 14 | Cliente | Simulador em **ONLINE** | A fila é enviada sozinha (padrão Observer): "Sincronização concluída: 3 enviada(s)"; contador em 0 |
| 15 | Portal | **Pacientes**, **Prontuários**, **Atendimentos** → **Atualizar**; também **Sincronizações** | Os três registros aparecem; Sincronizações mostra as operações **aplicada** com o dispositivo e o profissional |
| 16 | Cliente (ou Portal) | Abrir o atendimento → **Baixar PDF** | Download de `ficha-atendimento-AAAAMMDD-HHMM-xxxx.pdf` com paciente, prontuário, sinais vitais, Glasgow, triagem e medicamentos |
| 17 | Cliente (ou Portal) | Informar um e-mail → **Enviar por e-mail** | "Ficha enviada para …"; o e-mail chega com o PDF anexado |

## Passo 9 – inserir medicamento pelo banco

```bash
ssh univates@177.44.248.50
psql -d medicalfield -c "INSERT INTO medicamento (nome, principio_ativo, apresentacao, concentracao, via_padrao)
VALUES ('Cetoprofeno', 'Cetoprofeno', 'Frasco-ampola', '100 mg', 'IV');"
```

O trigger `controlar_versao` dá ao registro um `seq_alteracao` novo. Por isso ele aparece no próximo pull do cliente, mesmo sem ter passado por nenhuma API.

## Pontos extras para mostrar, se houver tempo

- **Queda real de rede:** desligue o Wi-Fi do notebook com o simulador em ONLINE. O indicador mostra "Sem rede", e o app recarrega a página (Service Worker) e permite login offline.
- **Idempotência:** no Postman, pasta *7. Sincronização*: "Push de ocorrência offline" e depois "Reenviar o mesmo push". O segundo envio devolve `duplicada` para todas as operações.
- **Conflito:**
  1. Edite o nome de uma pessoa no portal.
  2. No cliente, em OFFLINE, edite a mesma pessoa.
  3. Volte para ONLINE.

  O histórico mostra a mensagem da estratégia "última escrita vence". No portal, **Sincronizações → Ver** compara as duas versões campo a campo.
- **Auditoria:** portal > **Auditoria**, com filtro por serviço. Inclui as linhas `app-socorrista` com `origem = cliente`, enviadas pelo `POST /api/log`.

## Execução automática

O mesmo roteiro está automatizado em [testes/e2e/roteiro.spec.js](../testes/e2e/roteiro.spec.js), que usa o Chrome real (Playwright):

```bash
cd testes && npm install && npx playwright test
```

O passo 9 do teste insere o medicamento na VM via `ssh` + `psql`. O passo 17 envia um e-mail de verdade para `EMAIL_TESTE` (padrão: a conta de teste remetente).
