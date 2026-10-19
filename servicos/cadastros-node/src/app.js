import express from "express";

export const app = express();

app.use(express.json());

app.get("/saude", (_req, res) => {
  res.json({ servico: "cadastros", status: "ok" });
});

