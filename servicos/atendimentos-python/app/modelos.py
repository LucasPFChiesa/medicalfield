from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

TipoOcorrencia = Literal["clinica", "trauma", "acidente_transito", "queda", "obstetrica", "psiquiatrica", "outra"]
Manchester = Literal["vermelho", "laranja", "amarelo", "verde", "azul"]
Start = Literal["vermelho", "amarelo", "verde", "preto"]


class MedicamentoAdministrado(BaseModel):
    id: UUID | None = None
    medicamento_id: UUID
    dose: float = Field(gt=0)
    unidade: str = Field(min_length=1, max_length=20)
    via: str | None = None
    horario: datetime
    observacao: str | None = None


class AtendimentoEntrada(BaseModel):
    id: UUID | None = None
    paciente_id: UUID
    prontuario_id: UUID | None = None
    profissional_id: UUID | None = None
    data_hora: datetime
    tipo_ocorrencia: TipoOcorrencia
    local: str | None = None
    descricao: str = Field(min_length=3)
    pa_sistolica: int | None = Field(None, ge=0, le=300)
    pa_diastolica: int | None = Field(None, ge=0, le=250)
    fc: int | None = Field(None, ge=0, le=300)
    fr: int | None = Field(None, ge=0, le=100)
    spo2: int | None = Field(None, ge=0, le=100)
    temperatura: float | None = Field(None, ge=25, le=45)
    glicemia: int | None = Field(None, ge=0, le=1000)
    glasgow_ocular: int | None = Field(None, ge=1, le=4)
    glasgow_verbal: int | None = Field(None, ge=1, le=5)
    glasgow_motora: int | None = Field(None, ge=1, le=6)
    manchester: Manchester | None = None
    start: Start | None = None
    medicamentos: list[MedicamentoAdministrado] = []
    versao_base: int | None = Field(None, description="Versão lida pelo cliente; diferente da atual gera 409")
    alterado_no_cliente_em: datetime | None = None

    @model_validator(mode="after")
    def glasgow_completa(self):
        partes = [self.glasgow_ocular, self.glasgow_verbal, self.glasgow_motora]
        if any(p is not None for p in partes) and any(p is None for p in partes):
            raise ValueError("Informe os três componentes da Escala de Glasgow (ocular, verbal e motora)")
        return self


class EnvioEmail(BaseModel):
    destinatario: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
