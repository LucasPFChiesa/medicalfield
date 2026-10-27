import time
from datetime import datetime, timezone

from fastapi import Request
from starlette.concurrency import run_in_threadpool

from .db import pool


def gravar_log(ip, profissional_id, metodo, rota, status, duracao_ms):
    try:
        with pool.connection() as con:
            con.execute(
                """INSERT INTO log_acesso (servico, ip, profissional_id, metodo, rota, status, duracao_ms)
                   VALUES ('api1', %s, %s, %s, %s, %s, %s)""",
                (ip, profissional_id, metodo, rota, status, round(duracao_ms, 2)),
            )
    except Exception as erro:
        print(f"Falha ao gravar log de acesso: {erro}", flush=True)


# Middleware de auditoria: envolve todas as rotas e registra o acesso no final.
async def registrar_acesso(request: Request, call_next):
    inicio = time.perf_counter()
    status = 500
    try:
        resposta = await call_next(request)
        status = resposta.status_code
        return resposta
    finally:
        duracao_ms = (time.perf_counter() - inicio) * 1000
        profissional_id = getattr(request.state, "profissional_id", None)
        ip = request.client.host if request.client else None
        rota = request.url.path
        print(f"{datetime.now(timezone.utc).isoformat()} {ip} {profissional_id or '-'} "
              f"{request.method} {rota} {status} {duracao_ms:.1f}ms", flush=True)
        await run_in_threadpool(gravar_log, ip, profissional_id, request.method, rota, status, duracao_ms)
