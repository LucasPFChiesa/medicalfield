from uuid import UUID, uuid4

from .db import pool

# Repository: todo o SQL de atendimentos fica aqui; as rotas só chamam funções.

CAMPOS = [
    "paciente_id", "prontuario_id", "data_hora", "tipo_ocorrencia", "local", "descricao",
    "pa_sistolica", "pa_diastolica", "fc", "fr", "spo2", "temperatura", "glicemia",
    "glasgow_ocular", "glasgow_verbal", "glasgow_motora", "manchester", "start",
    "alterado_no_cliente_em",
]

CONSULTA = """
    SELECT a.*, pa.nome AS paciente_nome, pr.nome AS profissional_nome,
           pr.tipo_registro || ' ' || pr.numero_registro AS profissional_registro
    FROM atendimento a
    JOIN paciente pa ON pa.id = a.paciente_id
    JOIN profissional pr ON pr.id = a.profissional_id
"""


class ErroValidacao(Exception):
    pass


def _medicamentos(con, atendimento_id):
    return con.execute(
        """SELECT ma.*, m.nome AS medicamento_nome
           FROM medicamento_administrado ma JOIN medicamento m ON m.id = ma.medicamento_id
           WHERE ma.atendimento_id = %s ORDER BY ma.horario""",
        (atendimento_id,),
    ).fetchall()


def listar(paciente_id: UUID | None = None):
    filtro, params = "", []
    if paciente_id:
        filtro, params = " AND a.paciente_id = %s", [paciente_id]
    with pool.connection() as con:
        return con.execute(
            f"{CONSULTA} WHERE a.excluido_em IS NULL{filtro} ORDER BY a.data_hora DESC, a.criado_em DESC", params
        ).fetchall()


def buscar(atendimento_id: UUID):
    with pool.connection() as con:
        atendimento = con.execute(f"{CONSULTA} WHERE a.id = %s", (atendimento_id,)).fetchone()
        if atendimento:
            atendimento["medicamentos"] = _medicamentos(con, atendimento_id)
        return atendimento


def buscar_para_ficha(atendimento_id: UUID):
    atendimento = buscar(atendimento_id)
    if not atendimento or atendimento["excluido_em"]:
        return None
    with pool.connection() as con:
        atendimento["paciente"] = con.execute(
            "SELECT * FROM paciente WHERE id = %s", (atendimento["paciente_id"],)
        ).fetchone()
        atendimento["prontuario"] = con.execute(
            "SELECT * FROM prontuario WHERE paciente_id = %s AND excluido_em IS NULL",
            (atendimento["paciente_id"],),
        ).fetchone()
    return atendimento


def salvar(atendimento_id: UUID, dados: dict, profissional_id: str,
           versao_base: int | None = None, somente_criar: bool = False):
    """Cria ou substitui o atendimento e sua lista de medicamentos numa única transação.
    Com versao_base, só grava se o registro não foi alterado depois da leitura do cliente."""
    with pool.connection() as con:
        atual = con.execute("SELECT * FROM atendimento WHERE id = %s FOR UPDATE", (atendimento_id,)).fetchone()
        if atual and (somente_criar or atual["excluido_em"]
                      or (versao_base is not None and atual["versao"] != versao_base)):
            return {"conflito": True, "atual": atual}

        _conferir_prontuario(con, dados)
        valores = [dados.get(c) for c in CAMPOS]
        if atual:
            sets = ", ".join(f"{c} = %s" for c in CAMPOS)
            con.execute(f"UPDATE atendimento SET {sets} WHERE id = %s", [*valores, atendimento_id])
            con.execute("DELETE FROM medicamento_administrado WHERE atendimento_id = %s", (atendimento_id,))
        else:
            colunas = ["id", "profissional_id", *CAMPOS]
            marcadores = ", ".join(["%s"] * len(colunas))
            con.execute(
                f"INSERT INTO atendimento ({', '.join(colunas)}) VALUES ({marcadores})",
                [atendimento_id, dados.get("profissional_id") or profissional_id, *valores],
            )

        for m in dados.get("medicamentos", []):
            con.execute(
                """INSERT INTO medicamento_administrado
                   (id, atendimento_id, medicamento_id, dose, unidade, via, horario, observacao)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (m.get("id") or uuid4(), atendimento_id, m["medicamento_id"], m["dose"],
                 m["unidade"], m.get("via"), m["horario"], m.get("observacao")),
            )
    return {"criado": atual is None, "registro": buscar(atendimento_id)}


def _conferir_prontuario(con, dados):
    """Se o prontuário não veio, usa o prontuário ativo do paciente; se veio, confere o dono."""
    if dados.get("prontuario_id") is None:
        linha = con.execute(
            "SELECT id FROM prontuario WHERE paciente_id = %s AND excluido_em IS NULL",
            (dados["paciente_id"],),
        ).fetchone()
        dados["prontuario_id"] = linha["id"] if linha else None
        return
    linha = con.execute("SELECT paciente_id FROM prontuario WHERE id = %s", (dados["prontuario_id"],)).fetchone()
    if linha and linha["paciente_id"] != dados["paciente_id"]:
        raise ErroValidacao("O prontuário informado não pertence a este paciente")


def excluir(atendimento_id: UUID):
    with pool.connection() as con:
        return con.execute(
            "UPDATE atendimento SET excluido_em = now() WHERE id = %s AND excluido_em IS NULL RETURNING id",
            (atendimento_id,),
        ).fetchone()
