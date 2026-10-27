// Repository: as telas usam pacientes.salvar(), medicamentos.listar() etc.
// sem saber de IndexedDB, fila de envio ou API. Toda gravação do app vai
// para o banco local e gera um comando na fila (outbox); o envio ao
// servidor é feito depois pelo módulo outbox.js.
import * as db from './db-local.js';
import { chamarApi, ErroApi } from '../comum/api.js';
import { estaOnline, informarFalhaDeRede } from './conectividade.js';
import { SERVIDOR } from './config.js';

// Campos calculados pelo servidor, que não fazem parte do que é enviado.
const CAMPOS_DO_SERVIDOR = ['versao', 'seq_alteracao', 'criado_em', 'atualizado_em', 'excluido_em', 'criado_por', 'glasgow_total'];

function dadosParaEnvio(registro) {
  const dados = { ...registro };
  for (const campo of CAMPOS_DO_SERVIDOR) delete dados[campo];
  return dados;
}

function criarRepositorioLocal(store, entidade) {
  return {
    async listar() {
      return (await db.listar(store)).filter((r) => !r.excluido_em);
    },

    buscar(id) {
      return db.ler(store, id);
    },

    async listarDoPaciente(pacienteId) {
      return (await db.listarPorIndice(store, 'paciente_id', pacienteId)).filter((r) => !r.excluido_em);
    },

    // O registro e o comando da fila são gravados na mesma transação: não
    // existe registro local alterado sem a operação pendente correspondente.
    salvar(dados) {
      const agora = new Date().toISOString();
      const modo = estaOnline() ? '' : ' (offline)';
      return db.transacao([store, 'outbox', 'logs'], 'readwrite', async (tx) => {
        const existente = dados.id ? await db.promessa(tx.objectStore(store).get(dados.id)) : null;
        const registro = { ...existente, ...dados, id: dados.id ?? crypto.randomUUID(), alterado_no_cliente_em: agora };
        tx.objectStore(store).put(registro);

        const fila = tx.objectStore('outbox');
        const pendentes = await db.promessa(fila.index('entidade_id').getAll(registro.id));
        const naoEnviada = pendentes.find((op) => op.tentativas === 0);
        if (naoEnviada) {
          // ainda não saiu do dispositivo: atualiza o comando em vez de criar outro
          fila.put({ ...naoEnviada, dados: dadosParaEnvio(registro) });
        } else {
          fila.add({
            op_id: crypto.randomUUID(),
            entidade,
            acao: existente ? 'atualizar' : 'criar',
            entidade_id: registro.id,
            versao_base: existente?.versao ?? 0,
            dados: dadosParaEnvio(registro),
            criado_em: agora,
            tentativas: 0,
            ultimo_erro: null,
          });
        }
        tx.objectStore('logs').add({
          data_hora: agora, metodo: 'LOCAL', rota: `${existente ? 'atualizar' : 'criar'} ${entidade}${modo}`, status: 0, duracao_ms: 0,
        });
        return registro;
      });
    },
  };
}

export const pacientes = criarRepositorioLocal('pacientes', 'paciente');
export const prontuarios = criarRepositorioLocal('prontuarios', 'prontuario');
export const atendimentos = criarRepositorioLocal('atendimentos', 'atendimento');

// Medicamentos e profissionais só são lidos no app; chegam pelo pull.
export const medicamentos = {
  async listar() {
    return (await db.listar('medicamentos')).filter((m) => !m.excluido_em).sort((a, b) => a.nome.localeCompare(b.nome));
  },
  listarTodos: () => db.listar('medicamentos'),
};

export const profissionais = {
  buscar: (id) => db.ler('profissionais', id),
};

// Repositório remoto: único ponto do app que fala com o servidor.
// Com o simulador em OFFLINE nenhuma requisição sai do navegador.
async function chamarServidor(caminho, opcoes = {}) {
  if (!estaOnline()) {
    throw new ErroApi(0, { erro: 'Modo offline: nada foi enviado ao servidor' });
  }
  const sessao = await db.lerMeta('sessao');
  try {
    return await chamarApi(caminho, { ...opcoes, token: sessao?.token, servidor: SERVIDOR });
  } catch (erro) {
    if (erro.status === 0) informarFalhaDeRede();
    throw erro;
  }
}

export const servidor = {
  login: (credenciais) => chamarServidor('/auth/login', { metodo: 'POST', corpo: credenciais }),
  enviarOperacoes: (dispositivo_id, operacoes) =>
    chamarServidor('/sync/push', { metodo: 'POST', corpo: { dispositivo_id, operacoes } }),
  receberAlteracoes: (desde) => chamarServidor(`/sync/pull?desde=${desde}`),
  enviarLogs: (dispositivo_id, logs) => chamarServidor('/log', { metodo: 'POST', corpo: { dispositivo_id, logs } }),
  // PDF e e-mail são da API 1
  baixarFicha: (atendimentoId) => chamarServidor(`/documento/pdf?atendimento_id=${atendimentoId}`, { comoArquivo: true }),
  enviarFicha: (atendimentoId, destinatario) =>
    chamarServidor('/email/enviar', { metodo: 'POST', corpo: { atendimento_id: atendimentoId, destinatario } }),
};
