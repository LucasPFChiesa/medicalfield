package main

import "time"

// Strategy: cada entidade tem uma regra para decidir quem vence quando o
// cliente envia uma alteração baseada numa versão que já mudou no servidor.
type EstrategiaConflito interface {
	Nome() string
	ClienteVence(cliente, servidor map[string]any) bool
}

// UltimaEscritaVence compara quando cada lado alterou o registro pela última
// vez e fica com a alteração mais recente.
type UltimaEscritaVence struct{}

func (UltimaEscritaVence) Nome() string { return "última escrita vence" }

func (UltimaEscritaVence) ClienteVence(cliente, servidor map[string]any) bool {
	alteradoCliente, okCliente := lerData(cliente, "alterado_no_cliente_em")
	alteradoServidor, okServidor := lerData(servidor, "alterado_no_cliente_em")
	if !okServidor {
		alteradoServidor, okServidor = lerData(servidor, "atualizado_em")
	}
	if !okCliente {
		return false
	}
	return !okServidor || !alteradoCliente.Before(alteradoServidor)
}

// ServidorVence mantém o que já está no servidor. Usada nos atendimentos:
// um registro clínico consolidado não é sobrescrito silenciosamente; a versão
// do cliente fica guardada em sync_operacao para análise.
type ServidorVence struct{}

func (ServidorVence) Nome() string { return "servidor vence" }

func (ServidorVence) ClienteVence(cliente, servidor map[string]any) bool { return false }

var estrategias = map[string]EstrategiaConflito{
	"paciente":    UltimaEscritaVence{},
	"prontuario":  UltimaEscritaVence{},
	"atendimento": ServidorVence{},
}

func lerData(registro map[string]any, campo string) (time.Time, bool) {
	texto, ok := registro[campo].(string)
	if !ok {
		return time.Time{}, false
	}
	data, err := time.Parse(time.RFC3339Nano, texto)
	return data, err == nil
}
