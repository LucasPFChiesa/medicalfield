import express from 'express';
import { readFileSync } from 'node:fs';
import { registrarAcesso } from './log.js';
import { login, verificarToken, permitir } from './auth.js';
import { rotasPacientes, rotasProntuarios, rotasMedicamentos } from './cadastros.js';
import { rotasProfissionais, listarAuditoria } from './profissionais.js';

const especificacao = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url)));

export const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));

// Cadeia de middlewares: log -> (login público) -> token -> perfil -> rota.
app.use(registrarAcesso);

app.get('/api/openapi/cadastros.json', (req, res) => res.json(especificacao));
app.post('/api/auth/login', login);

app.use('/api', verificarToken);
app.get('/api/auth/eu', (req, res) => res.json(req.profissional));
app.use('/api/pessoa', rotasPacientes);
app.use('/api/prontuario', rotasProntuarios);
app.use('/api/medicamento', rotasMedicamentos);
app.use('/api/profissional', permitir('admin'), rotasProfissionais);
app.get('/api/auditoria', permitir('admin'), listarAuditoria);

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

const MENSAGENS_RESTRICAO = {
  paciente_cpf_unico: 'Já existe um paciente com este CPF',
  prontuario_paciente_unico: 'Este paciente já possui prontuário',
  profissional_tipo_registro_numero_registro_key: 'Este registro profissional já está cadastrado',
};

const ERROS_POSTGRES = {
  23505: [409, 'Registro duplicado'],
  23503: [400, 'Registro relacionado não existe'],
  23514: [400, 'Valor fora do permitido'],
  '22P02': [400, 'Formato de dado inválido'],
  22007: [400, 'Data inválida'],
  22008: [400, 'Data inválida'],
};

app.use((erro, req, res, next) => {
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido' });
  }
  if (ERROS_POSTGRES[erro.code]) {
    const [status, mensagem] = ERROS_POSTGRES[erro.code];
    return res.status(status).json({ erro: MENSAGENS_RESTRICAO[erro.constraint] ?? mensagem });
  }
  console.error(erro);
  res.status(500).json({ erro: 'Erro interno no serviço de cadastros' });
});
