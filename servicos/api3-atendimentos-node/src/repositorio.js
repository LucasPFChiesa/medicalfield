import { pool } from './db.js';

// Repository: as rotas pedem "listar", "buscar", "salvar" e "excluir" sem
// escrever SQL. A consulta base pode ter JOIN (ex.: nome do paciente no
// prontuário); por isso ela é usada como subconsulta.
export function criarRepositorio({ tabela, colunas, consulta = `SELECT * FROM ${tabela}`, ordem = 'nome', camposBusca = [], registraCriador = false }) {
  return {
    async listar(busca) {
      const params = [];
      let filtro = '';
      if (busca && camposBusca.length) {
        params.push(`%${busca}%`);
        filtro = ' AND (' + camposBusca.map((c) => `${c}::text ILIKE $1`).join(' OR ') + ')';
      }
      const { rows } = await pool.query(
        `SELECT * FROM (${consulta}) t WHERE excluido_em IS NULL${filtro} ORDER BY ${ordem}`,
        params,
      );
      return rows;
    },

    async buscar(id) {
      const { rows } = await pool.query(`SELECT * FROM (${consulta}) t WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async buscarPor(coluna, valor) {
      const { rows } = await pool.query(
        `SELECT * FROM (${consulta}) t WHERE ${coluna} = $1 AND excluido_em IS NULL`,
        [valor],
      );
      return rows[0] ?? null;
    },

    // Cria ou substitui o registro com o id informado (o id vem do cliente,
    // o que permite reenviar a mesma gravação sem duplicar).
    // versaoBase: versão que o cliente tinha ao editar. Se o registro mudou
    // desde então, nada é gravado e o registro atual é devolvido como conflito.
    async salvar(id, dados, { versaoBase = null, somenteCriar = false, profissionalId = null } = {}) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const { rows } = await cliente.query(`SELECT * FROM ${tabela} WHERE id = $1 FOR UPDATE`, [id]);
        const atual = rows[0];

        if (atual && (somenteCriar || atual.excluido_em || (versaoBase !== null && atual.versao !== versaoBase))) {
          await cliente.query('ROLLBACK');
          return { conflito: true, atual };
        }

        const valores = colunas.map((c) => dados[c] ?? null);
        let resultado;
        if (atual) {
          const sets = colunas.map((c, i) => `${c} = $${i + 2}`).join(', ');
          resultado = await cliente.query(
            `UPDATE ${tabela} SET ${sets} WHERE id = $1 RETURNING *`,
            [id, ...valores],
          );
        } else {
          const extras = registraCriador ? ['criado_por'] : [];
          const todas = ['id', ...colunas, ...extras];
          const marcadores = todas.map((_, i) => `$${i + 1}`).join(', ');
          resultado = await cliente.query(
            `INSERT INTO ${tabela} (${todas.join(', ')}) VALUES (${marcadores}) RETURNING *`,
            [id, ...valores, ...extras.map(() => profissionalId)],
          );
        }
        await cliente.query('COMMIT');
        return { criado: !atual, registro: resultado.rows[0] };
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw erro;
      } finally {
        cliente.release();
      }
    },

    async excluir(id) {
      const { rows } = await pool.query(
        `UPDATE ${tabela} SET excluido_em = now() WHERE id = $1 AND excluido_em IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },
  };
}

