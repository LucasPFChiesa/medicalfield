// Sincronização: envia a fila de comandos (push), envia os logs locais e
// depois baixa o que mudou no servidor desde o último cursor (pull).
import * as db from './db-local.js';
import { servidor } from './repositorios.js';

const STORE_DA_ENTIDADE = { paciente: 'pacientes', prontuario: 'prontuarios', atendimento: 'atendimentos' };
const LISTAS_DO_PULL = ['pacientes', 'prontuarios', 'atendimentos', 'medicamentos', 'profissionais'];

let sincronizacaoAtual = null;

export async function dispositivoId() {
  let id = await db.lerMeta('dispositivo_id');
  if (!id) {
    id = crypto.randomUUID();
    await db.gravarMeta('dispositivo_id', id);
  }
  return id;
}

export function contarPendentes() {
  return db.transacao(['outbox'], 'readonly', (tx) => db.promessa(tx.objectStore('outbox').count()));
}

// Evita duas sincronizações ao mesmo tempo (ex.: botão + volta da conexão).
export function sincronizar() {
  sincronizacaoAtual ??= executar().finally(() => { sincronizacaoAtual = null; });
  return sincronizacaoAtual;
}

async function executar() {
  const resumo = { enviadas: 0, aplicadas: 0, duplicadas: 0, conflitos: 0, erros: 0, recebidos: 0, mensagens: [] };
  await enviarFila(resumo);
  await enviarLogs();
  await receberAlteracoes(resumo);
  await db.gravarMeta('ultima_sincronizacao', new Date().toISOString());
  return resumo;
}

async function enviarFila(resumo) {
  const fila = await db.listar('outbox');
  if (!fila.length) return;

  // Conta a tentativa antes de enviar: se a resposta se perder, o comando não
  // é mais alterado no lugar e o reenvio usa o mesmo op_id (idempotência).
  const enviadas = fila.map((op) => ({ ...op, tentativas: op.tentativas + 1 }));
  await db.transacao(['outbox'], 'readwrite', (tx) => enviadas.forEach((op) => tx.objectStore('outbox').put(op)));

  const resposta = await servidor.enviarOperacoes(await dispositivoId(), enviadas.map((op) => ({
    op_id: op.op_id, entidade: op.entidade, acao: op.acao, entidade_id: op.entidade_id, versao_base: op.versao_base, dados: op.dados,
  })));
  resumo.enviadas = enviadas.length;

  const porOpId = Object.fromEntries(enviadas.map((op) => [op.op_id, op]));
  const stores = ['outbox', 'historico_sync', ...Object.values(STORE_DA_ENTIDADE)];
  await db.transacao(stores, 'readwrite', async (tx) => {
    const outbox = tx.objectStore('outbox');
    for (const r of resposta.resultados) {
      const op = porOpId[r.op_id];
      tx.objectStore('historico_sync').add({
        data_hora: new Date().toISOString(), entidade: op.entidade, entidade_id: op.entidade_id,
        acao: op.acao, status: r.status, mensagem: r.mensagem ?? '',
      });

      if (r.status === 'erro') {
        outbox.put({ ...op, ultimo_erro: r.mensagem, definitivo: !r.retentar });
        resumo.erros++;
        resumo.mensagens.push(`${op.entidade}: ${r.mensagem}`);
        continue;
      }

      outbox.delete(op.seq);
      if (r.status === 'aplicada') resumo.aplicadas++;
      if (r.status === 'duplicada') resumo.duplicadas++;
      if (r.status === 'conflito') {
        resumo.conflitos++;
        resumo.mensagens.push(`${op.entidade}: ${r.mensagem}`);
      }
      if (!r.registro) continue;

      // Se o registro foi editado de novo enquanto este envio acontecia, a
      // edição local continua valendo, mas passa a se basear na nova versão.
      const store = tx.objectStore(STORE_DA_ENTIDADE[op.entidade]);
      const outras = (await db.promessa(outbox.index('entidade_id').getAll(op.entidade_id))).filter((o) => o.seq !== op.seq);
      if (outras.length) {
        for (const outra of outras.filter((o) => o.tentativas === 0)) outbox.put({ ...outra, versao_base: r.registro.versao });
        const local = await db.promessa(store.get(op.entidade_id));
        store.put({ ...local, versao: r.registro.versao });
      } else {
        store.put(r.registro);
      }
    }
  });
}

async function enviarLogs() {
  const logs = await db.listar('logs');
  if (!logs.length) return;
  await servidor.enviarLogs(await dispositivoId(), logs.map(({ seq, ...log }) => log));
  await db.transacao(['logs'], 'readwrite', (tx) => logs.forEach((l) => tx.objectStore('logs').delete(l.seq)));
}

async function receberAlteracoes(resumo) {
  let desde = (await db.lerMeta('cursor')) ?? 0;
  let dados = await servidor.receberAlteracoes(desde);
  // Cursor do servidor menor que o nosso: o banco central foi recriado.
  // Descarta a cópia local e baixa tudo de novo.
  const recomecar = dados.cursor < desde;
  if (recomecar) {
    desde = 0;
    dados = await servidor.receberAlteracoes(0);
  }

  await db.transacao([...LISTAS_DO_PULL, 'outbox', 'meta'], 'readwrite', async (tx) => {
    const pendentes = new Set((await db.promessa(tx.objectStore('outbox').getAll())).map((op) => op.entidade_id));
    for (const lista of LISTAS_DO_PULL) {
      const store = tx.objectStore(lista);
      if (recomecar) {
        for (const id of await db.promessa(store.getAllKeys())) if (!pendentes.has(id)) store.delete(id);
      }
      for (const registro of dados[lista]) {
        // alteração local ainda não aceita pelo servidor não é sobrescrita
        if (pendentes.has(registro.id)) continue;
        if (registro.excluido_em) store.delete(registro.id);
        else store.put(registro);
        resumo.recebidos++;
      }
    }
    tx.objectStore('meta').put({ chave: 'cursor', valor: dados.cursor });
  });
}

export function historico() {
  return db.listar('historico_sync');
}

export function descartar(seq) {
  return db.apagar('outbox', seq);
}
