import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const TIPOS_REGISTRO = ['CRM', 'COREN', 'SOCORRISTA'];

function segredo() {
  if (!process.env.JWT_SEGREDO) throw new Error('JWT_SEGREDO não configurado');
  return process.env.JWT_SEGREDO;
}

export function dadosPublicos(p) {
  return {
    id: p.id,
    nome: p.nome,
    tipo_registro: p.tipo_registro,
    numero_registro: p.numero_registro,
    perfil: p.perfil,
    email: p.email,
    ativo: p.ativo,
  };
}

export async function login(req, res) {
  const { tipo_registro, numero_registro, senha } = req.body ?? {};
  if (!TIPOS_REGISTRO.includes(tipo_registro) || !numero_registro || !senha) {
    return res.status(400).json({ erro: 'Informe tipo de registro (CRM, COREN ou SOCORRISTA), número e senha' });
  }

  const { rows } = await pool.query(
    'SELECT * FROM profissional WHERE tipo_registro = $1 AND numero_registro = $2 AND ativo',
    [tipo_registro, String(numero_registro).trim()],
  );
  const profissional = rows[0];
  if (!profissional || !(await bcrypt.compare(String(senha), profissional.senha_hash))) {
    return res.status(401).json({ erro: 'Registro ou senha incorretos' });
  }

  const token = jwt.sign(
    { sub: profissional.id, nome: profissional.nome, perfil: profissional.perfil },
    segredo(),
    { expiresIn: '8h' },
  );
  req.profissional = { sub: profissional.id };
  res.json({ token, profissional: dadosPublicos(profissional) });
}

export function verificarToken(req, res, next) {
  const [tipo, token] = (req.headers.authorization ?? '').split(' ');
  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token não informado' });
  }
  try {
    req.profissional = jwt.verify(token, segredo());
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

export function permitir(...perfis) {
  return (req, res, next) => {
    if (!perfis.includes(req.profissional.perfil)) {
      return res.status(403).json({ erro: 'Seu perfil não tem permissão para esta operação' });
    }
    next();
  };
}
