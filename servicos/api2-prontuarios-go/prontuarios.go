package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Prontuários: a API 2 é dona da tabela "prontuario".
//   GET    /api/prontuario        lista (filtro opcional ?busca= pelo nome do paciente)
//   GET    /api/prontuario/{id}   aceita o id do prontuário ou o id da pessoa
//   POST   /api/prontuario        cadastra
//   PUT    /api/prontuario/{id}   cria ou atualiza, com controle de versão (versao_base)
//   DELETE /api/prontuario/{id}   exclusão lógica (somente admin)
// A sincronização (push.go) usa a mesma função salvarProntuario.

var camposProntuario = []string{"paciente_id", "tipo_sanguineo", "alergias", "comorbidades", "uso_continuo", "observacoes", "alterado_no_cliente_em"}

var tiposSanguineos = []string{"A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"}

const consultaProntuario = `SELECT pr.*, pa.nome AS paciente_nome
	FROM prontuario pr JOIN paciente pa ON pa.id = pr.paciente_id`

// ---------- Repository ----------

func lerProntuario(ctx context.Context, id string) (map[string]any, error) {
	var registro map[string]any
	err := banco.QueryRow(ctx, "SELECT row_to_json(x) FROM ("+consultaProntuario+" WHERE pr.id = $1) x", id).Scan(&registro)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return registro, err
}

func lerProntuarioDaPessoa(ctx context.Context, pacienteID string) (map[string]any, error) {
	var registro map[string]any
	err := banco.QueryRow(ctx,
		"SELECT row_to_json(x) FROM ("+consultaProntuario+" WHERE pr.paciente_id = $1 AND pr.excluido_em IS NULL) x",
		pacienteID).Scan(&registro)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return registro, err
}

// valorTexto devolve nil para campo ausente ou vazio, e o texto sem espaços nas pontas.
func valorTexto(dados map[string]any, campo string) any {
	texto, ok := dados[campo].(string)
	if !ok || strings.TrimSpace(texto) == "" {
		return nil
	}
	return strings.TrimSpace(texto)
}

// salvarProntuario cria ou substitui o prontuário com o id informado.
// Com versaoBase, só grava se o registro não mudou desde que o cliente o leu;
// senão devolve 409 com o registro atual. O resultado tem o mesmo formato de
// uma resposta HTTP (status e corpo), para servir à rota e à sincronização.
func salvarProntuario(ctx context.Context, id string, dados map[string]any, versaoBase *int, somenteCriar bool, profissionalID string) (respostaDono, error) {
	if erros := validarProntuario(dados); len(erros) > 0 {
		return respostaDono{http.StatusBadRequest, map[string]any{"erro": "Dados inválidos", "detalhes": erros}}, nil
	}
	if valorTexto(dados, "alterado_no_cliente_em") == nil {
		dados["alterado_no_cliente_em"] = time.Now().UTC().Format(time.RFC3339Nano)
	}

	tx, err := banco.Begin(ctx)
	if err != nil {
		return respostaDono{}, err
	}
	defer tx.Rollback(ctx)

	var atual map[string]any
	err = tx.QueryRow(ctx, "SELECT row_to_json(p) FROM prontuario p WHERE id = $1 FOR UPDATE", id).Scan(&atual)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return respostaDono{}, err
	}
	if atual != nil {
		mudou := versaoBase != nil && int(atual["versao"].(float64)) != *versaoBase
		if somenteCriar || atual["excluido_em"] != nil || mudou {
			registro, _ := lerProntuario(ctx, id)
			mensagem := fmt.Sprintf("O prontuário foi alterado por outra pessoa (versão atual: %v)", atual["versao"])
			if somenteCriar {
				mensagem = "Já existe um prontuário com este id"
			} else if atual["excluido_em"] != nil {
				mensagem = "O prontuário foi excluído"
			}
			return respostaDono{http.StatusConflict, map[string]any{"erro": mensagem, "atual": registro}}, nil
		}
	}

	valores := []any{id}
	for _, campo := range camposProntuario {
		valores = append(valores, valorTexto(dados, campo))
	}
	if atual != nil {
		_, err = tx.Exec(ctx, `UPDATE prontuario SET paciente_id = $2, tipo_sanguineo = $3, alergias = $4, comorbidades = $5,
			uso_continuo = $6, observacoes = $7, alterado_no_cliente_em = $8 WHERE id = $1`, valores...)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO prontuario (id, paciente_id, tipo_sanguineo, alergias, comorbidades,
			uso_continuo, observacoes, alterado_no_cliente_em, criado_por) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			append(valores, nuloSeVazio(profissionalID))...)
	}
	if resposta, tratado := traduzirErroDoBanco(err); tratado {
		return resposta, nil
	}
	if err != nil {
		return respostaDono{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return respostaDono{}, err
	}

	registro, err := lerProntuario(ctx, id)
	status := http.StatusOK
	if atual == nil {
		status = http.StatusCreated
	}
	return respostaDono{status, registro}, err
}

