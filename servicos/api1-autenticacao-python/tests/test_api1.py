"""Testes da API 1 com o banco medicalfield_teste (recriado antes da execução)."""
import os

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

assert os.environ.get("DB_NOME") == "medicalfield_teste", "os testes devem usar o banco de teste"

from app import envio_email  # noqa: E402
from app.main import app  # noqa: E402

cliente = TestClient(app)
SENHA = os.environ["SENHA_DEMO"]
ATENDIMENTO_DO_SEED = "7f1c2a10-0000-4000-8000-000000000001"


def entrar(tipo, numero):
    r = cliente.post("/api/auth/login", json={"tipo_registro": tipo, "numero_registro": numero, "senha": SENHA})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


@pytest.fixture(scope="module")
def admin():
    return entrar("CRM", "admin")


@pytest.fixture(scope="module")
def socorrista():
    return entrar("SOCORRISTA", "SOC-0042")


def test_login_devolve_token_e_dados_publicos(socorrista):
    r = cliente.post("/api/auth/login", json={"tipo_registro": "SOCORRISTA", "numero_registro": "SOC-0042", "senha": SENHA})
    assert r.json()["profissional"]["nome"] == "Socorrista Teste"
    assert "senha_hash" not in r.json()["profissional"]
    assert cliente.get("/api/auth/eu", headers=socorrista).json()["perfil"] == "socorrista"


def test_login_com_senha_errada_e_recusado():
    r = cliente.post("/api/auth/login", json={"tipo_registro": "CRM", "numero_registro": "admin", "senha": "errada"})
    assert r.status_code == 401
    assert "token" not in r.json()


def test_rotas_exigem_token():
    assert cliente.get("/api/auth/eu").status_code == 401
    assert cliente.get("/api/documento/pdf", params={"atendimento_id": ATENDIMENTO_DO_SEED}).status_code == 401
    assert cliente.post("/api/log", json={"logs": []}, headers={"Authorization": "Bearer falso"}).status_code == 401


def test_profissionais_somente_admin(admin, socorrista):
    assert cliente.get("/api/profissional", headers=socorrista).status_code == 403
    novo = cliente.post("/api/profissional", headers=admin, json={
        "nome": "Novo Socorrista", "tipo_registro": "SOCORRISTA", "numero_registro": "SOC-TESTE",
        "perfil": "socorrista", "senha": "senha-teste"})
    assert novo.status_code == 201, novo.text
    assert "senha_hash" not in novo.json()
    login = cliente.post("/api/auth/login", json={"tipo_registro": "SOCORRISTA", "numero_registro": "SOC-TESTE", "senha": "senha-teste"})
    assert login.status_code == 200

    repetido = cliente.post("/api/profissional", headers=admin, json={
        "nome": "Outro", "tipo_registro": "SOCORRISTA", "numero_registro": "SOC-TESTE", "perfil": "socorrista", "senha": "123456"})
    assert repetido.status_code == 409

    desativado = cliente.delete(f"/api/profissional/{novo.json()['id']}", headers=admin)
    assert desativado.json()["ativo"] is False
    assert cliente.post("/api/auth/login", json={"tipo_registro": "SOCORRISTA", "numero_registro": "SOC-TESTE", "senha": "senha-teste"}).status_code == 401


def test_gera_pdf(socorrista):
    r = cliente.get("/api/documento/pdf", params={"atendimento_id": ATENDIMENTO_DO_SEED}, headers=socorrista)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert "ficha-atendimento-" in r.headers["content-disposition"]
    inexistente = cliente.get("/api/documento/pdf", params={"atendimento_id": "00000000-0000-4000-8000-000000000000"}, headers=socorrista)
    assert inexistente.status_code == 404


def test_envia_email_com_anexo(socorrista, monkeypatch):
    enviados = []

    class SmtpFalso:
        def __init__(self, host, porta, timeout):
            pass
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
    invalido = cliente.post("/api/email/enviar", headers=socorrista, json={"atendimento_id": ATENDIMENTO_DO_SEED, "destinatario": "x"})
    assert invalido.status_code == 400
    r = cliente.post("/api/email/enviar", headers=socorrista,
                     json={"atendimento_id": ATENDIMENTO_DO_SEED, "destinatario": "familia@exemplo.com"})
    assert r.status_code == 200, r.text
    anexo = next(enviados[0].iter_attachments())
    assert enviados[0]["To"] == "familia@exemplo.com"
    assert anexo.get_content_type() == "application/pdf"
    assert anexo.get_content().startswith(b"%PDF")


def test_logs_do_app_e_auditoria(admin, socorrista):
    r = cliente.post("/api/log", headers=socorrista, json={"dispositivo_id": "teste", "logs": [
        {"data_hora": "2026-10-20T15:00:00Z", "metodo": "LOCAL", "rota": "criar paciente (offline)", "status": 0, "duracao_ms": 2.5}]})
    assert r.status_code == 201 and r.json()["recebidos"] == 1

    assert cliente.get("/api/auditoria", headers=socorrista).status_code == 403
    logs = cliente.get("/api/auditoria", params={"limite": 50}, headers=admin).json()
    doApp = next(l for l in logs if l["servico"] == "app-socorrista")
    assert doApp["origem"] == "cliente" and doApp["profissional_nome"] == "Socorrista Teste"


def test_middleware_grava_log_de_acesso(socorrista):
    cliente.get("/api/auth/eu", headers=socorrista)
    with psycopg.connect(dbname="medicalfield_teste", row_factory=dict_row) as con:
        log = con.execute("SELECT * FROM log_acesso WHERE servico = 'api1' AND rota = '/api/auth/eu' ORDER BY id DESC LIMIT 1").fetchone()
    assert log["metodo"] == "GET" and log["status"] == 200
    assert log["profissional_id"] is not None and float(log["duracao_ms"]) > 0
