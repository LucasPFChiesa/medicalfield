"""Testes de integração com o banco medicalfield_teste (recriado antes da execução)."""
import os
import time
from datetime import datetime, timezone
from uuid import uuid4

import jwt
import psycopg
import pytest
from psycopg.rows import dict_row
from fastapi.testclient import TestClient

assert os.environ.get("DB_NOME") == "medicalfield_teste", "os testes devem usar o banco de teste"

from app import envio_email  # noqa: E402
from app.db import pool  # noqa: E402
from app.main import app  # noqa: E402

cliente = TestClient(app)


def token_de(numero_registro):
    with pool.connection() as con:
        p = con.execute("SELECT id, nome, perfil FROM profissional WHERE numero_registro = %s",
                        (numero_registro,)).fetchone()
    dados = {"sub": str(p["id"]), "nome": p["nome"], "perfil": p["perfil"], "exp": int(time.time()) + 600}
    return {"Authorization": "Bearer " + jwt.encode(dados, os.environ["JWT_SEGREDO"], algorithm="HS256")}


SOCORRISTA = token_de("SOC-0042")
ADMIN = token_de("admin")


@pytest.fixture(scope="module")
def ids():
    with pool.connection() as con:
        paciente = con.execute("SELECT id FROM paciente WHERE cpf = '11122233344'").fetchone()["id"]
        medicamento = con.execute("SELECT id FROM medicamento WHERE nome = 'Dipirona sódica'").fetchone()["id"]
    return {"paciente": str(paciente), "medicamento": str(medicamento)}


def novo_atendimento(ids, **extra):
    agora = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid4()),
        "paciente_id": ids["paciente"],
        "data_hora": agora,
        "tipo_ocorrencia": "trauma",
        "local": "Rua de Teste, 100",
        "descricao": "Queda de bicicleta com escoriações.",
        "pa_sistolica": 120, "pa_diastolica": 80, "fc": 90, "spo2": 98,
        "glasgow_ocular": 4, "glasgow_verbal": 5, "glasgow_motora": 6,
        "manchester": "verde", "start": "verde",
        "medicamentos": [{"medicamento_id": ids["medicamento"], "dose": 1, "unidade": "g", "via": "IV", "horario": agora}],
        **extra,
    }


def test_exige_token():
    assert cliente.get("/api/atendimento").status_code == 401
    assert cliente.get("/api/atendimento", headers={"Authorization": "Bearer falso"}).status_code == 401


def test_cria_e_consulta_atendimento(ids):
    corpo = novo_atendimento(ids)
    r = cliente.post("/api/atendimento", json=corpo, headers=SOCORRISTA)
    assert r.status_code == 201, r.text
    criado = r.json()
    assert criado["glasgow_total"] == 15
    assert criado["prontuario_id"] is not None  # preenchido com o prontuário do paciente
    assert criado["profissional_nome"] == "Marcos Dalpiaz"
    assert criado["medicamentos"][0]["medicamento_nome"] == "Dipirona sódica"

    da_pessoa = cliente.get(f"/api/atendimento/{ids['paciente']}", headers=SOCORRISTA).json()
    assert corpo["id"] in [a["id"] for a in da_pessoa]

    assert cliente.post("/api/atendimento", json=corpo, headers=SOCORRISTA).status_code == 409


def test_validacoes(ids):
    r = cliente.post("/api/atendimento", headers=SOCORRISTA,
                     json=novo_atendimento(ids, manchester="roxo", spo2=150))
    assert r.status_code == 400
    assert r.json()["detalhes"] == [
        "spo2: deve ser no máximo 100",
        "manchester: deve ser um destes valores: 'vermelho', 'laranja', 'amarelo', 'verde' ou 'azul'",
    ]

    r = cliente.post("/api/atendimento", headers=SOCORRISTA, json=novo_atendimento(ids, glasgow_verbal=None))
    assert r.status_code == 400
    assert "Escala de Glasgow" in r.json()["detalhes"][0]

    r = cliente.post("/api/atendimento", headers=SOCORRISTA, json=novo_atendimento(ids, paciente_id=str(uuid4())))
    assert r.status_code == 400


def test_controle_de_versao_e_exclusao(ids):
    corpo = novo_atendimento(ids)
    cliente.post("/api/atendimento", json=corpo, headers=SOCORRISTA)

    r = cliente.put(f"/api/atendimento/{corpo['id']}", headers=SOCORRISTA,
                    json={**corpo, "descricao": "Descrição revisada", "medicamentos": [], "versao_base": 1})
    assert r.status_code == 200
    assert r.json()["versao"] == 2 and r.json()["medicamentos"] == []

    r = cliente.put(f"/api/atendimento/{corpo['id']}", headers=SOCORRISTA, json={**corpo, "versao_base": 1})
    assert r.status_code == 409
    assert r.json()["atual"]["descricao"] == "Descrição revisada"

    assert cliente.delete(f"/api/atendimento/{corpo['id']}", headers=SOCORRISTA).status_code == 403
    assert cliente.delete(f"/api/atendimento/{corpo['id']}", headers=ADMIN).status_code == 200
    assert cliente.get(f"/api/atendimento/detalhe/{corpo['id']}", headers=ADMIN).status_code == 404


def test_gera_pdf(ids):
    corpo = novo_atendimento(ids)
    cliente.post("/api/atendimento", json=corpo, headers=SOCORRISTA)
    r = cliente.get(f"/api/atendimento/{corpo['id']}/pdf", headers=SOCORRISTA)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert "ficha-atendimento-" in r.headers["content-disposition"]


def test_envia_email_com_anexo(ids, monkeypatch):
    enviados = []

    class SmtpFalso:
        def __init__(self, host, porta, timeout):
            self.host = host
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def starttls(self):
            pass
        def login(self, usuario, senha):
            pass
        def send_message(self, mensagem):
            enviados.append(mensagem)

    monkeypatch.setattr(envio_email.smtplib, "SMTP", SmtpFalso)
    corpo = novo_atendimento(ids)
    cliente.post("/api/atendimento", json=corpo, headers=SOCORRISTA)

    assert cliente.post(f"/api/atendimento/{corpo['id']}/email", json={"destinatario": "invalido"},
                        headers=SOCORRISTA).status_code == 400
    r = cliente.post(f"/api/atendimento/{corpo['id']}/email", json={"destinatario": "familia@exemplo.com"},
                     headers=SOCORRISTA)
    assert r.status_code == 200, r.text
    mensagem = enviados[0]
    assert mensagem["To"] == "familia@exemplo.com"
    anexo = next(mensagem.iter_attachments())
    assert anexo.get_content_type() == "application/pdf"
    assert anexo.get_content().startswith(b"%PDF")


def test_log_de_acesso():
    cliente.get("/api/atendimento", headers=SOCORRISTA)
    # mf_atendimentos só insere logs; a leitura é feita com o usuário administrador do banco
    with psycopg.connect(dbname="medicalfield_teste", row_factory=dict_row) as con:
        log = con.execute(
            """SELECT * FROM log_acesso WHERE servico = 'atendimentos' AND rota = '/api/atendimento'
               ORDER BY id DESC LIMIT 1""").fetchone()
    assert log["metodo"] == "GET" and log["status"] == 200
    assert log["profissional_id"] is not None
    assert float(log["duracao_ms"]) > 0
