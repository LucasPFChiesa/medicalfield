export const TIPOS_OCORRENCIA = {
  clinica: 'Clínica',
  trauma: 'Trauma',
  acidente_transito: 'Acidente de trânsito',
  queda: 'Queda',
  obstetrica: 'Obstétrica',
  psiquiatrica: 'Psiquiátrica',
  outra: 'Outra',
};

export const MANCHESTER = {
  vermelho: 'Vermelho – emergência',
  laranja: 'Laranja – muito urgente',
  amarelo: 'Amarelo – urgente',
  verde: 'Verde – pouco urgente',
  azul: 'Azul – não urgente',
};

export const START = {
  vermelho: 'Vermelho – imediato',
  amarelo: 'Amarelo – pode aguardar',
  verde: 'Verde – deambula',
  preto: 'Preto – sem respiração',
};

export const GLASGOW = {
  ocular: { 4: 'Espontânea', 3: 'Ao som', 2: 'À pressão', 1: 'Ausente' },
  verbal: { 5: 'Orientada', 4: 'Confusa', 3: 'Palavras', 2: 'Sons', 1: 'Ausente' },
  motora: { 6: 'Obedece comandos', 5: 'Localiza', 4: 'Flexão normal', 3: 'Flexão anormal', 2: 'Extensão', 1: 'Ausente' },
};

export const TIPOS_SANGUINEOS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Todo texto vindo de dados passa por aqui antes de entrar no HTML.
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function dataHora(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function data(texto) {
  if (!texto) return '-';
  const [ano, mes, dia] = texto.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// Converte ISO para o formato do <input type="datetime-local"> (hora local).
export function paraCampoDataHora(iso) {
  const d = iso ? new Date(iso) : new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function triagem(cor, rotulos) {
  if (!cor) return '-';
  return `<span class="triagem triagem-${esc(cor)}">${esc(rotulos[cor]?.split(' –')[0] ?? cor)}</span>`;
}

export function opcoes(mapa, selecionado, vazio = 'Selecione...') {
  const lista = Object.entries(mapa).map(([valor, rotulo]) =>
    `<option value="${esc(valor)}" ${String(valor) === String(selecionado ?? '') ? 'selected' : ''}>${esc(rotulo)}</option>`);
  return (vazio === null ? '' : `<option value="">${esc(vazio)}</option>`) + lista.join('');
}

// Lê um formulário: campos vazios viram null e campos numéricos viram número.
export function lerFormulario(form) {
  const dados = {};
  for (const campo of form.elements) {
    if (!campo.name || campo.disabled || campo.closest('[data-ignorar]')) continue;
    const valor = campo.value.trim();
    if (valor === '') dados[campo.name] = null;
    else if (campo.type === 'number') dados[campo.name] = Number(valor);
    else if (campo.type === 'datetime-local') dados[campo.name] = new Date(valor).toISOString();
    else dados[campo.name] = valor;
  }
  return dados;
}

export function mostrarMensagem(elemento, texto, tipo = 'erro') {
  elemento.className = `mensagem ${tipo}`;
  elemento.textContent = texto ?? '';
}

export function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
