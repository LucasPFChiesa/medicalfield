// Formulário de atendimento usado pelo app do socorrista (registro) e pelo
// portal (edição). Só monta e lê os campos; quem chama decide onde gravar.
import { esc, opcoes, lerFormulario, paraCampoDataHora, TIPOS_OCORRENCIA, MANCHESTER, START, GLASGOW } from './util.js';

function opcoesGlasgow(componente, selecionado) {
  const valores = Object.keys(GLASGOW[componente]).map(Number).sort((a, b) => b - a);
  return '<option value="">-</option>' + valores.map((v) =>
    `<option value="${v}" ${v === selecionado ? 'selected' : ''}>${v} – ${esc(GLASGOW[componente][v])}</option>`).join('');
}

function campoNumero(nome, rotulo, a, min, max, passo = 1) {
  return `<div><label>${rotulo}</label><input type="number" name="${nome}" min="${min}" max="${max}" step="${passo}" value="${esc(a[nome])}"></div>`;
}

export function htmlFormAtendimento({ pacientes, atendimento = {} }) {
  const a = atendimento;
  const listaPacientes = Object.fromEntries(pacientes.map((p) => [p.id, p.nome]));
  return `
    <fieldset>
      <legend>Ocorrência</legend>
      <div class="grade">
        <div><label>Paciente *</label><select name="paciente_id" required>${opcoes(listaPacientes, a.paciente_id)}</select></div>
        <div><label>Data e hora *</label><input type="datetime-local" name="data_hora" required value="${paraCampoDataHora(a.data_hora)}"></div>
        <div><label>Tipo de ocorrência *</label><select name="tipo_ocorrencia" required>${opcoes(TIPOS_OCORRENCIA, a.tipo_ocorrencia)}</select></div>
        <div class="largo"><label>Local</label><input name="local" value="${esc(a.local)}"></div>
        <div class="largo"><label>Descrição do atendimento *</label><textarea name="descricao" required minlength="3">${esc(a.descricao)}</textarea></div>
      </div>
    </fieldset>
    <fieldset>
      <legend>Sinais vitais</legend>
      <div class="grade">
        ${campoNumero('pa_sistolica', 'PA sistólica (mmHg)', a, 0, 300)}
        ${campoNumero('pa_diastolica', 'PA diastólica (mmHg)', a, 0, 250)}
        ${campoNumero('fc', 'Freq. cardíaca (bpm)', a, 0, 300)}
        ${campoNumero('fr', 'Freq. respiratória (irpm)', a, 0, 100)}
        ${campoNumero('spo2', 'SpO2 (%)', a, 0, 100)}
        ${campoNumero('temperatura', 'Temperatura (°C)', a, 25, 45, 0.1)}
        ${campoNumero('glicemia', 'Glicemia (mg/dL)', a, 0, 1000)}
      </div>
    </fieldset>
    <fieldset>
      <legend>Nível de consciência – Escala de Glasgow</legend>
      <div class="grade">
        <div><label>Abertura ocular</label><select name="glasgow_ocular">${opcoesGlasgow('ocular', a.glasgow_ocular)}</select></div>
        <div><label>Resposta verbal</label><select name="glasgow_verbal">${opcoesGlasgow('verbal', a.glasgow_verbal)}</select></div>
        <div><label>Resposta motora</label><select name="glasgow_motora">${opcoesGlasgow('motora', a.glasgow_motora)}</select></div>
        <div><label>Total</label><strong data-glasgow-total>-</strong></div>
      </div>
    </fieldset>
    <fieldset>
      <legend>Triagem</legend>
      <div class="grade">
        <div><label>Protocolo de Manchester</label><select name="manchester">${opcoes(MANCHESTER, a.manchester, 'Não classificado')}</select></div>
        <div><label>Protocolo START</label><select name="start">${opcoes(START, a.start, 'Não aplicado')}</select></div>
      </div>
    </fieldset>
    <fieldset data-ignorar>
      <legend>Medicamentos administrados</legend>
      <div data-lista-medicamentos></div>
      <button type="button" class="secundario pequeno" data-adicionar-medicamento>+ Adicionar medicamento</button>
    </fieldset>`;
}

