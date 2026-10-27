package main

import (
	"context"
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
			 VALUES ('api2', $1, $2, $3, $4, $5, $6)`,
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
