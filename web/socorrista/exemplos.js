// Dados fictícios para preencher os formulários rapidamente durante testes e
// na apresentação. Nada aqui é gravado sozinho: o usuário ainda clica em Salvar.

const NOMES = ['Carla Mendes', 'Diego Schneider', 'Fernanda Lima', 'Gustavo Rech', 'Isabela Konrad', 'Paulo Bertoldi'];

const OCORRENCIAS = [
  {
    tipo_ocorrencia: 'queda', local: 'Rua Bento Gonçalves, 300 - Lajeado',
    descricao: 'Queda da própria altura, dor no punho direito, sem perda de consciência.',
    pa_sistolica: 128, pa_diastolica: 82, fc: 92, fr: 18, spo2: 98, temperatura: 36.4,
    glasgow_ocular: 4, glasgow_verbal: 5, glasgow_motora: 6, manchester: 'verde', start: '',
    medicamento: 'Dipirona sódica', dose: 1, unidade: 'g',
  },
  {
    tipo_ocorrencia: 'acidente_transito', local: 'RS-130, km 72',
    descricao: 'Colisão entre carro e moto. Motociclista consciente, com escoriações nas pernas.',
    pa_sistolica: 110, pa_diastolica: 70, fc: 104, fr: 22, spo2: 96, temperatura: 36.1,
    glasgow_ocular: 4, glasgow_verbal: 4, glasgow_motora: 6, manchester: 'amarelo', start: 'amarelo',
    medicamento: 'Soro fisiológico 0,9%', dose: 500, unidade: 'mL',
  },
  {
    tipo_ocorrencia: 'clinica', local: 'Av. Benjamin Constant, 1500 - Lajeado',
    descricao: 'Falta de ar há duas horas, histórico de asma.',
    pa_sistolica: 135, pa_diastolica: 88, fc: 110, fr: 28, spo2: 91, temperatura: 36.8,
    glasgow_ocular: 4, glasgow_verbal: 5, glasgow_motora: 6, manchester: 'laranja', start: '',
    medicamento: 'Salbutamol', dose: 400, unidade: 'mcg',
  },
];

const sortear = (lista) => lista[Math.floor(Math.random() * lista.length)];
const numeroEntre = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export function pacienteExemplo() {
  const ano = numeroEntre(1950, 2005);
  return {
    nome: sortear(NOMES),
    data_nascimento: `${ano}-0${numeroEntre(1, 9)}-1${numeroEntre(0, 9)}`,
    sexo: sortear(['M', 'F']),
    telefone: `(51) 9${numeroEntre(8000, 9999)}-${numeroEntre(1000, 9999)}`,
    contato_emergencia_nome: sortear(NOMES),
    contato_emergencia_telefone: `(51) 9${numeroEntre(8000, 9999)}-${numeroEntre(1000, 9999)}`,
  };
}

export function atendimentoExemplo() {
  return { ...sortear(OCORRENCIAS) };
}

// Coloca cada valor no campo de mesmo nome e avisa o formulário da mudança
// (assim o total da Escala de Glasgow é recalculado).
export function preencherFormulario(form, dados) {
  for (const [nome, valor] of Object.entries(dados)) {
    const campo = form.elements[nome];
    if (!campo || campo instanceof RadioNodeList) continue;
    campo.value = valor;
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
