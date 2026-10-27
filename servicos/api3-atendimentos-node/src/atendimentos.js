import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { permitir } from './auth.js';
import { prepararDados } from './crud.js';

// Atendimentos da API 3: sinais vitais, Escala de Glasgow, Manchester, START
// e medicamentos administrados. O PDF e o e-mail da ficha são da API 1, que
// lê estes mesmos dados direto do banco.

// ---------- Repository ----------

const CAMPOS = [
  'paciente_id', 'prontuario_id', 'data_hora', 'tipo_ocorrencia', 'local', 'descricao',
  'pa_sistolica', 'pa_diastolica', 'fc', 'fr', 'spo2', 'temperatura', 'glicemia',
  'glasgow_ocular', 'glasgow_verbal', 'glasgow_motora', 'manchester', 'start',
  'alterado_no_cliente_em',
];

const CONSULTA = `
  SELECT a.*, pa.nome AS paciente_nome, pr.nome AS profissional_nome,
         pr.tipo_registro || ' ' || pr.numero_registro AS profissional_registro
  FROM atendimento a
  JOIN paciente pa ON pa.id = a.paciente_id
  JOIN profissional pr ON pr.id = a.profissional_id`;

export async function listarAtendimentos(pacienteId) {
  const params = pacienteId ? [pacienteId] : [];
  const filtro = pacienteId ? ' AND a.paciente_id = $1' : '';
  const { rows } = await pool.query(
    `${CONSULTA} WHERE a.excluido_em IS NULL${filtro} ORDER BY a.data_hora DESC, a.criado_em DESC`,
    params,
  );
  return rows;
}

export async function buscarAtendimento(id, conexao = pool) {
  const { rows } = await conexao.query(`${CONSULTA} WHERE a.id = $1`, [id]);
  const atendimento = rows[0];
  if (atendimento) {
    const medicamentos = await conexao.query(
      `SELECT ma.*, m.nome AS medicamento_nome
       FROM medicamento_administrado ma JOIN medicamento m ON m.id = ma.medicamento_id
       WHERE ma.atendimento_id = $1 ORDER BY ma.horario`,
      [id],
    );
    atendimento.medicamentos = medicamentos.rows;
  }
  return atendimento ?? null;
}

class ErroRegra extends Error {}

// Se o prontuário não veio, usa o prontuário ativo do paciente; se veio,
// confere se ele é mesmo desse paciente.
async function conferirProntuario(cliente, dados) {
  if (!dados.prontuario_id) {
    const { rows } = await cliente.query(
      'SELECT id FROM prontuario WHERE paciente_id = $1 AND excluido_em IS NULL', [dados.paciente_id]);
    dados.prontuario_id = rows[0]?.id ?? null;
    return;
  }
  const { rows } = await cliente.query('SELECT paciente_id FROM prontuario WHERE id = $1', [dados.prontuario_id]);
  if (rows[0] && rows[0].paciente_id !== dados.paciente_id) {
    throw new ErroRegra('O prontuário informado não pertence a este paciente');
  }
}

