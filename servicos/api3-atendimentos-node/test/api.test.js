// Testes da API 3: sobem o app numa porta livre e usam o banco
// medicalfield_teste (recriado por testes/rodar_testes.sh antes da execução).
// O login é da API 1; aqui o token é gerado com o mesmo segredo compartilhado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';

let servidor;
let base;
let tokenAdmin;
let tokenSocorrista;
let pacienteId;
let medicamentoId;

async function chamar(metodo, caminho, { token, corpo } = {}) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
}

async function tokenDe(numeroRegistro) {
  const { rows } = await pool.query('SELECT id, nome, perfil FROM profissional WHERE numero_registro = $1', [numeroRegistro]);
  const p = rows[0];
  return jwt.sign({ sub: p.id, nome: p.nome, perfil: p.perfil }, process.env.JWT_SEGREDO, { expiresIn: '10m' });
}

function novoAtendimento(extra = {}) {
  const agora = new Date().toISOString();
  return {
    id: randomUUID(),
    paciente_id: pacienteId,
    data_hora: agora,
    tipo_ocorrencia: 'trauma',
    local: 'Rua de Teste, 100',
    descricao: 'Queda de bicicleta com escoriações.',
    pa_sistolica: 120, pa_diastolica: 80, fc: 90, spo2: 98, temperatura: 36.5,
    glasgow_ocular: 4, glasgow_verbal: 5, glasgow_motora: 6,
    manchester: 'verde', start: 'verde',
    medicamentos: [{ medicamento_id: medicamentoId, dose: 1, unidade: 'g', via: 'IV', horario: agora }],
    ...extra,
  };
}

before(async () => {
  assert.equal(process.env.DB_NOME, 'medicalfield_teste', 'os testes devem usar o banco de teste');
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
  tokenAdmin = await tokenDe('admin');
  tokenSocorrista = await tokenDe('SOC-0042');
  pacienteId = (await pool.query("SELECT id FROM paciente WHERE cpf = '11122233344'")).rows[0].id;
  medicamentoId = (await pool.query("SELECT id FROM medicamento WHERE nome = 'Dipirona sódica'")).rows[0].id;
});

after(async () => {
  servidor.close();
  await pool.end();
});

test('rotas exigem token', async () => {
  assert.equal((await chamar('GET', '/api/pessoa')).status, 401);
  assert.equal((await chamar('GET', '/api/atendimento', { token: 'token-falso' })).status, 401);
});

test('lista os dados de demonstração', async () => {
  const pessoas = await chamar('GET', '/api/pessoa', { token: tokenSocorrista });
  assert.equal(pessoas.status, 200);
  assert.ok(pessoas.corpo.length >= 5);
  const medicamentos = await chamar('GET', '/api/medicamento', { token: tokenSocorrista });
  assert.ok(medicamentos.corpo.length >= 10);
});

test('CRUD de pessoa com controle de versão e exclusão lógica', async () => {
  const id = randomUUID();
  const criada = await chamar('POST', '/api/pessoa', {
    token: tokenSocorrista,
    corpo: { id, nome: 'Paciente de Teste', cpf: '987.654.321-00', sexo: 'M' },
  });
  assert.equal(criada.status, 201);
  assert.equal(criada.corpo.cpf, '98765432100');
  assert.equal(criada.corpo.versao, 1);

  // reenviar o mesmo POST não duplica
  const repetida = await chamar('POST', '/api/pessoa', { token: tokenSocorrista, corpo: { id, nome: 'Outro' } });
  assert.equal(repetida.status, 409);

  const editada = await chamar('PUT', `/api/pessoa/${id}`, {
    token: tokenSocorrista,
    corpo: { nome: 'Paciente Editado', sexo: 'M', versao_base: 1 },
  });
  assert.equal(editada.status, 200);
  assert.equal(editada.corpo.versao, 2);

  // edição baseada na versão antiga gera conflito
  const conflito = await chamar('PUT', `/api/pessoa/${id}`, {
    token: tokenSocorrista,
    corpo: { nome: 'Edição atrasada', versao_base: 1 },
  });
  assert.equal(conflito.status, 409);
  assert.equal(conflito.corpo.atual.nome, 'Paciente Editado');

  // socorrista não exclui; admin sim, e o registro continua no banco
  assert.equal((await chamar('DELETE', `/api/pessoa/${id}`, { token: tokenSocorrista })).status, 403);
  assert.equal((await chamar('DELETE', `/api/pessoa/${id}`, { token: tokenAdmin })).status, 200);
  const lista = await chamar('GET', '/api/pessoa?busca=Editado', { token: tokenAdmin });
  assert.equal(lista.corpo.length, 0);
  const noBanco = await pool.query('SELECT excluido_em FROM paciente WHERE id = $1', [id]);
  assert.ok(noBanco.rows[0].excluido_em);
});

