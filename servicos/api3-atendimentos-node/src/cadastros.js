import { criarRepositorio } from './repositorio.js';
import { rotasCrud } from './crud.js';

// Pessoas (pacientes) e medicamentos da API 3. Os atendimentos ficam em
// atendimentos.js; os prontuários pertencem à API 2 (Go).

const TODOS_PERFIS = ['admin', 'medico', 'enfermeiro', 'socorrista'];

export const pacientes = criarRepositorio({
  tabela: 'paciente',
  colunas: ['nome', 'cpf', 'data_nascimento', 'sexo', 'telefone', 'email',
    'contato_emergencia_nome', 'contato_emergencia_telefone', 'alterado_no_cliente_em'],
  camposBusca: ['nome', 'cpf'],
  registraCriador: true,
});

export const medicamentos = criarRepositorio({
  tabela: 'medicamento',
  colunas: ['nome', 'principio_ativo', 'apresentacao', 'concentracao', 'via_padrao', 'alerta'],
  camposBusca: ['nome', 'principio_ativo'],
});

function dataValida(texto) {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(Date.parse(texto)) && new Date(texto) <= new Date();
}

// Também normaliza o CPF, aceitando "111.222.333-44".
function validarPaciente(d) {
  const erros = [];
  if (!d.nome) erros.push('Nome é obrigatório');
  if (d.cpf) {
    d.cpf = String(d.cpf).replace(/\D/g, '');
    if (d.cpf.length !== 11) erros.push('CPF deve ter 11 dígitos');
  }
  if (d.sexo && !['M', 'F', 'O'].includes(d.sexo)) erros.push('Sexo deve ser M, F ou O');
  if (d.data_nascimento && !dataValida(d.data_nascimento)) erros.push('Data de nascimento inválida');
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) erros.push('E-mail inválido');
  return erros;
}

function validarMedicamento(d) {
  return d.nome ? [] : ['Nome é obrigatório'];
}

export const rotasPacientes = rotasCrud({
  repo: pacientes,
  validar: validarPaciente,
  perfisEscrita: TODOS_PERFIS,
});

export const rotasMedicamentos = rotasCrud({
  repo: medicamentos,
  validar: validarMedicamento,
  perfisEscrita: ['admin'],
});
