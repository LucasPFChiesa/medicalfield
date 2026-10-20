// Teste de integração dos três serviços rodando juntos (ver rodar_testes.sh).
// Simula o app do socorrista: baixa dados, envia a fila feita offline,
// reenvia (idempotência) e provoca conflitos de versão.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const CADASTROS = process.env.URL_CADASTROS;
const ATENDIMENTOS = process.env.URL_ATENDIMENTOS;
const SYNC = process.env.URL_SYNC;
const DISPOSITIVO = 'teste-integracao';

let socorrista;
let admin;

async function chamar(base, metodo, caminho, token, corpo) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
}

async function entrar(tipo_registro, numero_registro) {
  const r = await chamar(CADASTROS, 'POST', '/api/auth/login', null, { tipo_registro, numero_registro, senha: process.env.SENHA_DEMO });
  assert.equal(r.status, 200);
  return r.corpo.token;
}

const enviar = (operacoes, token = socorrista) =>
  chamar(SYNC, 'POST', '/api/sync/push', token, { dispositivo_id: DISPOSITIVO, operacoes });

function operacao(entidade, acao, dados, versao_base = 0) {
  return { op_id: randomUUID(), entidade, acao, entidade_id: dados.id, versao_base, dados };
}

// Mesmo conjunto do passo 12 do roteiro: pessoa, prontuário e atendimento criados offline.
function ocorrenciaOffline(medicamentoId) {
  const agora = new Date().toISOString();
  const pessoa = { id: randomUUID(), nome: 'Vítima Offline', sexo: 'M', alterado_no_cliente_em: agora };
  const prontuario = { id: randomUUID(), paciente_id: pessoa.id, alergias: 'Nenhuma conhecida', alterado_no_cliente_em: agora };
  const atendimento = {
    id: randomUUID(), paciente_id: pessoa.id, prontuario_id: prontuario.id, data_hora: agora,
    tipo_ocorrencia: 'acidente_transito', descricao: 'Atendimento registrado sem conexão.',
    glasgow_ocular: 3, glasgow_verbal: 4, glasgow_motora: 6, manchester: 'amarelo', start: 'amarelo',
    medicamentos: [{ id: randomUUID(), medicamento_id: medicamentoId, dose: 500, unidade: 'mL', via: 'IV', horario: agora }],
    alterado_no_cliente_em: agora,
  };
  return { pessoa, prontuario, atendimento };
}

before(async () => {
  socorrista = await entrar('SOCORRISTA', 'SOC-0042');
  admin = await entrar('CRM', 'admin');
});

test('os três serviços exigem token', async () => {
  assert.equal((await chamar(CADASTROS, 'GET', '/api/medicamento')).status, 401);
  assert.equal((await chamar(ATENDIMENTOS, 'GET', '/api/atendimento')).status, 401);
  assert.equal((await chamar(SYNC, 'GET', '/api/sync/pull')).status, 401);
  assert.equal((await chamar(SYNC, 'GET', '/api/sync/pull', 'abc')).status, 401);
});

test('pull inicial traz os dados de apoio e um cursor', async () => {
  const r = await chamar(SYNC, 'GET', '/api/sync/pull?desde=0', socorrista);
  assert.equal(r.status, 200);
  assert.ok(r.corpo.cursor > 0);
  assert.ok(r.corpo.pacientes.length >= 5);
  assert.ok(r.corpo.medicamentos.length >= 10);
  assert.ok(r.corpo.atendimentos[0].medicamentos !== undefined);
  assert.equal(r.corpo.profissionais[0].senha_hash, undefined);

  const semMudancas = await chamar(SYNC, 'GET', `/api/sync/pull?desde=${r.corpo.cursor}`, socorrista);
  assert.equal(semMudancas.corpo.pacientes.length, 0);
  assert.equal(semMudancas.corpo.cursor, r.corpo.cursor);
});