test('validação de pessoa devolve mensagens compreensíveis', async () => {
  const r = await chamar('POST', '/api/pessoa', { token: tokenSocorrista, corpo: { cpf: '123', sexo: 'X' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.corpo.detalhes, ['Nome é obrigatório', 'CPF deve ter 11 dígitos', 'Sexo deve ser M, F ou O']);
});

test('somente admin cadastra medicamentos', async () => {
  const medicamento = { nome: 'Medicamento de Teste' };
  assert.equal((await chamar('POST', '/api/medicamento', { token: tokenSocorrista, corpo: medicamento })).status, 403);
  assert.equal((await chamar('POST', '/api/medicamento', { token: tokenAdmin, corpo: medicamento })).status, 201);
});

test('cria e consulta atendimento por id', async () => {
  const corpo = novoAtendimento();
  const criado = await chamar('POST', '/api/atendimento', { token: tokenSocorrista, corpo });
  assert.equal(criado.status, 201, JSON.stringify(criado.corpo));
  assert.equal(criado.corpo.glasgow_total, 15);
  assert.equal(criado.corpo.temperatura, 36.5);
  assert.ok(criado.corpo.prontuario_id, 'deve usar o prontuário do paciente');
  assert.equal(criado.corpo.profissional_nome, 'Socorrista Teste');
  assert.equal(criado.corpo.medicamentos[0].medicamento_nome, 'Dipirona sódica');

  const porId = await chamar('GET', `/api/atendimento/${corpo.id}`, { token: tokenSocorrista });
  assert.equal(porId.status, 200);
  assert.equal(porId.corpo.descricao, corpo.descricao);

  const doPaciente = await chamar('GET', `/api/atendimento?paciente_id=${pacienteId}`, { token: tokenSocorrista });
  assert.ok(doPaciente.corpo.some((a) => a.id === corpo.id));

  assert.equal((await chamar('POST', '/api/atendimento', { token: tokenSocorrista, corpo })).status, 409);
});

test('validação de atendimento', async () => {
  const r = await chamar('POST', '/api/atendimento', {
    token: tokenSocorrista,
    corpo: novoAtendimento({ manchester: 'roxo', spo2: 150, glasgow_verbal: null }),
  });
  assert.equal(r.status, 400);
  const texto = r.corpo.detalhes.join(' | ');
  assert.match(texto, /spo2: deve estar entre 0 e 100/);
  assert.match(texto, /manchester/);
  assert.match(texto, /Escala de Glasgow/);

  const semPaciente = await chamar('POST', '/api/atendimento', {
    token: tokenSocorrista,
    corpo: novoAtendimento({ paciente_id: randomUUID() }),
  });
  assert.equal(semPaciente.status, 400);
});

test('atendimento: controle de versão e exclusão lógica', async () => {
  const corpo = novoAtendimento();
  await chamar('POST', '/api/atendimento', { token: tokenSocorrista, corpo });

  const editado = await chamar('PUT', `/api/atendimento/${corpo.id}`, {
    token: tokenSocorrista,
    corpo: { ...corpo, descricao: 'Descrição revisada', medicamentos: [], versao_base: 1 },
  });
  assert.equal(editado.status, 200);
  assert.equal(editado.corpo.versao, 2);
  assert.deepEqual(editado.corpo.medicamentos, []);

  const conflito = await chamar('PUT', `/api/atendimento/${corpo.id}`, { token: tokenSocorrista, corpo: { ...corpo, versao_base: 1 } });
  assert.equal(conflito.status, 409);
  assert.equal(conflito.corpo.atual.descricao, 'Descrição revisada');

  assert.equal((await chamar('DELETE', `/api/atendimento/${corpo.id}`, { token: tokenSocorrista })).status, 403);
  assert.equal((await chamar('DELETE', `/api/atendimento/${corpo.id}`, { token: tokenAdmin })).status, 200);
  assert.equal((await chamar('GET', `/api/atendimento/${corpo.id}`, { token: tokenAdmin })).status, 404);
});

test('cada requisição gera log com profissional, status e duração', async () => {
  await chamar('GET', '/api/medicamento', { token: tokenSocorrista });
  await new Promise((resolve) => setTimeout(resolve, 100));
  // mf_api3 só insere logs; a leitura é feita com o usuário administrador do banco
  const admin = new pg.Client({ host: '/var/run/postgresql', database: 'medicalfield_teste' });
  await admin.connect();
  const { rows } = await admin.query(
    `SELECT l.* FROM log_acesso l JOIN profissional p ON p.id = l.profissional_id
     WHERE l.servico = 'api3' AND l.rota = '/api/medicamento' AND p.numero_registro = 'SOC-0042'
     ORDER BY l.id DESC LIMIT 1`,
  );
  await admin.end();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metodo, 'GET');
  assert.equal(rows[0].status, 200);
  assert.ok(Number(rows[0].duracao_ms) > 0);
  assert.ok(rows[0].ip);
});
