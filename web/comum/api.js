// Chamada às APIs. O Nginx encaminha cada caminho /api/... ao serviço certo.
export class ErroApi extends Error {
  constructor(status, corpo) {
    const detalhes = Array.isArray(corpo?.detalhes) ? `: ${corpo.detalhes.join('; ')}` : '';
    super((corpo?.erro ?? `Erro ${status}`) + detalhes);
    this.status = status;
    this.corpo = corpo;
  }
}

export async function chamarApi(caminho, { metodo = 'GET', corpo, token, comoArquivo = false } = {}) {
  let resposta;
  try {
    resposta = await fetch('/api' + caminho, {
      method: metodo,
      headers: {
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, { erro: 'Não foi possível conectar ao servidor' });
  }

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => null);
    throw new ErroApi(resposta.status, erro);
  }
  if (comoArquivo) {
    const nome = /filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') ?? '')?.[1] ?? 'arquivo';
    return { blob: await resposta.blob(), nome };
  }
  return resposta.status === 204 ? null : resposta.json();
}
