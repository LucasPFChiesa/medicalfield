package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Operacao é um comando gravado na fila (outbox) do app enquanto ele
// estava offline e enviado aqui quando a conexão volta.
type Operacao struct {
	OpID       string         `json:"op_id"`
	Entidade   string         `json:"entidade"`
	Acao       string         `json:"acao"`
	EntidadeID string         `json:"entidade_id"`
	VersaoBase int            `json:"versao_base"`
	Dados      map[string]any `json:"dados"`
}

type Resultado struct {
	OpID     string         `json:"op_id"`
	Status   string         `json:"status"` // aplicada, duplicada, conflito ou erro
	Mensagem string         `json:"mensagem,omitempty"`
	Retentar bool           `json:"retentar,omitempty"`
	Registro map[string]any `json:"registro,omitempty"`
}

var formatoUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func push(w http.ResponseWriter, r *http.Request) {
	var pedido struct {
		DispositivoID string     `json:"dispositivo_id"`
		Operacoes     []Operacao `json:"operacoes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&pedido); err != nil {
		responderErro(w, http.StatusBadRequest, "JSON inválido")
		return
	}
	if pedido.DispositivoID == "" {
		responderErro(w, http.StatusBadRequest, "dispositivo_id é obrigatório")
		return
	}
	if len(pedido.Operacoes) > 200 {
		responderErro(w, http.StatusBadRequest, "Envie no máximo 200 operações por vez")
		return
	}

	// As operações são processadas na ordem em que foram feitas no
	// dispositivo: pessoa antes do prontuário, prontuário antes do atendimento.
	info := infoDaRequisicao(r)
	resultados := make([]Resultado, 0, len(pedido.Operacoes))
	for _, op := range pedido.Operacoes {
		resultados = append(resultados, processarOperacao(r.Context(), op, pedido.DispositivoID, info))
	}
	responderJSON(w, http.StatusOK, map[string]any{"resultados": resultados})
}

func validarOperacao(op Operacao) string {
	switch {
	case !formatoUUID.MatchString(op.OpID):
		return "op_id deve ser um UUID"
	case !slices.Contains(entidadesSincronizadas, op.Entidade):
		return "entidade deve ser paciente, prontuario ou atendimento"
	case op.Acao != "criar" && op.Acao != "atualizar" && op.Acao != "excluir":
		return "acao deve ser criar, atualizar ou excluir"
	case !formatoUUID.MatchString(op.EntidadeID):
		return "entidade_id deve ser um UUID"
	case op.Acao != "excluir" && op.Dados == nil:
		return "dados são obrigatórios"
	}
	return ""
}

func processarOperacao(ctx context.Context, op Operacao, dispositivo string, info *requisicao) Resultado {
	if mensagem := validarOperacao(op); mensagem != "" {
		return Resultado{OpID: op.OpID, Status: "erro", Mensagem: mensagem}
	}

	// Idempotência: se este op_id já foi processado, devolve o estado atual
	// sem aplicar de novo. Só operações que falharam podem ser reprocessadas.
	var statusAnterior string
	err := banco.QueryRow(ctx, "SELECT status FROM sync_operacao WHERE op_id = $1", op.OpID).Scan(&statusAnterior)
	if err == nil && statusAnterior != "erro" {
		registro, _ := lerRegistro(ctx, op.Entidade, op.EntidadeID)
		return Resultado{OpID: op.OpID, Status: "duplicada", Registro: registro,
			Mensagem: "Operação já recebida antes (" + statusAnterior + "); nada foi gravado de novo"}
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Resultado{OpID: op.OpID, Status: "erro", Mensagem: "Erro ao consultar o banco", Retentar: true}
	}

	atual, err := lerRegistro(ctx, op.Entidade, op.EntidadeID)
	if err != nil {
		return Resultado{OpID: op.OpID, Status: "erro", Mensagem: "Erro ao consultar o banco", Retentar: true}
	}

	var versaoEnvio *int
	mensagem := ""
	if atual != nil {
		versaoAtual := int(atual["versao"].(float64))
		if atual["excluido_em"] != nil {
			return registrar(ctx, op, dispositivo, info, "conflito", "O registro foi excluído no servidor", atual)
		}
		if versaoAtual != op.VersaoBase {
			estrategia := estrategias[op.Entidade]
			if !estrategia.ClienteVence(op.Dados, atual) {
				return registrar(ctx, op, dispositivo, info, "conflito",
					fmt.Sprintf("Conflito resolvido por \"%s\": mantida a versão %d do servidor", estrategia.Nome(), versaoAtual), atual)
			}
			mensagem = fmt.Sprintf("Conflito resolvido por \"%s\": alteração do dispositivo aplicada sobre a versão %d", estrategia.Nome(), versaoAtual)
		}
		versaoEnvio = &versaoAtual
	} else if op.Acao == "excluir" {
		return registrar(ctx, op, dispositivo, info, "erro", "Registro não existe no servidor", nil)
	}

	resposta, err := aplicarOperacao(ctx, op, versaoEnvio, info)
	if err != nil {
		resultado := registrar(ctx, op, dispositivo, info, "erro", err.Error(), nil)
		resultado.Retentar = true
		return resultado
	}

	switch {
	case resposta.status < 300:
		registro, _ := lerRegistro(ctx, op.Entidade, op.EntidadeID)
		return registrar(ctx, op, dispositivo, info, "aplicada", mensagem, registro)
	case resposta.status == http.StatusConflict:
		// alguém alterou o registro entre a leitura acima e a gravação
		registro, _ := lerRegistro(ctx, op.Entidade, op.EntidadeID)
		return registrar(ctx, op, dispositivo, info, "conflito", textoDoErro(resposta), registro)
	default:
		resultado := registrar(ctx, op, dispositivo, info, "erro", textoDoErro(resposta), nil)
		// token expirado ou serviço com falha: vale tentar de novo depois;
		// erro de validação não se resolve reenviando
		resultado.Retentar = resposta.status == http.StatusUnauthorized || resposta.status >= 500
		return resultado
	}
}

// Grava (ou atualiza, em caso de reprocessamento) o rastro da operação.
func registrar(ctx context.Context, op Operacao, dispositivo string, info *requisicao, status, mensagem string, registro map[string]any) Resultado {
	_, err := banco.Exec(ctx, `
		INSERT INTO sync_operacao (op_id, dispositivo_id, profissional_id, entidade, entidade_id, acao,
		                           versao_base, status, payload_cliente, payload_servidor, mensagem, processado_em)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
		ON CONFLICT (op_id) DO UPDATE SET status = $8, payload_servidor = $10, mensagem = $11, processado_em = now()`,
		op.OpID, dispositivo, nuloSeVazio(info.profissionalID), op.Entidade, op.EntidadeID, op.Acao,
		op.VersaoBase, status, op.Dados, registro, nuloSeVazio(mensagem))
	if err != nil {
		return Resultado{OpID: op.OpID, Status: "erro", Mensagem: "Erro ao registrar a operação", Retentar: true}
	}
	return Resultado{OpID: op.OpID, Status: status, Mensagem: mensagem, Registro: registro}
}

func textoDoErro(resposta respostaDono) string {
	texto, _ := resposta.corpo["erro"].(string)
	if texto == "" {
		texto = "Serviço respondeu " + strconv.Itoa(resposta.status)
	}
	if detalhes, ok := resposta.corpo["detalhes"].([]any); ok {
		partes := make([]string, 0, len(detalhes))
		for _, d := range detalhes {
			partes = append(partes, fmt.Sprint(d))
		}
		texto += ": " + strings.Join(partes, "; ")
	}
	return texto
}

func listarOperacoes(w http.ResponseWriter, r *http.Request) {
	limite, err := strconv.Atoi(r.URL.Query().Get("limite"))
	if err != nil || limite <= 0 || limite > 500 {
		limite = 100
	}
	var lista json.RawMessage
	err = banco.QueryRow(r.Context(), `
		SELECT coalesce(json_agg(x), '[]') FROM (
			SELECT s.op_id, s.dispositivo_id, s.profissional_id, p.nome AS profissional_nome, s.entidade,
			       s.entidade_id, s.acao, s.versao_base, s.status, s.mensagem, s.recebido_em, s.processado_em
			FROM sync_operacao s LEFT JOIN profissional p ON p.id = s.profissional_id
			ORDER BY s.recebido_em DESC LIMIT $1) x`, limite).Scan(&lista)
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao consultar operações")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(lista)
}

// GET /api/sync/operacoes/{id}: uma operação com as duas versões do registro,
// a que o dispositivo enviou (payload_cliente) e a que ficou no servidor
// (payload_servidor). Usada no portal para mostrar como um conflito foi resolvido.
func detalharOperacao(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !formatoUUID.MatchString(id) {
		responderErro(w, http.StatusBadRequest, "id deve ser um UUID")
		return
	}
	var operacao json.RawMessage
	err := banco.QueryRow(r.Context(), `
		SELECT row_to_json(x) FROM (
			SELECT s.*, p.nome AS profissional_nome
			FROM sync_operacao s LEFT JOIN profissional p ON p.id = s.profissional_id
			WHERE s.op_id = $1) x`, id).Scan(&operacao)
	if errors.Is(err, pgx.ErrNoRows) {
		responderErro(w, http.StatusNotFound, "Operação não encontrada")
		return
	}
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao consultar a operação")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(operacao)
}
