package main

import "testing"

func TestUltimaEscritaVence(t *testing.T) {
	estrategia := UltimaEscritaVence{}
	servidor := map[string]any{"alterado_no_cliente_em": "2026-10-10T12:00:00.000+00:00"}

	maisRecente := map[string]any{"alterado_no_cliente_em": "2026-10-10T12:30:00Z"}
	if !estrategia.ClienteVence(maisRecente, servidor) {
		t.Error("alteração mais recente do cliente deveria vencer")
	}

	maisAntiga := map[string]any{"alterado_no_cliente_em": "2026-10-10T11:59:00Z"}
	if estrategia.ClienteVence(maisAntiga, servidor) {
		t.Error("alteração mais antiga do cliente não deveria vencer")
	}

	semData := map[string]any{"nome": "x"}
	if estrategia.ClienteVence(semData, servidor) {
		t.Error("alteração sem data não deveria vencer")
	}

	servidorSemDataDoCliente := map[string]any{"atualizado_em": "2026-10-10T13:00:00-03:00"}
	if estrategia.ClienteVence(maisRecente, servidorSemDataDoCliente) {
		t.Error("deveria usar atualizado_em do servidor quando não há alterado_no_cliente_em")
	}
}

func TestServidorVence(t *testing.T) {
	cliente := map[string]any{"alterado_no_cliente_em": "2030-01-01T00:00:00Z"}
	if (ServidorVence{}).ClienteVence(cliente, map[string]any{}) {
		t.Error("na estratégia servidor vence, o cliente nunca vence")
	}
}

func TestEstrategiaPorEntidade(t *testing.T) {
	if estrategias["atendimento"].Nome() != "servidor vence" {
		t.Error("atendimento deve usar servidor vence")
	}
	if estrategias["paciente"].Nome() != "última escrita vence" {
		t.Error("paciente deve usar última escrita vence")
	}
}

func TestValidarOperacao(t *testing.T) {
	valida := Operacao{
		OpID:       "6b1f4c1e-3a52-4d8e-9a65-1f8f3f0c2b11",
		Entidade:   "paciente",
		Acao:       "criar",
		EntidadeID: "0d5f6b9a-8c4e-4b5d-a1e2-3c4d5e6f7a8b",
		Dados:      map[string]any{"nome": "Teste"},
	}
	if msg := validarOperacao(valida); msg != "" {
		t.Errorf("operação válida recusada: %s", msg)
	}

	invalida := valida
	invalida.Entidade = "medicamento"
	if validarOperacao(invalida) == "" {
		t.Error("medicamento não pode ser enviado pelo app")
	}

	invalida = valida
	invalida.OpID = "123"
	if validarOperacao(invalida) == "" {
		t.Error("op_id inválido deveria ser recusado")
	}
}

func TestValidarProntuario(t *testing.T) {
	valido := map[string]any{"paciente_id": "0d5f6b9a-8c4e-4b5d-a1e2-3c4d5e6f7a8b", "tipo_sanguineo": "O+"}
	if erros := validarProntuario(valido); len(erros) != 0 {
		t.Errorf("prontuário válido recusado: %v", erros)
	}
	semPaciente := map[string]any{"tipo_sanguineo": "X"}
	if erros := validarProntuario(semPaciente); len(erros) != 2 {
		t.Errorf("esperava 2 erros (paciente e tipo sanguíneo), veio %v", erros)
	}
}
