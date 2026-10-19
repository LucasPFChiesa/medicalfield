package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"time"
)

// Dados preenchidos ao longo da cadeia de middlewares (o de autenticação
// coloca o profissional) e lidos pelo middleware de log no final.
type requisicao struct {
	profissionalID string
	perfil         string
	token          string
}

type chaveContexto struct{}

func infoDaRequisicao(r *http.Request) *requisicao {
	return r.Context().Value(chaveContexto{}).(*requisicao)
}

// Guarda o status enviado, que o http.ResponseWriter não expõe.
type respostaComStatus struct {
	http.ResponseWriter
	status int
}

func (r *respostaComStatus) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func ipDoCliente(r *http.Request) string {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if real := r.Header.Get("X-Real-IP"); real != "" && (host == "127.0.0.1" || host == "::1") {
		return real
	}
	return host
}

func nuloSeVazio(texto string) any {
	if texto == "" {
		return nil
	}
	return texto
}

func registrarAcesso(proximo http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inicio := time.Now()
		info := &requisicao{}
		resposta := &respostaComStatus{ResponseWriter: w, status: http.StatusOK}

		proximo.ServeHTTP(resposta, r.WithContext(context.WithValue(r.Context(), chaveContexto{}, info)))

		duracao := float64(time.Since(inicio).Microseconds()) / 1000
		ip := ipDoCliente(r)
		log.Printf("%s %s %s %s %d %.1fms", ip, valorOuTraco(info.profissionalID), r.Method, r.URL.Path, resposta.status, duracao)
		_, err := banco.Exec(context.Background(),
			`INSERT INTO log_acesso (servico, ip, profissional_id, metodo, rota, status, duracao_ms)
			 VALUES ('sync', $1, $2, $3, $4, $5, $6)`,
			ip, nuloSeVazio(info.profissionalID), r.Method, r.URL.Path, resposta.status, duracao)
		if err != nil {
			log.Printf("falha ao gravar log de acesso: %v", err)
		}
	})
}

func valorOuTraco(texto string) string {
	if texto == "" {
		return "-"
	}
	return texto
}

type logCliente struct {
	DataHora  time.Time `json:"data_hora"`
	Metodo    string    `json:"metodo"`
	Rota      string    `json:"rota"`
	Status    int       `json:"status"`
	DuracaoMs float64   `json:"duracao_ms"`
}

// POST /api/log: recebe os registros de auditoria feitos pelo app enquanto estava offline.
func receberLogs(w http.ResponseWriter, r *http.Request) {
	var pedido struct {
		DispositivoID string       `json:"dispositivo_id"`
		Logs          []logCliente `json:"logs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&pedido); err != nil {
		responderErro(w, http.StatusBadRequest, "JSON inválido")
		return
	}
	if len(pedido.Logs) > 500 {
		responderErro(w, http.StatusBadRequest, "Envie no máximo 500 registros por vez")
		return
	}

	info := infoDaRequisicao(r)
	tx, err := banco.Begin(r.Context())
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao acessar o banco")
		return
	}
	defer tx.Rollback(r.Context())
	for _, l := range pedido.Logs {
		if l.Metodo == "" || l.Rota == "" || l.DataHora.IsZero() {
			responderErro(w, http.StatusBadRequest, "Cada log precisa de data_hora, metodo e rota")
			return
		}
		_, err := tx.Exec(r.Context(),
			`INSERT INTO log_acesso (data_hora, servico, origem, ip, profissional_id, metodo, rota, status, duracao_ms)
			 VALUES ($1, 'app-socorrista', 'cliente', $2, $3, $4, $5, $6, $7)`,
			l.DataHora, ipDoCliente(r), info.profissionalID, l.Metodo, l.Rota, l.Status, l.DuracaoMs)
		if err != nil {
			responderErro(w, http.StatusInternalServerError, "Erro ao gravar logs")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		responderErro(w, http.StatusInternalServerError, "Erro ao gravar logs")
		return
	}
	responderJSON(w, http.StatusCreated, map[string]int{"recebidos": len(pedido.Logs)})
}
