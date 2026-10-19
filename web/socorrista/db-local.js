// Banco local do navegador (IndexedDB). Continua disponível depois de fechar
// e reabrir o navegador, e funciona sem internet.
const NOME = 'medicalfield';
const VERSAO = 1;

function criarEstrutura(db) {
  db.createObjectStore('pacientes', { keyPath: 'id' });
  db.createObjectStore('prontuarios', { keyPath: 'id' }).createIndex('paciente_id', 'paciente_id');
  db.createObjectStore('atendimentos', { keyPath: 'id' }).createIndex('paciente_id', 'paciente_id');
  db.createObjectStore('medicamentos', { keyPath: 'id' });
  db.createObjectStore('profissionais', { keyPath: 'id' });
  // fila de operações pendentes de envio (outbox), na ordem em que foram feitas
  db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }).createIndex('entidade_id', 'entidade_id');
  db.createObjectStore('logs', { keyPath: 'seq', autoIncrement: true });
  db.createObjectStore('historico_sync', { keyPath: 'seq', autoIncrement: true });
  db.createObjectStore('meta', { keyPath: 'chave' });
}

// Singleton: a conexão é aberta uma vez e a mesma promessa é reaproveitada.
let conexao = null;

export function abrirBanco() {
  conexao ??= new Promise((resolve, reject) => {
    const pedido = indexedDB.open(NOME, VERSAO);
    pedido.onupgradeneeded = () => criarEstrutura(pedido.result);
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
  return conexao;
}

export function promessa(pedido) {
  return new Promise((resolve, reject) => {
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

// Executa várias gravações numa única transação: ou todas acontecem, ou nenhuma.
export async function transacao(stores, modo, acao) {
  const db = await abrirBanco();
  const tx = db.transaction(stores, modo);
  const fim = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transação cancelada'));
  });
  const resultado = await acao(tx);
  await fim;
  return resultado;
}

export const ler = (store, chave) =>
  transacao([store], 'readonly', (tx) => promessa(tx.objectStore(store).get(chave)));

export const listar = (store) =>
  transacao([store], 'readonly', (tx) => promessa(tx.objectStore(store).getAll()));

export const listarPorIndice = (store, indice, valor) =>
  transacao([store], 'readonly', (tx) => promessa(tx.objectStore(store).index(indice).getAll(valor)));

export const gravar = (store, valor) =>
  transacao([store], 'readwrite', (tx) => promessa(tx.objectStore(store).put(valor)));

export const apagar = (store, chave) =>
  transacao([store], 'readwrite', (tx) => promessa(tx.objectStore(store).delete(chave)));

export async function lerMeta(chave) {
  return (await ler('meta', chave))?.valor;
}

export function gravarMeta(chave, valor) {
  return gravar('meta', { chave, valor });
}
