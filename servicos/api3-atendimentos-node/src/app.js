import express from 'express';
import { readFileSync } from 'node:fs';
import { registrarAcesso } from './log.js';
import { verificarToken } from './auth.js';
import { rotasPacientes, rotasMedicamentos } from './cadastros.js';
import { rotasAtendimentos, ErroRegra } from './atendimentos.js';

// API 3 - Pessoas, medicamentos e atendimentos (Node.js / Express)
//   GET  /api/medicamento        catálogo de medicamentos
//   POST /api/pessoa             cadastro de pessoas (pacientes)
//   GET  /api/atendimento/{id}   um atendimento com os medicamentos administrados
//   POST /api/atendimento        cadastro de atendimentos
// Também tem o restante do CRUD dessas entidades, usado pelo portal e pela
// sincronização (a API 2 grava pessoas e atendimentos vindos do app por aqui).

const especificacao = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url)));

export const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));

// Cadeia de middlewares: log -> token -> (perfil, em algumas rotas) -> rota.
app.use(registrarAcesso);

app.get('/api/openapi/api3.json', (req, res) => res.json(especificacao));

app.use('/api', verificarToken);
app.use('/api/pessoa', rotasPacientes);
app.use('/api/medicamento', rotasMedicamentos);
app.use('/api/atendimento', rotasAtendimentos);

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

const MENSAGENS_RESTRICAO = {
  paciente_cpf_unico: 'Já existe um paciente com este CPF',
};

const ERROS_POSTGRES = {
  23505: [409, 'Registro duplicado'],
  23503: [400, 'Registro relacionado não existe (paciente, prontuário ou medicamento)'],
  23514: [400, 'Valor fora do permitido'],
  '22P02': [400, 'Formato de dado inválido'],
  22007: [400, 'Data inválida'],
  22008: [400, 'Data inválida'],
};

app.use((erro, req, res, next) => {
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido' });
  }
  if (erro instanceof ErroRegra) {
    return res.status(400).json({ erro: erro.message });
  }
  if (ERROS_POSTGRES[erro.code]) {
    const [status, mensagem] = ERROS_POSTGRES[erro.code];
    return res.status(status).json({ erro: MENSAGENS_RESTRICAO[erro.constraint] ?? mensagem });
  }
  console.error(erro);
  res.status(500).json({ erro: 'Erro interno na API 3' });
});
