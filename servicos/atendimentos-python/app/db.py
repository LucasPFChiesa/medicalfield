import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# Singleton: o módulo é importado uma única vez, então todo o serviço usa
# este mesmo pool de conexões.
pool = ConnectionPool(
    conninfo=(
        f"host={os.environ.get('DB_HOST', 'localhost')} "
        f"dbname={os.environ.get('DB_NOME', 'medicalfield')} "
        f"user=mf_atendimentos password={os.environ.get('DB_SENHA_ATENDIMENTOS', '')}"
    ),
    kwargs={"row_factory": dict_row},
    min_size=1,
    max_size=5,
    open=True,
)
