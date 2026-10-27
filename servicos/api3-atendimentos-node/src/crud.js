import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { permitir } from './auth.js';

// Monta as rotas GET/POST/PUT/DELETE de um cadastro a partir do seu repositório.
export function rotasCrud({ repo, validar, perfisEscrita, buscarUm = (id) => repo.buscar(id) }) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await repo.listar(req.query.busca));
  });

  router.get('/:id', async (req, res) => {
    const registro = await buscarUm(req.params.id);
    if (!registro) return res.status(404).json({ erro: 'Registro não encontrado' });
    res.json(registro);
  });

  router.post('/', permitir(...perfisEscrita), async (req, res) => {
    const dados = prepararDados(req.body);
    const erros = validar(dados);
    if (erros.length) return res.status(400).json({ erro: 'Dados inválidos', detalhes: erros });

    const resultado = await repo.salvar(dados.id ?? randomUUID(), dados, {
      somenteCriar: true,
      profissionalId: req.profissional.sub,
    });
    if (resultado.conflito) {
      return res.status(409).json({ erro: 'Já existe um registro com este id', atual: resultado.atual });
    }
    res.status(201).json(resultado.registro);
  });

  // PUT cria ou substitui. Com versao_base, só grava se ninguém alterou o
  // registro depois que o cliente o leu (controle otimista de concorrência).
  router.put('/:id', permitir(...perfisEscrita), async (req, res) => {
    const dados = prepararDados(req.body);
    const erros = validar(dados);
    if (erros.length) return res.status(400).json({ erro: 'Dados inválidos', detalhes: erros });

    const versaoBase = Number.isInteger(dados.versao_base) ? dados.versao_base : null;
    const resultado = await repo.salvar(req.params.id, dados, {
      versaoBase,
      profissionalId: req.profissional.sub,
    });
    if (resultado.conflito) {
      return res.status(409).json({
        erro: resultado.atual.excluido_em
          ? 'O registro foi excluído'
          : `O registro foi alterado por outra pessoa (versão atual: ${resultado.atual.versao})`,
        atual: resultado.atual,
      });
    }
    res.status(resultado.criado ? 201 : 200).json(resultado.registro);
  });

  router.delete('/:id', permitir('admin'), async (req, res) => {
    const registro = await repo.excluir(req.params.id);
    if (!registro) return res.status(404).json({ erro: 'Registro não encontrado' });
    res.json(registro);
  });

  return router;
}

// Campos vazios de formulário viram null e a data da alteração é registrada.
export function prepararDados(corpo) {
  const dados = { ...(corpo ?? {}) };
  for (const [campo, valor] of Object.entries(dados)) {
    if (typeof valor === 'string') dados[campo] = valor.trim() === '' ? null : valor.trim();
  }
  dados.alterado_no_cliente_em ??= new Date().toISOString();
  return dados;
}
