from uuid import UUID, uuid4

import psycopg
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import repositorio
from .auth import exigir_admin, profissional_atual
from .envio_email import enviar_ficha
from .ficha_pdf import gerar_ficha
from .logs import registrar_acesso
from .modelos import AtendimentoEntrada, EnvioEmail

app = FastAPI(
    title="MedicalField - Atendimentos (Python)",
    version="1.0.0",
    description="Atendimentos pré-hospitalares: sinais vitais, Glasgow, Manchester, START, "
                "medicamentos administrados, ficha em PDF e envio por e-mail.",
    openapi_url="/api/openapi/atendimentos.json",
    docs_url=None,
    redoc_url=None,
)
app.middleware("http")(registrar_acesso)

# Todas as rotas do router exigem token válido.
rotas = APIRouter(prefix="/api/atendimento", tags=["Atendimentos"], dependencies=[Depends(profissional_atual)])


def _obter(atendimento_id: UUID):
    atendimento = repositorio.buscar(atendimento_id)
    if not atendimento or atendimento["excluido_em"]:
        raise HTTPException(404, "Atendimento não encontrado")
    return atendimento


@rotas.get("", summary="Lista os atendimentos (opcionalmente de um paciente)")
def listar(paciente_id: UUID | None = None):
    return repositorio.listar(paciente_id)


@rotas.get("/detalhe/{atendimento_id}", summary="Obtém um atendimento com os medicamentos administrados")
def detalhe(atendimento_id: UUID):
    return _obter(atendimento_id)


@rotas.get("/{pessoa_id}", summary="Obtém todos os atendimentos de uma pessoa")
def por_pessoa(pessoa_id: UUID):
    return repositorio.listar(pessoa_id)


@rotas.post("", status_code=201, summary="Cadastra um atendimento")
def criar(entrada: AtendimentoEntrada, profissional: dict = Depends(profissional_atual)):
    resultado = repositorio.salvar(entrada.id or uuid4(), entrada.model_dump(), profissional["sub"], somente_criar=True)
    if resultado.get("conflito"):
        raise HTTPException(409, "Já existe um atendimento com este id")
    return resultado["registro"]


@rotas.put("/{atendimento_id}", summary="Cria ou atualiza o atendimento (com controle de versão opcional)",
           responses={409: {"description": "versao_base diferente da atual; o registro atual vem em 'atual'"}})
def salvar(atendimento_id: UUID, entrada: AtendimentoEntrada, response: Response,
           profissional: dict = Depends(profissional_atual)):
    resultado = repositorio.salvar(atendimento_id, entrada.model_dump(), profissional["sub"],
                                   versao_base=entrada.versao_base)
    if resultado.get("conflito"):
        atual = resultado["atual"]
        mensagem = ("O atendimento foi excluído" if atual["excluido_em"]
                    else f"O atendimento foi alterado por outra pessoa (versão atual: {atual['versao']})")
        return JSONResponse(status_code=409, content={"erro": mensagem, "atual": jsonable_encoder(repositorio.buscar(atendimento_id))})
    response.status_code = 201 if resultado["criado"] else 200
    return resultado["registro"]


@rotas.delete("/{atendimento_id}", summary="Exclusão lógica (somente admin)", dependencies=[Depends(exigir_admin)])
def excluir(atendimento_id: UUID):
    if not repositorio.excluir(atendimento_id):
        raise HTTPException(404, "Atendimento não encontrado")
    return {"id": str(atendimento_id), "excluido": True}


@rotas.get("/{atendimento_id}/pdf", summary="Gera a ficha de atendimento em PDF",
           response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def pdf(atendimento_id: UUID):
    atendimento = repositorio.buscar_para_ficha(atendimento_id)
    if not atendimento:
        raise HTTPException(404, "Atendimento não encontrado")
    return Response(
        gerar_ficha(atendimento),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_nome_arquivo(atendimento)}"'},
    )


@rotas.post("/{atendimento_id}/email", summary="Envia a ficha em PDF anexada por e-mail")
def email(atendimento_id: UUID, envio: EnvioEmail):
    atendimento = repositorio.buscar_para_ficha(atendimento_id)
    if not atendimento:
        raise HTTPException(404, "Atendimento não encontrado")
    try:
        enviar_ficha(envio.destinatario, atendimento["paciente_nome"], gerar_ficha(atendimento), _nome_arquivo(atendimento))
    except Exception as erro:
        raise HTTPException(502, f"Falha ao enviar o e-mail: {erro}")
    return {"mensagem": f"Ficha enviada para {envio.destinatario}"}


def _nome_arquivo(atendimento):
    return f"ficha-atendimento-{atendimento['data_hora']:%Y%m%d-%H%M}-{str(atendimento['id'])[:8]}.pdf"


app.include_router(rotas)


# Erros sempre no formato {"erro": ...}, igual aos outros serviços.
@app.exception_handler(StarletteHTTPException)
def erro_http(request: Request, erro: StarletteHTTPException):
    return JSONResponse(status_code=erro.status_code, content={"erro": erro.detail})


MENSAGENS_VALIDACAO = {
    "missing": "campo obrigatório",
    "less_than_equal": "deve ser no máximo {le}",
    "greater_than_equal": "deve ser no mínimo {ge}",
    "greater_than": "deve ser maior que {gt}",
    "literal_error": "deve ser um destes valores: {expected}",
    "string_too_short": "deve ter pelo menos {min_length} caracteres",
    "string_pattern_mismatch": "formato inválido",
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
        campo = ".".join(str(p) for p in e["loc"] if p != "body")
        modelo = MENSAGENS_VALIDACAO.get(e["type"])
        mensagem = modelo.format(**e.get("ctx", {})).replace("' or '", "' ou '") if modelo else e["msg"].removeprefix("Value error, ")
        detalhes.append(f"{campo}: {mensagem}" if campo else mensagem)
    return JSONResponse(status_code=400, content={"erro": "Dados inválidos", "detalhes": detalhes})


@app.exception_handler(repositorio.ErroValidacao)
def erro_regra(request: Request, erro: repositorio.ErroValidacao):
    return JSONResponse(status_code=400, content={"erro": str(erro)})


@app.exception_handler(psycopg.errors.ForeignKeyViolation)
def erro_referencia(request: Request, erro):
    return JSONResponse(status_code=400, content={"erro": "Paciente, prontuário ou medicamento informado não existe"})


@app.exception_handler(psycopg.errors.CheckViolation)
def erro_restricao(request: Request, erro):
    return JSONResponse(status_code=400, content={"erro": "Valor fora do permitido"})
