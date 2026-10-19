package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// O serviço de sincronização não grava nas tabelas dos outros serviços:
// ele chama a API do serviço dono de cada entidade, repassando o token do
// profissional (assim o log do serviço dono também mostra quem fez a operação).
var donos = map[string]struct{ variavelURL, padraoURL, caminho string }{
	"paciente":    {"URL_CADASTROS", "http://127.0.0.1:3001", "/api/pessoa/"},
	"prontuario":  {"URL_CADASTROS", "http://127.0.0.1:3001", "/api/prontuario/"},
	"atendimento": {"URL_ATENDIMENTOS", "http://127.0.0.1:8001", "/api/atendimento/"},
}

var clienteHTTP = &http.Client{Timeout: 20 * time.Second}

type respostaDono struct {
	status int
	corpo  map[string]any
}

func encaminhar(ctx context.Context, op Operacao, versaoBase *int, token string) (respostaDono, error) {
	dono := donos[op.Entidade]
	url := variavel(dono.variavelURL, dono.padraoURL) + dono.caminho + op.EntidadeID

	metodo := http.MethodPut
	var corpo io.Reader
	if op.Acao == "excluir" {
		metodo = http.MethodDelete
	} else {
		dados := map[string]any{}
		for chave, valor := range op.Dados {
			dados[chave] = valor
		}
		dados["versao_base"] = versaoBase
		texto, _ := json.Marshal(dados)
		corpo = bytes.NewReader(texto)
	}

	pedido, err := http.NewRequestWithContext(ctx, metodo, url, corpo)
	if err != nil {
		return respostaDono{}, err
	}
	pedido.Header.Set("Content-Type", "application/json")
	pedido.Header.Set("Authorization", "Bearer "+token)

	resposta, err := clienteHTTP.Do(pedido)
	if err != nil {
		return respostaDono{}, fmt.Errorf("serviço %s indisponível: %w", dono.variavelURL, err)
	}
	defer resposta.Body.Close()

	resultado := respostaDono{status: resposta.StatusCode}
	json.NewDecoder(resposta.Body).Decode(&resultado.corpo)
	return resultado, nil
}
