package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Singleton: um único pool de conexões, criado em main e usado por todos os handlers.
var banco *pgxpool.Pool

func variavel(nome, padrao string) string {
	if valor := os.Getenv(nome); valor != "" {
		return valor
	}
	return padrao
}

func conectarBanco() *pgxpool.Pool {
	dsn := "host=" + variavel("DB_HOST", "localhost") +
		" dbname=" + variavel("DB_NOME", "medicalfield") +
		" user=mf_api2 password=" + os.Getenv("DB_SENHA_API2") +
		" pool_max_conns=5"
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("configuração do banco inválida: %v", err)
	}
	return pool
}

// API 2 - Prontuários e sincronização (Go)
//   GET/POST /api/prontuario e GET /api/prontuario/{id}   (prontuarios.go)
//   POST /api/sync/push   recebe a fila de operações feitas offline no app (push.go)
//   GET  /api/sync/pull   devolve o que mudou desde o último cursor (pull.go)
//   GET  /api/sync/operacoes[/{id}]   rastro das sincronizações, usado pelo portal
// Todas as rotas, menos a especificação OpenAPI, exigem Authorization: Bearer <token>.
func rotas() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/openapi/api2.json", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, variavel("OPENAPI_API2", "openapi.json"))
	})

	protegidas := http.NewServeMux()
	protegidas.HandleFunc("POST /api/sync/push", push)
	protegidas.HandleFunc("GET /api/sync/pull", pull)
	protegidas.HandleFunc("GET /api/sync/operacoes", listarOperacoes)
	protegidas.HandleFunc("GET /api/sync/operacoes/{id}", detalharOperacao)
	protegidas.HandleFunc("GET /api/prontuario", listarProntuarios)
	protegidas.HandleFunc("GET /api/prontuario/{id}", obterProntuario)
	protegidas.HandleFunc("POST /api/prontuario", criarProntuario)
	protegidas.HandleFunc("PUT /api/prontuario/{id}", atualizarProntuario)
	protegidas.HandleFunc("DELETE /api/prontuario/{id}", excluirProntuario)
	mux.Handle("/api/", exigirToken(protegidas))

	return registrarAcesso(mux)
}

func responderJSON(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func responderErro(w http.ResponseWriter, status int, mensagem string) {
	responderJSON(w, status, map[string]string{"erro": mensagem})
}

func main() {
	if os.Getenv("JWT_SEGREDO") == "" {
		log.Fatal("JWT_SEGREDO não configurado")
	}
	banco = conectarBanco()
	defer banco.Close()

	endereco := "127.0.0.1:" + variavel("PORTA_API2", "8002")
	servidor := &http.Server{
		Addr:         endereco,
		Handler:      rotas(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
	}
	log.Printf("API 2 (prontuários e sincronização) ouvindo em %s", endereco)
	log.Fatal(servidor.ListenAndServe())
}
