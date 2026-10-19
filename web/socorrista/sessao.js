// Login online e offline.
// No login online, além do token, o app guarda um hash PBKDF2 da senha com
// sal aleatório. Sem conexão, o login compara a senha digitada com esse hash,
// sem consultar o servidor. A senha em si nunca é gravada.
import * as db from './db-local.js';
import { ErroApi } from '../comum/api.js';
import { estaOnline } from './conectividade.js';
import { servidor } from './repositorios.js';

const ITERACOES = 210000;

const paraHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const deHex = (texto) => new Uint8Array(texto.match(/../g).map((h) => parseInt(h, 16)));

async function derivarHash(senha, sal) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACOES }, chave, 256);
  return paraHex(bits);
}

export function tokenValido(token) {
  try {
    const conteudo = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return conteudo.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function sessaoAtual() {
  return db.lerMeta('sessao');
}

async function iniciarSessao(sessao) {
  await db.gravarMeta('sessao', sessao);
  return sessao;
}

export async function entrar(tipo_registro, numero_registro, senha) {
  numero_registro = numero_registro.trim();
  const chave = `credencial:${tipo_registro}:${numero_registro}`;

  if (estaOnline()) {
    try {
      const { token, profissional } = await servidor.login({ tipo_registro, numero_registro, senha });
      const sal = crypto.getRandomValues(new Uint8Array(16));
      await db.gravarMeta(chave, { sal: paraHex(sal), hash: await derivarHash(senha, sal), profissional, token });
      await db.gravar('profissionais', profissional);
      return iniciarSessao({ profissional, token, modo: 'online' });
    } catch (erro) {
      // status 0 = servidor inalcançável (queda real de rede): tenta o login offline
      if (!(erro instanceof ErroApi) || erro.status !== 0) throw erro;
    }
  }

  const credencial = await db.lerMeta(chave);
  if (!credencial) {
    throw new Error('Sem conexão: este profissional precisa ter entrado online pelo menos uma vez neste dispositivo.');
  }
  if (await derivarHash(senha, deHex(credencial.sal)) !== credencial.hash) {
    throw new Error('Registro ou senha incorretos');
  }
  await db.gravar('logs', { data_hora: new Date().toISOString(), metodo: 'LOCAL', rota: 'login (offline)', status: 0, duracao_ms: 0 });
  return iniciarSessao({ profissional: credencial.profissional, token: credencial.token, modo: 'offline' });
}

export function sair() {
  return db.apagar('meta', 'sessao');
}
