from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import repositorio
from .auth import emitir_token, exigir_admin, gerar_hash, profissional_atual, senha_confere
from .envio_email import enviar_ficha
from .ficha_pdf import gerar_ficha
from .logs import registrar_acesso
from .modelos import EnvioEmail, EnvioLogs, Login, ProfissionalEntrada

# API 1 - Autenticação, logs e documentos (Python / FastAPI)
#   POST /api/auth/login      login e emissão do token (única rota pública)
#   POST /api/log             logs gravados pelo app do socorrista offline
#   POST /api/email/enviar    envia a ficha do atendimento em PDF anexada
#   GET  /api/documento/pdf   gera a ficha do atendimento em PDF
# Extras do mesmo assunto: /api/auth/eu, /api/profissional (CRUD) e /api/auditoria.
# Os dados do atendimento usados no PDF são da API 3; esta API só os lê do banco.
app = FastAPI(
    title="MedicalField - API 1: Autenticação, logs e documentos (Python)",
    version="2.0.0",
    description="Login com emissão de token JWT, profissionais, registro e consulta de logs, "
                "ficha de atendimento em PDF e envio da ficha por e-mail. "
                "Todas as rotas, exceto o login, exigem Authorization: Bearer <token>.",
    openapi_url="/api/openapi/api1.json",
    docs_url=None,
    redoc_url=None,
)
app.middleware("http")(registrar_acesso)

publicas = APIRouter(prefix="/api", tags=["Autenticação"])
protegidas = APIRouter(prefix="/api", dependencies=[Depends(profissional_atual)])
somente_admin = APIRouter(prefix="/api", dependencies=[Depends(exigir_admin)])


# ---------- Autenticação ----------

@publicas.post("/auth/login", summary="Autentica o profissional e retorna um token",
               responses={401: {"description": "Registro ou senha incorretos"}})
def login(dados: Login, request: Request):
    profissional = repositorio.buscar_para_login(dados.tipo_registro, dados.numero_registro.strip())
    if not profissional or not senha_confere(dados.senha, profissional["senha_hash"]):
        raise HTTPException(401, "Registro ou senha incorretos")
    request.state.profissional_id = str(profissional["id"])  # o log de acesso mostra quem entrou
    publico = {campo: profissional[campo] for campo in repositorio.COLUNAS_PROFISSIONAL.split(", ")}
    return {"token": emitir_token(profissional), "profissional": publico}


@protegidas.get("/auth/eu", tags=["Autenticação"], summary="Conteúdo do token atual")
def eu(profissional: dict = Depends(profissional_atual)):
    return profissional


# ---------- Profissionais (somente admin) ----------

@somente_admin.get("/profissional", tags=["Profissionais"], summary="Lista profissionais")
def listar_profissionais():
    return repositorio.listar_profissionais()


@somente_admin.get("/profissional/{profissional_id}", tags=["Profissionais"], summary="Obtém um profissional")
def obter_profissional(profissional_id: UUID):
    profissional = repositorio.buscar_profissional(profissional_id)
    if not profissional:
        raise HTTPException(404, "Profissional não encontrado")
    return profissional


@somente_admin.post("/profissional", tags=["Profissionais"], status_code=201, summary="Cadastra profissional")
def criar_profissional(dados: ProfissionalEntrada):
    if not dados.senha:
        raise HTTPException(400, "Senha é obrigatória no cadastro (mínimo 6 caracteres)")
    return repositorio.criar_profissional(dados.model_dump(), gerar_hash(dados.senha))


@somente_admin.put("/profissional/{profissional_id}", tags=["Profissionais"], summary="Atualiza profissional (senha opcional)")
def atualizar_profissional(profissional_id: UUID, dados: ProfissionalEntrada):
    senha_hash = gerar_hash(dados.senha) if dados.senha else None
    profissional = repositorio.atualizar_profissional(profissional_id, dados.model_dump(), senha_hash)
    if not profissional:
        raise HTTPException(404, "Profissional não encontrado")
    return profissional


@somente_admin.delete("/profissional/{profissional_id}", tags=["Profissionais"], summary="Desativa profissional")
def desativar_profissional(profissional_id: UUID, admin: dict = Depends(exigir_admin)):
    if str(profissional_id) == admin["sub"]:
        raise HTTPException(400, "Não é possível desativar o próprio usuário")
    profissional = repositorio.desativar_profissional(profissional_id)
    if not profissional:
        raise HTTPException(404, "Profissional não encontrado")
    return profissional


