import "dotenv/config";
import { app } from "./app.js";

const porta = Number(process.env.PORTA_CADASTROS ?? 3001);

app.listen(porta, () => {
  console.log(`Servico de cadastros na porta ${porta}`);
});

