import { app } from './app.js';

const porta = Number(process.env.PORTA_CADASTROS) || 3001;
app.listen(porta, '127.0.0.1', () => {
  console.log(`Serviço de cadastros ouvindo em 127.0.0.1:${porta}`);
});