# ---------- Logs ----------

@protegidas.post("/log", tags=["Logs"], status_code=201, summary="Envia os logs locais do app gravados offline")
def receber_logs(envio: EnvioLogs, request: Request, profissional: dict = Depends(profissional_atual)):
    ip = request.client.host if request.client else None
    repositorio.gravar_logs_do_cliente([log.model_dump() for log in envio.logs], ip, profissional["sub"])
    return {"recebidos": len(envio.logs)}


@somente_admin.get("/auditoria", tags=["Logs"], summary="Últimos logs de acesso das três APIs e do app")
def auditoria(limite: int = Query(100, ge=1, le=500), servico: str | None = None):
    return repositorio.listar_auditoria(limite, servico)


# ---------- Documentos: PDF e e-mail ----------

def _ficha(atendimento_id: UUID):
    atendimento = repositorio.buscar_para_ficha(atendimento_id)
    if not atendimento:
        raise HTTPException(404, "Atendimento não encontrado")
    return atendimento


def _nome_arquivo(atendimento):
    return f"ficha-atendimento-{atendimento['data_hora']:%Y%m%d-%H%M}-{str(atendimento['id'])[:8]}.pdf"


@protegidas.get("/documento/pdf", tags=["Documentos"], summary="Gera a ficha de atendimento em PDF",
                response_class=Response, responses={200: {"content": {"application/pdf": {}}}, 404: {"description": "Atendimento não encontrado"}})
def documento_pdf(atendimento_id: UUID):
    atendimento = _ficha(atendimento_id)
    return Response(
        gerar_ficha(atendimento),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_nome_arquivo(atendimento)}"'},
    )


# Gera o mesmo PDF da rota acima e envia anexado pelo SMTP configurado no .env.
@protegidas.post("/email/enviar", tags=["Documentos"], summary="Envia a ficha em PDF anexada por e-mail",
                 responses={404: {"description": "Atendimento não encontrado"}, 502: {"description": "Falha no servidor de e-mail"}})
def email_enviar(envio: EnvioEmail):
    atendimento = _ficha(envio.atendimento_id)
    try:
        enviar_ficha(envio.destinatario, atendimento["paciente_nome"], gerar_ficha(atendimento), _nome_arquivo(atendimento))
    except Exception as erro:
        raise HTTPException(502, f"Falha ao enviar o e-mail: {erro}")
    return {"mensagem": f"Ficha enviada para {envio.destinatario}"}


app.include_router(publicas)
app.include_router(protegidas)
app.include_router(somente_admin)


# Erros sempre no formato {"erro": ...}, igual às outras APIs.
@app.exception_handler(StarletteHTTPException)
def erro_http(request: Request, erro: StarletteHTTPException):
    return JSONResponse(status_code=erro.status_code, content={"erro": erro.detail})


MENSAGENS_VALIDACAO = {
    "missing": "campo obrigatório",
    "less_than_equal": "deve ser no máximo {le}",
    "greater_than_equal": "deve ser no mínimo {ge}",
    "literal_error": "deve ser um destes valores: {expected}",
    "string_too_short": "deve ter pelo menos {min_length} caracteres",
    "string_pattern_mismatch": "formato inválido",
    "too_long": "no máximo {max_length} itens",
    "int_parsing": "deve ser um número inteiro",
    "float_parsing": "deve ser um número",
    "uuid_parsing": "identificador inválido",
    "datetime_parsing": "data e hora inválidas",
    "datetime_from_date_parsing": "data e hora inválidas",
}


@app.exception_handler(RequestValidationError)
def erro_validacao(request: Request, erro: RequestValidationError):
    detalhes = []
    for e in erro.errors():
        campo = ".".join(str(p) for p in e["loc"] if p not in ("body", "query"))
        modelo = MENSAGENS_VALIDACAO.get(e["type"])
        mensagem = modelo.format(**e.get("ctx", {})).replace("' or '", "' ou '") if modelo else e["msg"]
        detalhes.append(f"{campo}: {mensagem}" if campo else mensagem)
    return JSONResponse(status_code=400, content={"erro": "Dados inválidos", "detalhes": detalhes})


@app.exception_handler(psycopg.errors.UniqueViolation)
def erro_duplicado(request: Request, erro):
    return JSONResponse(status_code=409, content={"erro": "Este registro profissional já está cadastrado"})
