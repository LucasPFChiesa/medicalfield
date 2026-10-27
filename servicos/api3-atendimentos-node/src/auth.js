import jwt from 'jsonwebtoken';

// O token é emitido pela API 1 (POST /api/auth/login). Aqui ele só é
// validado com o mesmo segredo (JWT_SEGREDO), sem consultar a API 1.

function segredo() {
  if (!process.env.JWT_SEGREDO) throw new Error('JWT_SEGREDO não configurado');
  return process.env.JWT_SEGREDO;
}

// Middleware: exige "Authorization: Bearer <token>" e guarda os dados do
// profissional em req.profissional para as rotas e para o log de acesso.
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
