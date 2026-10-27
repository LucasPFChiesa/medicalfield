from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Formatos dos corpos de requisição da API 1. O FastAPI valida cada corpo
# antes de chamar a rota e devolve 400 com a lista de campos errados.

TipoRegistro = Literal["CRM", "COREN", "SOCORRISTA"]
Perfil = Literal["admin", "medico", "enfermeiro", "socorrista"]
EMAIL = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"


class Login(BaseModel):
    tipo_registro: TipoRegistro
    numero_registro: str = Field(min_length=1)
    senha: str = Field(min_length=1)


class ProfissionalEntrada(BaseModel):
    nome: str = Field(min_length=1)
    tipo_registro: TipoRegistro
    numero_registro: str = Field(min_length=1)
    perfil: Perfil
    email: str | None = Field(None, pattern=EMAIL)
    senha: str | None = Field(None, min_length=6, description="Obrigatória no cadastro; opcional na edição")
    ativo: bool | None = None


class LogDoCliente(BaseModel):
    data_hora: datetime
    metodo: str = Field(min_length=1)
    rota: str = Field(min_length=1)
    status: int = 0
    duracao_ms: float = 0


class EnvioLogs(BaseModel):
    dispositivo_id: str | None = None
    logs: list[LogDoCliente] = Field(max_length=500)


class EnvioEmail(BaseModel):
    atendimento_id: UUID
    destinatario: str = Field(pattern=EMAIL)