test('push grava nos serviços donos e o reenvio não duplica', async () => {
  const pull = await chamar(SYNC, 'GET', '/api/sync/pull?desde=0', socorrista);
  const { pessoa, prontuario, atendimento } = ocorrenciaOffline(pull.corpo.medicamentos[0].id);
  const ops = [
    operacao('paciente', 'criar', pessoa),
    operacao('prontuario', 'criar', prontuario),
    operacao('atendimento', 'criar', atendimento),
  ];

  const primeira = await enviar(ops);
  assert.equal(primeira.status, 200);
  assert.deepEqual(primeira.corpo.resultados.map((r) => r.status), ['aplicada', 'aplicada', 'aplicada']);
  assert.equal(primeira.corpo.resultados[2].registro.medicamentos.length, 1);

  // os registros existem nas APIs dos serviços donos
  assert.equal((await chamar(CADASTROS, 'GET', `/api/pessoa/${pessoa.id}`, admin)).corpo.nome, 'Vítima Offline');
  assert.equal((await chamar(CADASTROS, 'GET', `/api/prontuario/${pessoa.id}`, admin)).corpo.id, prontuario.id);
  const doPaciente = await chamar(ATENDIMENTOS, 'GET', `/api/atendimento/${pessoa.id}`, admin);
  assert.equal(doPaciente.corpo.length, 1);
  assert.equal(doPaciente.corpo[0].profissional_nome, 'Marcos Dalpiaz');

  // reenvio da mesma fila (ex.: a resposta se perdeu na rede)
  const segunda = await enviar(ops);
  assert.deepEqual(segunda.corpo.resultados.map((r) => r.status), ['duplicada', 'duplicada', 'duplicada']);
  assert.equal((await chamar(ATENDIMENTOS, 'GET', `/api/atendimento/${pessoa.id}`, admin)).corpo.length, 1);

  // o pull seguinte devolve os novos registros
  const novos = await chamar(SYNC, 'GET', `/api/sync/pull?desde=${pull.corpo.cursor}`, socorrista);
  assert.ok(novos.corpo.atendimentos.some((a) => a.id === atendimento.id));

  // rastreabilidade
  const rastro = await chamar(SYNC, 'GET', '/api/sync/operacoes?limite=20', admin);
  const registrada = rastro.corpo.find((o) => o.op_id === ops[2].op_id);
  assert.equal(registrada.status, 'aplicada');
  assert.equal(registrada.dispositivo_id, DISPOSITIVO);
  assert.equal(registrada.profissional_nome, 'Marcos Dalpiaz');
});

test('conflito em paciente: última escrita vence', async () => {
  const pessoa = { id: randomUUID(), nome: 'Paciente Conflito', alterado_no_cliente_em: new Date().toISOString() };
  await enviar([operacao('paciente', 'criar', pessoa)]);

  // o portal edita depois (versão 2)
  const noPortal = await chamar(CADASTROS, 'PUT', `/api/pessoa/${pessoa.id}`, admin, { nome: 'Nome do Portal', versao_base: 1 });
  assert.equal(noPortal.corpo.versao, 2);

  // dispositivo envia edição feita sobre a versão 1, mas mais antiga que a do portal: servidor mantém
  const opAntiga = operacao('paciente', 'atualizar',
    { ...pessoa, nome: 'Edição Antiga', alterado_no_cliente_em: '2026-01-01T00:00:00Z' }, 1);
  const antiga = await enviar([opAntiga]);
  assert.equal(antiga.corpo.resultados[0].status, 'conflito');
  assert.equal(antiga.corpo.resultados[0].registro.nome, 'Nome do Portal');

  // as duas versões ficam guardadas para consulta no portal
  const detalhe = await chamar(SYNC, 'GET', `/api/sync/operacoes/${opAntiga.op_id}`, admin);
  assert.equal(detalhe.corpo.payload_cliente.nome, 'Edição Antiga');
  assert.equal(detalhe.corpo.payload_servidor.nome, 'Nome do Portal');

  // edição mais recente que a do portal: dispositivo vence
  const recente = await enviar([operacao('paciente', 'atualizar',
    { ...pessoa, nome: 'Edição Recente', alterado_no_cliente_em: new Date(Date.now() + 1000).toISOString() }, 1)]);
  assert.equal(recente.corpo.resultados[0].status, 'aplicada');
  assert.match(recente.corpo.resultados[0].mensagem, /última escrita vence/);
  assert.equal(recente.corpo.resultados[0].registro.nome, 'Edição Recente');
  assert.equal(recente.corpo.resultados[0].registro.versao, 3);
});

