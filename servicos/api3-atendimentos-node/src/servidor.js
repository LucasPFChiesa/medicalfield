import { app } from './app.js';

const porta = Number(process.env.PORTA_API3) || 3001;
app.listen(porta, '127.0.0.1', () => {
  console.log(`API 3 (pessoas, medicamentos e atendimentos) ouvindo em 127.0.0.1:${porta}`);
});
