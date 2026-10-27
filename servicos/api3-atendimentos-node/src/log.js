import { pool } from './db.js';

// Middleware de auditoria: roda em toda requisição e grava o acesso quando a
// resposta termina. A query string fica de fora para não registrar dados
// clínicos usados em buscas.
export function registrarAcesso(req, res, next) {
  const inicio = process.hrtime.bigint();

  res.on('finish', () => {
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    const rota = req.originalUrl.split('?')[0];
    const profissionalId = req.profissional?.sub ?? null;

    console.log(`${new Date().toISOString()} ${req.ip} ${profissionalId ?? '-'} ${req.method} ${rota} ${res.statusCode} ${duracaoMs.toFixed(1)}ms`);

    pool.query(
      `INSERT INTO log_acesso (servico, ip, profissional_id, metodo, rota, status, duracao_ms)
       VALUES ('api3', $1, $2, $3, $4, $5, $6)`,
      [req.ip, profissionalId, req.method, rota, res.statusCode, duracaoMs.toFixed(2)],
    ).catch((erro) => console.error('Falha ao gravar log de acesso:', erro.message));
  });

  next();
}
