package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

func main() {
	http.HandleFunc("/saude", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"servico": "sincronizacao",
			"status":  "ok",
		})
	})

	porta := os.Getenv("PORTA_SYNC")
	if porta == "" {
		porta = "3003"
	}

	log.Printf("Servico de sincronizacao na porta %s", porta)
	log.Fatal(http.ListenAndServe(":"+porta, nil))
}

