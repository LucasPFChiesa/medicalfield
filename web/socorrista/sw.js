// Service Worker do app do socorrista: guarda os arquivos da aplicação para
// que ela abra mesmo sem internet. Os dados não passam por aqui (ficam no
// IndexedDB) e as chamadas /api/ sempre vão direto para a rede.
const CACHE = 'medicalfield-app-v6';

const ARQUIVOS = [
  '/socorrista/',
  '/socorrista/app.js',
  '/socorrista/db-local.js',
  '/socorrista/repositorios.js',
  '/socorrista/conectividade.js',
  '/socorrista/outbox.js',
  '/socorrista/sessao.js',
  '/socorrista/exemplos.js',
  '/socorrista/config.js',
  '/socorrista/manifest.json',
  '/socorrista/icone.svg',
  '/comum/estilo.css',
  '/comum/api.js',
  '/comum/util.js',
  '/comum/form-atendimento.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Responde com o arquivo guardado e, se houver rede, atualiza a cópia em
// segundo plano para a próxima abertura.
self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);
  if (evento.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  const chave = evento.request.mode === 'navigate' ? '/socorrista/' : evento.request;
  evento.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardado = await cache.match(chave, { ignoreSearch: true });
      const daRede = fetch(evento.request)
        .then((resposta) => {
          if (resposta.ok) cache.put(chave, resposta.clone());
          return resposta;
        })
        .catch(() => guardado);
      return guardado ?? daRede;
    }),
  );
});