// medicamentos: catálogo; alergiasDoPaciente(id) devolve o texto de alergias do prontuário.
export function ligarFormAtendimento(form, { medicamentos, alergiasDoPaciente, atendimento = {} }) {
  const lista = form.querySelector('[data-lista-medicamentos]');
  const catalogo = Object.fromEntries(medicamentos.map((m) => [m.id, m]));

  function atualizarGlasgow() {
    const partes = ['ocular', 'verbal', 'motora'].map((c) => Number(form.elements[`glasgow_${c}`].value));
    form.querySelector('[data-glasgow-total]').textContent = partes.every((p) => p > 0)
      ? partes.reduce((s, p) => s + p, 0) : '-';
  }

  // Aviso informativo: não bloqueia o registro, a decisão é do profissional.
  async function conferirLinha(linha) {
    const medicamento = catalogo[linha.querySelector('[name=medicamento_id]').value];
    const avisos = [];
    if (medicamento?.alerta) avisos.push(medicamento.alerta);
    const alergias = (await alergiasDoPaciente(form.elements.paciente_id.value)) ?? '';
    const termos = alergias.toLowerCase().split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    const nomes = `${medicamento?.nome ?? ''} ${medicamento?.principio_ativo ?? ''}`.toLowerCase();
    const alergia = medicamento && termos.find((t) => nomes.includes(t));
    if (alergia) avisos.push(`ATENÇÃO: o prontuário registra alergia a "${alergia}"`);
    linha.querySelector('.alerta-medicamento').textContent = avisos.join(' · ');
  }

  function adicionarLinha(m = {}) {
    const linha = document.createElement('div');
    linha.className = 'linha-medicamento-bloco';
    linha.dataset.id = m.id ?? '';
    const ativos = medicamentos.filter((x) => !x.excluido_em || x.id === m.medicamento_id);
    linha.innerHTML = `
      <div class="linha-medicamento">
        <div><label>Medicamento</label><select name="medicamento_id" required>${opcoes(Object.fromEntries(ativos.map((x) => [x.id, x.nome])), m.medicamento_id)}</select></div>
        <div><label>Dose</label><input type="number" name="dose" min="0" step="any" required value="${esc(m.dose)}"></div>
        <div><label>Unidade</label><input name="unidade" required value="${esc(m.unidade ?? 'mg')}"></div>
        <div><label>Via</label><input name="via" value="${esc(m.via)}"></div>
        <div><label>Horário</label><input type="datetime-local" name="horario" required value="${paraCampoDataHora(m.horario)}"></div>
        <div><button type="button" class="perigo pequeno" title="Remover">✕</button></div>
      </div>
      <div class="alerta-medicamento"></div>`;
    const seletor = linha.querySelector('[name=medicamento_id]');
    seletor.addEventListener('change', () => {
      const via = linha.querySelector('[name=via]');
      if (!via.value) via.value = catalogo[seletor.value]?.via_padrao ?? '';
      conferirLinha(linha);
    });
    linha.querySelector('button').addEventListener('click', () => linha.remove());
    lista.append(linha);
    if (m.medicamento_id) conferirLinha(linha);
  }

  form.querySelector('[data-adicionar-medicamento]').addEventListener('click', () => adicionarLinha());
  form.addEventListener('change', (e) => {
    if (e.target.name?.startsWith('glasgow_')) atualizarGlasgow();
    if (e.target.name === 'paciente_id') lista.querySelectorAll('.linha-medicamento-bloco').forEach(conferirLinha);
  });
  (atendimento.medicamentos ?? []).forEach(adicionarLinha);
  atualizarGlasgow();
}

export function lerFormAtendimento(form) {
  const dados = lerFormulario(form);
  for (const campo of ['glasgow_ocular', 'glasgow_verbal', 'glasgow_motora']) {
    if (dados[campo] !== null) dados[campo] = Number(dados[campo]);
  }
  dados.medicamentos = [...form.querySelectorAll('.linha-medicamento-bloco')].map((linha) => ({
    id: linha.dataset.id || crypto.randomUUID(),
    medicamento_id: linha.querySelector('[name=medicamento_id]').value,
    dose: Number(linha.querySelector('[name=dose]').value),
    unidade: linha.querySelector('[name=unidade]').value.trim(),
    via: linha.querySelector('[name=via]').value.trim() || null,
    horario: new Date(linha.querySelector('[name=horario]').value).toISOString(),
  }));
  return dados;
}
