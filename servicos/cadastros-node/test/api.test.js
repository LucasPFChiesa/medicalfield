// Testes de integração: sobem o app numa porta livre e usam o banco
// medicalfield_teste (recriado por testes/rodar_testes.sh antes da execução).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';

let servidor;
let base;
let tokenAdmin;
let tokenSocorrista;

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

async function entrar(tipo_registro, numero_registro) {
  const r = await chamar('POST', '/api/auth/login', {
    corpo: { tipo_registro, numero_registro, senha: process.env.SENHA_DEMO },
  });
  assert.equal(r.status, 200);
  return r.corpo.token;
}

before(async () => {
  assert.equal(process.env.DB_NOME, 'medicalfield_teste', 'os testes devem usar o banco de teste');
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
  tokenAdmin = await entrar('CRM', 'admin');
  tokenSocorrista = await entrar('SOCORRISTA', 'SOC-0042');
});

after(async () => {
  servidor.close();
  await pool.end();
});

test('login com senha errada é recusado', async () => {
  const r = await chamar('POST', '/api/auth/login', {
    corpo: { tipo_registro: 'CRM', numero_registro: 'admin', senha: 'errada' },
  });
  assert.equal(r.status, 401);
  assert.equal(r.corpo.token, undefined);
});

test('rotas exigem token', async () => {
  assert.equal((await chamar('GET', '/api/pessoa')).status, 401);
  assert.equal((await chamar('GET', '/api/pessoa', { token: 'token-falso' })).status, 401);
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

test('validação devolve mensagens compreensíveis', async () => {
  const r = await chamar('POST', '/api/pessoa', {
    token: tokenSocorrista,
    corpo: { cpf: '123', sexo: 'X' },
  });
  assert.equal(r.status, 400);
  assert.deepEqual(r.corpo.detalhes, ['Nome é obrigatório', 'CPF deve ter 11 dígitos', 'Sexo deve ser M, F ou O']);
});

test('prontuário é obtido pelo id da pessoa e é único por pessoa', async () => {
  const pessoa = await chamar('POST', '/api/pessoa', { token: tokenSocorrista, corpo: { nome: 'Com Prontuário' } });
  const pront = await chamar('POST', '/api/prontuario', {
    token: tokenSocorrista,
    corpo: { paciente_id: pessoa.corpo.id, tipo_sanguineo: 'O-', alergias: 'Látex' },
  });
  assert.equal(pront.status, 201);

  const porPessoa = await chamar('GET', `/api/prontuario/${pessoa.corpo.id}`, { token: tokenSocorrista });
  assert.equal(porPessoa.status, 200);
  assert.equal(porPessoa.corpo.id, pront.corpo.id);
  assert.equal(porPessoa.corpo.paciente_nome, 'Com Prontuário');

  const segundo = await chamar('POST', '/api/prontuario', { token: tokenSocorrista, corpo: { paciente_id: pessoa.corpo.id } });
  assert.equal(segundo.status, 409);
  assert.equal(segundo.corpo.erro, 'Este paciente já possui prontuário');
});

test('somente admin cadastra medicamentos e profissionais', async () => {
  const medicamento = { nome: 'Medicamento de Teste' };
  assert.equal((await chamar('POST', '/api/medicamento', { token: tokenSocorrista, corpo: medicamento })).status, 403);
  assert.equal((await chamar('POST', '/api/medicamento', { token: tokenAdmin, corpo: medicamento })).status, 201);
  assert.equal((await chamar('GET', '/api/profissional', { token: tokenSocorrista })).status, 403);

  const novo = await chamar('POST', '/api/profissional', {
    token: tokenAdmin,
    corpo: { nome: 'Novo Socorrista', tipo_registro: 'SOCORRISTA', numero_registro: 'SOC-TESTE', perfil: 'socorrista', senha: 'senha-teste' },
  });
  assert.equal(novo.status, 201);
  assert.equal(novo.corpo.senha_hash, undefined);
  const login = await chamar('POST', '/api/auth/login', {
    corpo: { tipo_registro: 'SOCORRISTA', numero_registro: 'SOC-TESTE', senha: 'senha-teste' },
  });
  assert.equal(login.status, 200);
});

test('cada requisição gera log com profissional, status e duração', async () => {
  await chamar('GET', '/api/medicamento', { token: tokenSocorrista });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const { rows } = await pool.query(
    `SELECT l.* FROM log_acesso l JOIN profissional p ON p.id = l.profissional_id
     WHERE l.servico = 'cadastros' AND l.rota = '/api/medicamento' AND p.numero_registro = 'SOC-0042'
     ORDER BY l.id DESC LIMIT 1`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metodo, 'GET');
  assert.equal(rows[0].status, 200);
  assert.ok(Number(rows[0].duracao_ms) > 0);
  assert.ok(rows[0].ip);
});
