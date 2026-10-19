import { criarRepositorio } from './repositorio.js';
import { rotasCrud } from './crud.js';

const TODOS_PERFIS = ['admin', 'medico', 'enfermeiro', 'socorrista'];
const TIPOS_SANGUINEOS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const pacientes = criarRepositorio({
  tabela: 'paciente',
  colunas: ['nome', 'cpf', 'data_nascimento', 'sexo', 'telefone', 'email',
    'contato_emergencia_nome', 'contato_emergencia_telefone', 'alterado_no_cliente_em'],
  camposBusca: ['nome', 'cpf'],
  registraCriador: true,
});

export const prontuarios = criarRepositorio({
  tabela: 'prontuario',
  colunas: ['paciente_id', 'tipo_sanguineo', 'alergias', 'comorbidades', 'uso_continuo',
    'observacoes', 'alterado_no_cliente_em'],
  consulta: `SELECT pr.*, pa.nome AS paciente_nome
             FROM prontuario pr JOIN paciente pa ON pa.id = pr.paciente_id`,
  ordem: 'paciente_nome',
  camposBusca: ['paciente_nome'],
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

function validarProntuario(d) {
  const erros = [];
  if (!d.paciente_id) erros.push('Paciente é obrigatório');
  if (d.tipo_sanguineo && !TIPOS_SANGUINEOS.includes(d.tipo_sanguineo)) erros.push('Tipo sanguíneo inválido');
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

// GET /prontuario/{id} aceita o id do prontuário ou o id da pessoa,
// pois o documento do projeto define a rota como "prontuário de uma pessoa".
export const rotasProntuarios = rotasCrud({
  repo: prontuarios,
  validar: validarProntuario,
  perfisEscrita: TODOS_PERFIS,
  buscarUm: async (id) => (await prontuarios.buscar(id)) ?? prontuarios.buscarPor('paciente_id', id),
});

export const rotasMedicamentos = rotasCrud({
  repo: medicamentos,
  validar: validarMedicamento,
  perfisEscrita: ['admin'],
});
