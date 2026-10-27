import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Lê SENHA_DEMO e demais variáveis do .env da raiz do projeto.
for (const linha of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const [, chave, valor] = /^([A-Z_]+)=(.*)$/.exec(linha) ?? [];
  if (chave && process.env[chave] === undefined) process.env[chave] = valor.replace(/^"|"$/g, '');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://medicalfield.duckdns.org',
    channel: 'chrome',
    headless: true,
    acceptDownloads: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
});
