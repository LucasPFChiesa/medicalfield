package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// Consulta base de cada entidade enviada ao app. O atendimento leva junto a
// lista de medicamentos administrados; do profissional vão só dados públicos.
var consultas = map[string]string{
	"paciente":    `SELECT t.* FROM paciente t`,
	"prontuario":  `SELECT t.* FROM prontuario t`,
	"medicamento": `SELECT t.* FROM medicamento t`,
	"atendimento": `SELECT t.*, (SELECT coalesce(json_agg(m ORDER BY m.horario), '[]')
	                             FROM medicamento_administrado m WHERE m.atendimento_id = t.id) AS medicamentos
	                FROM atendimento t`,
	"profissional": `SELECT t.id, t.nome, t.tipo_registro, t.numero_registro, t.perfil, t.ativo, t.seq_alteracao
	                 FROM profissional t`,
}

var listasDoPull = map[string]string{
	"pacientes":     "paciente",
	"prontuarios":   "prontuario",
	"medicamentos":  "medicamento",
	"atendimentos":  "atendimento",
	"profissionais": "profissional",
}

func lerRegistro(ctx context.Context, entidade, id string) (map[string]any, error) {
	var registro map[string]any
	err := banco.QueryRow(ctx, "SELECT row_to_json(x) FROM ("+consultas[entidade]+" WHERE t.id = $1) x", id).Scan(&registro)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return registro, err
}

// GET /api/sync/pull?desde=N devolve tudo que mudou depois do cursor N,
// inclusive registros excluídos (para o app removê-los também).
// Todas as consultas usam a mesma fotografia do banco (REPEATABLE READ),
// então o novo cursor corresponde exatamente aos dados enviados.
func pull(w http.ResponseWriter, r *http.Request) {
	desde, err := strconv.ParseInt(r.URL.Query().Get("desde"), 10, 64)
	if err != nil || desde < 0 {
		desde = 0
	}

	tx, err := banco.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao acessar o banco")
		return
	}
	defer tx.Rollback(r.Context())

	resposta := map[string]any{}
	for lista, entidade := range listasDoPull {
		var registros json.RawMessage
		err := tx.QueryRow(r.Context(),
			"SELECT coalesce(json_agg(x ORDER BY x.seq_alteracao), '[]') FROM ("+consultas[entidade]+" WHERE t.seq_alteracao > $1) x",
			desde).Scan(&registros)
		if err != nil {
			responderErro(w, http.StatusInternalServerError, "Erro ao consultar "+lista)
			return
		}
		resposta[lista] = registros
	}

	var cursor int64
	err = tx.QueryRow(r.Context(), `SELECT greatest($1::bigint,
		(SELECT coalesce(max(seq_alteracao), 0) FROM paciente),
		(SELECT coalesce(max(seq_alteracao), 0) FROM prontuario),
		(SELECT coalesce(max(seq_alteracao), 0) FROM medicamento),
		(SELECT coalesce(max(seq_alteracao), 0) FROM atendimento),
		(SELECT coalesce(max(seq_alteracao), 0) FROM profissional))`, desde).Scan(&cursor)
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao calcular o cursor")
		return
	}
	resposta["cursor"] = cursor
	responderJSON(w, http.StatusOK, resposta)
}
