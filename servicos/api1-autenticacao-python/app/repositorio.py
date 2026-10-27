from uuid import UUID

from .db import pool

# Repository: todo o SQL da API 1 fica aqui; as rotas só chamam funções.
# Esta API é dona de "profissional" (login) e lê os dados clínicos para a ficha.

COLUNAS_PROFISSIONAL = "id, nome, tipo_registro, numero_registro, perfil, email, ativo"


# ---------- Profissionais (login) ----------

def buscar_para_login(tipo_registro: str, numero_registro: str):
    with pool.connection() as con:
        return con.execute(
            "SELECT * FROM profissional WHERE tipo_registro = %s AND numero_registro = %s AND ativo",
            (tipo_registro, numero_registro),
        ).fetchone()


def listar_profissionais():
    with pool.connection() as con:
        return con.execute(f"SELECT {COLUNAS_PROFISSIONAL} FROM profissional ORDER BY nome").fetchall()


def buscar_profissional(profissional_id: UUID):
    with pool.connection() as con:
        return con.execute(f"SELECT {COLUNAS_PROFISSIONAL} FROM profissional WHERE id = %s", (profissional_id,)).fetchone()


def criar_profissional(dados: dict, senha_hash: str):
    with pool.connection() as con:
        return con.execute(
            f"""INSERT INTO profissional (nome, tipo_registro, numero_registro, senha_hash, perfil, email)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING {COLUNAS_PROFISSIONAL}""",
            (dados["nome"], dados["tipo_registro"], dados["numero_registro"], senha_hash, dados["perfil"], dados.get("email")),
        ).fetchone()


# senha_hash e ativo só mudam quando vierem preenchidos.
def atualizar_profissional(profissional_id: UUID, dados: dict, senha_hash: str | None):
    with pool.connection() as con:
        return con.execute(
            f"""UPDATE profissional SET nome = %s, tipo_registro = %s, numero_registro = %s, perfil = %s, email = %s,
                       ativo = COALESCE(%s, ativo), senha_hash = COALESCE(%s, senha_hash)
                WHERE id = %s RETURNING {COLUNAS_PROFISSIONAL}""",
            (dados["nome"], dados["tipo_registro"], dados["numero_registro"], dados["perfil"], dados.get("email"),
             dados.get("ativo"), senha_hash, profissional_id),
        ).fetchone()


# Profissionais não são excluídos, só desativados: continuam responsáveis
# pelos atendimentos que registraram.
def desativar_profissional(profissional_id: UUID):
    with pool.connection() as con:
        return con.execute(
            f"UPDATE profissional SET ativo = false WHERE id = %s RETURNING {COLUNAS_PROFISSIONAL}",
            (profissional_id,),
        ).fetchone()


# ---------- Logs ----------

def listar_auditoria(limite: int, servico: str | None):
    filtro, params = "", [limite]
    if servico:
        filtro, params = "WHERE l.servico = %s", [servico, limite]
    with pool.connection() as con:
        return con.execute(
            f"""SELECT l.*, p.nome AS profissional_nome
                FROM log_acesso l LEFT JOIN profissional p ON p.id = l.profissional_id
                {filtro} ORDER BY l.id DESC LIMIT %s""",
            params,
        ).fetchall()


# Logs gravados pelo app do socorrista enquanto estava offline (origem = cliente).
def gravar_logs_do_cliente(logs: list[dict], ip: str | None, profissional_id: str):
    with pool.connection() as con:
        for log in logs:
            con.execute(
                """INSERT INTO log_acesso (data_hora, servico, origem, ip, profissional_id, metodo, rota, status, duracao_ms)
                   VALUES (%s, 'app-socorrista', 'cliente', %s, %s, %s, %s, %s, %s)""",
                (log["data_hora"], ip, profissional_id, log["metodo"], log["rota"], log["status"], log["duracao_ms"]),
            )


# ---------- Ficha de atendimento (só leitura) ----------

CONSULTA_ATENDIMENTO = """
    SELECT a.*, pa.nome AS paciente_nome, pr.nome AS profissional_nome,
           pr.tipo_registro || ' ' || pr.numero_registro AS profissional_registro
    FROM atendimento a
    JOIN paciente pa ON pa.id = a.paciente_id
    JOIN profissional pr ON pr.id = a.profissional_id
"""


def buscar_para_ficha(atendimento_id: UUID):
    """Junta tudo que a ficha precisa: atendimento, medicamentos, paciente e prontuário."""
    with pool.connection() as con:
        atendimento = con.execute(
            f"{CONSULTA_ATENDIMENTO} WHERE a.id = %s AND a.excluido_em IS NULL", (atendimento_id,)
        ).fetchone()
        if not atendimento:
            return None
        atendimento["medicamentos"] = con.execute(
            """SELECT ma.*, m.nome AS medicamento_nome
               FROM medicamento_administrado ma JOIN medicamento m ON m.id = ma.medicamento_id
               WHERE ma.atendimento_id = %s ORDER BY ma.horario""",
            (atendimento_id,),
        ).fetchall()
        atendimento["paciente"] = con.execute(
            "SELECT * FROM paciente WHERE id = %s", (atendimento["paciente_id"],)
        ).fetchone()
        atendimento["prontuario"] = con.execute(
            "SELECT * FROM prontuario WHERE paciente_id = %s AND excluido_em IS NULL",
            (atendimento["paciente_id"],),
        ).fetchone()
    return atendimento