test('conflito em atendimento: servidor vence', async () => {
  const pull = await chamar(SYNC, 'GET', '/api/sync/pull?desde=0', socorrista);
  const { pessoa, prontuario, atendimento } = ocorrenciaOffline(pull.corpo.medicamentos[0].id);
  await enviar([operacao('paciente', 'criar', pessoa), operacao('prontuario', 'criar', prontuario), operacao('atendimento', 'criar', atendimento)]);

  await chamar(ATENDIMENTOS, 'PUT', `/api/atendimento/${atendimento.id}`, admin,
    { ...atendimento, descricao: 'Corrigido no portal', versao_base: 1 });

  const r = await enviar([operacao('atendimento', 'atualizar',
    { ...atendimento, descricao: 'Mudança do dispositivo', alterado_no_cliente_em: new Date(Date.now() + 5000).toISOString() }, 1)]);
  assert.equal(r.corpo.resultados[0].status, 'conflito');
  assert.match(r.corpo.resultados[0].mensagem, /servidor vence/);
  assert.equal(r.corpo.resultados[0].registro.descricao, 'Corrigido no portal');
});

test('operação inválida volta como erro sem retentar', async () => {
  const r = await enviar([operacao('atendimento', 'criar', { id: randomUUID(), paciente_id: randomUUID(), descricao: '' })]);
  assert.equal(r.corpo.resultados[0].status, 'erro');
  assert.equal(r.corpo.resultados[0].retentar, undefined);
  assert.match(r.corpo.resultados[0].mensagem, /Dados inválidos/);
});

test('medicamento cadastrado no servidor chega ao dispositivo pelo pull', async () => {
  const antes = await chamar(SYNC, 'GET', '/api/sync/pull?desde=0', socorrista);
  const novo = await chamar(CADASTROS, 'POST', '/api/medicamento', admin, { nome: 'Cetoprofeno', apresentacao: 'Frasco-ampola' });
  assert.equal(novo.status, 201);
  const depois = await chamar(SYNC, 'GET', `/api/sync/pull?desde=${antes.corpo.cursor}`, socorrista);
  assert.deepEqual(depois.corpo.medicamentos.map((m) => m.nome), ['Cetoprofeno']);
});

test('logs offline do app e logs dos três serviços ficam na auditoria', async () => {
  const r = await chamar(SYNC, 'POST', '/api/log', socorrista, {
    dispositivo_id: DISPOSITIVO,
    logs: [{ data_hora: new Date().toISOString(), metodo: 'LOCAL', rota: 'criar paciente', status: 0, duracao_ms: 3.2 }],
  });
  assert.equal(r.status, 201);

  const auditoria = await chamar(CADASTROS, 'GET', '/api/auditoria?limite=500', admin);
  const servicos = new Set(auditoria.corpo.map((l) => l.servico));
  for (const servico of ['cadastros', 'atendimentos', 'sync', 'app-socorrista']) {
    assert.ok(servicos.has(servico), `sem logs de ${servico}`);
  }
  const doApp = auditoria.corpo.find((l) => l.servico === 'app-socorrista');
  assert.equal(doApp.origem, 'cliente');
  assert.equal(doApp.profissional_nome, 'Marcos Dalpiaz');

  const doSync = auditoria.corpo.find((l) => l.servico === 'sync' && l.rota === '/api/sync/push');
  assert.ok(doSync.profissional_id && doSync.ip && Number(doSync.duracao_ms) >= 0);
});