// Cria ou substitui o atendimento e a lista de medicamentos numa única transação.
// Com versaoBase, só grava se ninguém alterou o registro depois que o cliente o leu.
async function salvarAtendimento(id, dados, { profissionalId, versaoBase = null, somenteCriar = false }) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query('SELECT * FROM atendimento WHERE id = $1 FOR UPDATE', [id]);
    const atual = rows[0];
    if (atual && (somenteCriar || atual.excluido_em || (versaoBase !== null && atual.versao !== versaoBase))) {
      await cliente.query('ROLLBACK');
      return { conflito: true, atual: await buscarAtendimento(id) };
    }

    await conferirProntuario(cliente, dados);
    const valores = CAMPOS.map((c) => dados[c] ?? null);
    if (atual) {
      const sets = CAMPOS.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await cliente.query(`UPDATE atendimento SET ${sets} WHERE id = $1`, [id, ...valores]);
      await cliente.query('DELETE FROM medicamento_administrado WHERE atendimento_id = $1', [id]);
    } else {
      const colunas = ['id', 'profissional_id', ...CAMPOS];
      const marcadores = colunas.map((_, i) => `$${i + 1}`).join(', ');
      await cliente.query(
        `INSERT INTO atendimento (${colunas.join(', ')}) VALUES (${marcadores})`,
        [id, dados.profissional_id || profissionalId, ...valores],
      );
    }
    for (const m of dados.medicamentos ?? []) {
      await cliente.query(
        `INSERT INTO medicamento_administrado (id, atendimento_id, medicamento_id, dose, unidade, via, horario, observacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [m.id || randomUUID(), id, m.medicamento_id, m.dose, m.unidade, m.via ?? null, m.horario, m.observacao ?? null],
      );
    }
    const registro = await buscarAtendimento(id, cliente);
    await cliente.query('COMMIT');
    return { criado: !atual, registro };
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}

async function excluirAtendimento(id) {
  const { rows } = await pool.query(
    'UPDATE atendimento SET excluido_em = now() WHERE id = $1 AND excluido_em IS NULL RETURNING id', [id]);
  return rows[0] ?? null;
}

// ---------- Validação ----------

const TIPOS_OCORRENCIA = ['clinica', 'trauma', 'acidente_transito', 'queda', 'obstetrica', 'psiquiatrica', 'outra'];
const MANCHESTER = ['vermelho', 'laranja', 'amarelo', 'verde', 'azul'];
const START = ['vermelho', 'amarelo', 'verde', 'preto'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limites só para barrar erro de digitação; não são regras clínicas.
const NUMEROS = {
  pa_sistolica: [0, 300], pa_diastolica: [0, 250], fc: [0, 300], fr: [0, 100], spo2: [0, 100],
  temperatura: [25, 45], glicemia: [0, 1000], glasgow_ocular: [1, 4], glasgow_verbal: [1, 5], glasgow_motora: [1, 6],
};

const dataHoraValida = (texto) => typeof texto === 'string' && !Number.isNaN(Date.parse(texto));

function validarAtendimento(d) {
  const erros = [];
  if (!UUID.test(d.paciente_id ?? '')) erros.push('paciente_id: campo obrigatório');
  if (!dataHoraValida(d.data_hora)) erros.push('data_hora: data e hora inválidas');
  if (!TIPOS_OCORRENCIA.includes(d.tipo_ocorrencia)) erros.push(`tipo_ocorrencia: deve ser ${TIPOS_OCORRENCIA.join(', ')}`);
  if (!d.descricao || d.descricao.length < 3) erros.push('descricao: deve ter pelo menos 3 caracteres');

  for (const [campo, [minimo, maximo]] of Object.entries(NUMEROS)) {
    const valor = d[campo];
    if (valor === null || valor === undefined) continue;
    const inteiro = campo !== 'temperatura';
    if (typeof valor !== 'number' || (inteiro && !Number.isInteger(valor))) erros.push(`${campo}: deve ser um número${inteiro ? ' inteiro' : ''}`);
    else if (valor < minimo || valor > maximo) erros.push(`${campo}: deve estar entre ${minimo} e ${maximo}`);
  }
  const glasgow = [d.glasgow_ocular, d.glasgow_verbal, d.glasgow_motora].map((v) => v ?? null);
  if (glasgow.some((v) => v !== null) && glasgow.some((v) => v === null)) {
    erros.push('Informe os três componentes da Escala de Glasgow (ocular, verbal e motora)');
  }
  if (d.manchester && !MANCHESTER.includes(d.manchester)) erros.push(`manchester: deve ser ${MANCHESTER.join(', ')}`);
  if (d.start && !START.includes(d.start)) erros.push(`start: deve ser ${START.join(', ')}`);

  if (!Array.isArray(d.medicamentos ?? [])) erros.push('medicamentos: deve ser uma lista');
  (Array.isArray(d.medicamentos) ? d.medicamentos : []).forEach((m, i) => {
    if (!UUID.test(m.medicamento_id ?? '')) erros.push(`medicamentos.${i}.medicamento_id: campo obrigatório`);
    if (typeof m.dose !== 'number' || m.dose <= 0) erros.push(`medicamentos.${i}.dose: deve ser maior que 0`);
    if (!m.unidade || m.unidade.length > 20) erros.push(`medicamentos.${i}.unidade: campo obrigatório (até 20 letras)`);
    if (!dataHoraValida(m.horario)) erros.push(`medicamentos.${i}.horario: data e hora inválidas`);
  });
  return erros;
}

// ---------- Rotas ----------

export const rotasAtendimentos = Router();

rotasAtendimentos.get('/', async (req, res) => {
  res.json(await listarAtendimentos(req.query.paciente_id));
});

rotasAtendimentos.get('/:id', async (req, res) => {
  const atendimento = await buscarAtendimento(req.params.id);
  if (!atendimento || atendimento.excluido_em) return res.status(404).json({ erro: 'Atendimento não encontrado' });
  res.json(atendimento);
});

rotasAtendimentos.post('/', async (req, res) => {
  const dados = prepararDados(req.body);
  const erros = validarAtendimento(dados);
  if (erros.length) return res.status(400).json({ erro: 'Dados inválidos', detalhes: erros });

  const resultado = await salvarAtendimento(dados.id ?? randomUUID(), dados, {
    profissionalId: req.profissional.sub,
    somenteCriar: true,
  });
  if (resultado.conflito) return res.status(409).json({ erro: 'Já existe um atendimento com este id' });
  res.status(201).json(resultado.registro);
});

// Usado pelo portal (edição) e pela API 2 na sincronização (cria ou atualiza).
rotasAtendimentos.put('/:id', async (req, res) => {
  const dados = prepararDados(req.body);
  const erros = validarAtendimento(dados);
  if (erros.length) return res.status(400).json({ erro: 'Dados inválidos', detalhes: erros });

  const versaoBase = Number.isInteger(dados.versao_base) ? dados.versao_base : null;
  const resultado = await salvarAtendimento(req.params.id, dados, { profissionalId: req.profissional.sub, versaoBase });
  if (resultado.conflito) {
    const { atual } = resultado;
    return res.status(409).json({
      erro: atual.excluido_em
        ? 'O atendimento foi excluído'
        : `O atendimento foi alterado por outra pessoa (versão atual: ${atual.versao})`,
      atual,
    });
  }
  res.status(resultado.criado ? 201 : 200).json(resultado.registro);
});

rotasAtendimentos.delete('/:id', permitir('admin'), async (req, res) => {
  if (!(await excluirAtendimento(req.params.id))) return res.status(404).json({ erro: 'Atendimento não encontrado' });
  res.json({ id: req.params.id, excluido: true });
});

// Erro de regra (prontuário de outro paciente) vira 400 no tratador do app.js.
export { ErroRegra };
