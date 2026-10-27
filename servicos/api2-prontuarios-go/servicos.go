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

// Comunicação entre as APIs na sincronização.
// A API 2 só grava nas próprias tabelas. O prontuário é dela, então é gravado
// direto (salvarProntuario). Pessoa e atendimento são da API 3 (Node): a API 2
// chama a API 3 por HTTP interno, repassando o token do profissional, assim a
// API 3 confere a permissão e o log dela mostra quem fez a operação.
var donos = map[string]struct{ variavelURL, padraoURL, caminho string }{
	"paciente":    {"URL_API3", "http://127.0.0.1:3001", "/api/pessoa/"},
	"atendimento": {"URL_API3", "http://127.0.0.1:3001", "/api/atendimento/"},
}

var entidadesSincronizadas = []string{"paciente", "prontuario", "atendimento"}

func aplicarOperacao(ctx context.Context, op Operacao, versaoBase *int, info *requisicao) (respostaDono, error) {
	if op.Entidade != "prontuario" {
		return encaminhar(ctx, op, versaoBase, info.token)
	}
	if op.Acao == "excluir" {
		return respostaDono{http.StatusForbidden, map[string]any{"erro": "O app não exclui prontuários"}}, nil
	}
	dados := map[string]any{}
	for chave, valor := range op.Dados {
		dados[chave] = valor
	}
	return salvarProntuario(ctx, op.EntidadeID, dados, versaoBase, false, info.profissionalID)
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
