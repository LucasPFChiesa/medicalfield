// Observer: guarda o estado da conexão e avisa os interessados (indicador da
// tela, envio automático da fila, etc.) sempre que ele muda.
// Online = chave do simulador em ONLINE e servidor alcançável.
const ouvintes = new Set();
const INTERVALO_VERIFICACAO = 5000;

let simuladorOnline = true;
try {
  simuladorOnline = localStorage.getItem('simulador-online') !== 'false';
} catch { /* armazenamento indisponível: começa online */ }

// navigator.onLine não é confiável sozinho: no Linux, uma interface virtual
// (Docker, VPN) mantém o navegador "online" mesmo sem internet. Por isso o
// app também confere se o servidor responde.
let servidorAlcancavel = navigator.onLine;
let ultimoEstado = estaOnline();

export function estaOnline() {
  return simuladorOnline && navigator.onLine && servidorAlcancavel;
}

export function simuladorEstaOnline() {
  return simuladorOnline;
}

export function definirSimulador(online) {
  simuladorOnline = online;
  try {
    localStorage.setItem('simulador-online', String(online));
  } catch { /* não persiste, mas continua funcionando */ }
  avisar(true);
  if (online) verificarServidor();
}

// Chamado pelo repositório remoto quando uma requisição falha por rede.
export function informarFalhaDeRede() {
  servidorAlcancavel = false;
  avisar();
}

// /api/ping é respondido pelo próprio Nginx (não chega aos serviços nem ao
// log de auditoria). Com o simulador em OFFLINE nada é enviado.
async function verificarServidor() {
  if (!simuladorOnline) return;
  try {
    const resposta = await fetch('/api/ping', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    servidorAlcancavel = resposta.ok;
  } catch {
    servidorAlcancavel = false;
  }
  avisar();
}

export function assinar(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

function avisar(sempre = false) {
  const online = estaOnline();
  const voltouAgora = online && !ultimoEstado;
  const mudou = online !== ultimoEstado;
  ultimoEstado = online;
  if (!mudou && !sempre) return;
  for (const ouvinte of ouvintes) ouvinte({ online, voltouAgora });
}

window.addEventListener('online', verificarServidor);
window.addEventListener('offline', () => avisar());
setInterval(verificarServidor, INTERVALO_VERIFICACAO);
verificarServidor();
