import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { dadosPublicos } from './auth.js';

// Profissionais não são excluídos: são desativados (ativo = false), pois
// continuam sendo responsáveis pelos atendimentos que registraram.
export const rotasProfissionais = Router();

const COLUNAS = 'id, nome, tipo_registro, numero_registro, perfil, email, ativo';

function validar(d, criando) {
  const erros = [];
  if (!d.nome) erros.push('Nome é obrigatório');
  if (!['CRM', 'COREN', 'SOCORRISTA'].includes(d.tipo_registro)) erros.push('Tipo de registro deve ser CRM, COREN ou SOCORRISTA');
  if (!d.numero_registro) erros.push('Número de registro é obrigatório');
  if (!['admin', 'medico', 'enfermeiro', 'socorrista'].includes(d.perfil)) erros.push('Perfil inválido');
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) erros.push('E-mail inválido');
  if ((criando || d.senha) && String(d.senha ?? '').length < 6) erros.push('Senha deve ter pelo menos 6 caracteres');
  return erros;
}

rotasProfissionais.get('/', async (req, res) => {
  const { rows } = await pool.query(`SELECT ${COLUNAS} FROM profissional ORDER BY nome`);
  res.json(rows);
});

rotasProfissionais.get('/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT ${COLUNAS} FROM profissional WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: 'Profissional não encontrado' });
  res.json(rows[0]);
});

rotasProfissionais.post('/', async (req, res) => {
  const d = req.body ?? {};
  const erros = validar(d, true);
  if (erros.length) return res.status(400).json({ erro: 'Dados inválidos', detalhes: erros });

  const hash = await bcrypt.hash(String(d.senha), 10);
  const { rows } = await pool.query(
    `INSERT INTO profissional (nome, tipo_registro, numero_registro, senha_hash, perfil, email)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [d.nome, d.tipo_registro, String(d.numero_registro).trim(), hash, d.perfil, d.email || null],
  );
  res.status(201).json(dadosPublicos(rows[0]));
});

rotasProfissionais.put('/:id', async (req, res) => {
  const d = req.body ?? {};
  const erros = validar(d, false);
  if (erros.length) return res.status(400).json({ erro: 'Dados inválidos', detalhes: erros });

  const hash = d.senha ? await bcrypt.hash(String(d.senha), 10) : null;
  const { rows } = await pool.query(
    `UPDATE profissional SET nome = $2, tipo_registro = $3, numero_registro = $4, perfil = $5,
            email = $6, ativo = COALESCE($7, ativo), senha_hash = COALESCE($8, senha_hash)
     WHERE id = $1 RETURNING *`,
    [req.params.id, d.nome, d.tipo_registro, String(d.numero_registro).trim(), d.perfil,
      d.email || null, typeof d.ativo === 'boolean' ? d.ativo : null, hash],
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Profissional não encontrado' });
  res.json(dadosPublicos(rows[0]));
});

rotasProfissionais.delete('/:id', async (req, res) => {
  if (req.params.id === req.profissional.sub) {
    return res.status(400).json({ erro: 'Não é possível desativar o próprio usuário' });
  }
  const { rows } = await pool.query(
    'UPDATE profissional SET ativo = false WHERE id = $1 RETURNING *',
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Profissional não encontrado' });
  res.json(dadosPublicos(rows[0]));
});

export async function listarAuditoria(req, res) {
  const limite = Math.min(Number(req.query.limite) || 100, 500);
  const params = [limite];
  let filtro = '';
  if (req.query.servico) {
    params.push(req.query.servico);
    filtro = 'WHERE l.servico = $2';
  }
  const { rows } = await pool.query(
    `SELECT l.*, p.nome AS profissional_nome
     FROM log_acesso l LEFT JOIN profissional p ON p.id = l.profissional_id
     ${filtro} ORDER BY l.id DESC LIMIT $1`,
    params,
  );
  res.json(rows);
}