func validarProntuario(dados map[string]any) []string {
	var erros []string
	pacienteID, _ := dados["paciente_id"].(string)
	if !formatoUUID.MatchString(pacienteID) {
		erros = append(erros, "Paciente é obrigatório")
	}
	if tipo := valorTexto(dados, "tipo_sanguineo"); tipo != nil && !slices.Contains(tiposSanguineos, tipo.(string)) {
		erros = append(erros, "Tipo sanguíneo inválido")
	}
	return erros
}

// Erros do PostgreSQL que são culpa dos dados enviados viram 400/409.
func traduzirErroDoBanco(err error) (respostaDono, bool) {
	var erroPg *pgconn.PgError
	if !errors.As(err, &erroPg) {
		return respostaDono{}, false
	}
	switch erroPg.Code {
	case "23505":
		return respostaDono{http.StatusConflict, map[string]any{"erro": "Este paciente já possui prontuário"}}, true
	case "23503":
		return respostaDono{http.StatusBadRequest, map[string]any{"erro": "Paciente informado não existe"}}, true
	}
	return respostaDono{}, false
}

func novoUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ---------- Rotas ----------

func listarProntuarios(w http.ResponseWriter, r *http.Request) {
	var lista json.RawMessage
	err := banco.QueryRow(r.Context(), `SELECT coalesce(json_agg(x ORDER BY x.paciente_nome), '[]') FROM (`+
		consultaProntuario+` WHERE pr.excluido_em IS NULL AND pa.nome ILIKE '%' || $1 || '%') x`,
		r.URL.Query().Get("busca")).Scan(&lista)
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao listar prontuários")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(lista)
}

func obterProntuario(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !formatoUUID.MatchString(id) {
		responderErro(w, http.StatusBadRequest, "id deve ser um UUID")
		return
	}
	registro, err := lerProntuario(r.Context(), id)
	if err == nil && registro == nil {
		registro, err = lerProntuarioDaPessoa(r.Context(), id)
	}
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao consultar o prontuário")
		return
	}
	if registro == nil {
		responderErro(w, http.StatusNotFound, "Registro não encontrado")
		return
	}
	responderJSON(w, http.StatusOK, registro)
}

func lerCorpo(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var dados map[string]any
	if err := json.NewDecoder(r.Body).Decode(&dados); err != nil || dados == nil {
		responderErro(w, http.StatusBadRequest, "JSON inválido")
		return nil, false
	}
	return dados, true
}

func responderGravacao(w http.ResponseWriter, resposta respostaDono, err error) {
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao gravar o prontuário")
		return
	}
	responderJSON(w, resposta.status, resposta.corpo)
}

func criarProntuario(w http.ResponseWriter, r *http.Request) {
	dados, ok := lerCorpo(w, r)
	if !ok {
		return
	}
	id, _ := dados["id"].(string)
	if id == "" {
		id = novoUUID()
	} else if !formatoUUID.MatchString(id) {
		responderErro(w, http.StatusBadRequest, "id deve ser um UUID")
		return
	}
	resposta, err := salvarProntuario(r.Context(), id, dados, nil, true, infoDaRequisicao(r).profissionalID)
	responderGravacao(w, resposta, err)
}

func atualizarProntuario(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !formatoUUID.MatchString(id) {
		responderErro(w, http.StatusBadRequest, "id deve ser um UUID")
		return
	}
	dados, ok := lerCorpo(w, r)
	if !ok {
		return
	}
	var versaoBase *int
	if v, ok := dados["versao_base"].(float64); ok {
		versao := int(v)
		versaoBase = &versao
	}
	resposta, err := salvarProntuario(r.Context(), id, dados, versaoBase, false, infoDaRequisicao(r).profissionalID)
	responderGravacao(w, resposta, err)
}

func excluirProntuario(w http.ResponseWriter, r *http.Request) {
	if infoDaRequisicao(r).perfil != "admin" {
		responderErro(w, http.StatusForbidden, "Seu perfil não tem permissão para esta operação")
		return
	}
	id := r.PathValue("id")
	if !formatoUUID.MatchString(id) {
		responderErro(w, http.StatusBadRequest, "id deve ser um UUID")
		return
	}
	tag, err := banco.Exec(r.Context(), "UPDATE prontuario SET excluido_em = now() WHERE id = $1 AND excluido_em IS NULL", id)
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao excluir o prontuário")
		return
	}
	if tag.RowsAffected() == 0 {
		responderErro(w, http.StatusNotFound, "Registro não encontrado")
		return
	}
	registro, _ := lerProntuario(r.Context(), id)
	responderJSON(w, http.StatusOK, registro)
}
