import pg from 'pg';

// Datas (sem hora) voltam como texto 'AAAA-MM-DD', sem conversão de fuso.
pg.types.setTypeParser(1082, (valor) => valor);

// Singleton: o módulo é carregado uma única vez pelo Node, então todo o
// serviço compartilha este mesmo pool de conexões.
export const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NOME || 'medicalfield',
  user: 'mf_cadastros',
  password: process.env.DB_SENHA_CADASTROS,
  max: 5,
});
