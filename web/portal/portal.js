import { chamarApi, ErroApi } from '../comum/api.js';
import { htmlFormAtendimento, ligarFormAtendimento, lerFormAtendimento } from '../comum/form-atendimento.js';
import {
  esc, data, dataHora, triagem, opcoes, lerFormulario, mostrarMensagem, baixarBlob, cabecalho, cartoes,
  TIPOS_OCORRENCIA, MANCHESTER, START, TIPOS_SANGUINEOS,
} from '../comum/util.js';

const pagina = document.getElementById('pagina');
const msg = document.getElementById('msg');
let sessao = null;

try {
  sessao = JSON.parse(sessionStorage.getItem('portal-sessao'));
} catch { /* sem sessão salva */ }

const ehAdmin = () => sessao?.profissional.perfil === 'admin';

async function api(caminho, opcoesChamada = {}) {
  try {
    return await chamarApi(caminho, { ...opcoesChamada, token: sessao?.token });
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 401) sair('Sessão expirada. Entre novamente.');
    throw erro;
  }
}

// ---------- Cadastros (listagem e formulário genéricos) ----------

const SEXOS = { M: 'Masculino', F: 'Feminino', O: 'Outro' };
const PERFIS = { admin: 'Administrador', medico: 'Médico', enfermeiro: 'Enfermeiro', socorrista: 'Socorrista' };

const CADASTROS = {
  pacientes: {
    titulo: 'Pacientes',
    api: '/pessoa',
    colunas: [['nome', 'Nome'], ['cpf', 'CPF'], ['data_nascimento', 'Nascimento', data], ['sexo', 'Sexo', (v) => SEXOS[v] ?? '-'],
      ['telefone', 'Telefone'], ['contato_emergencia_nome', 'Contato de emergência']],
    campos: [
      { nome: 'nome', rotulo: 'Nome *', obrigatorio: true },
      { nome: 'cpf', rotulo: 'CPF' },
      { nome: 'data_nascimento', rotulo: 'Data de nascimento', tipo: 'date' },
      { nome: 'sexo', rotulo: 'Sexo', opcoes: SEXOS },
      { nome: 'telefone', rotulo: 'Telefone' },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
      { nome: 'contato_emergencia_nome', rotulo: 'Contato de emergência' },
      { nome: 'contato_emergencia_telefone', rotulo: 'Telefone do contato' },
    ],
    podeEditar: () => true,
  },
  prontuarios: {
    titulo: 'Prontuários',
    api: '/prontuario',
    colunas: [['paciente_nome', 'Paciente'], ['tipo_sanguineo', 'Tipo sanguíneo'], ['alergias', 'Alergias'],
      ['comorbidades', 'Comorbidades'], ['uso_continuo', 'Uso contínuo'], ['atualizado_em', 'Atualizado em', dataHora]],
    campos: [
      { nome: 'paciente_id', rotulo: 'Paciente *', obrigatorio: true, opcoes: async () => mapaPacientes() },
      { nome: 'tipo_sanguineo', rotulo: 'Tipo sanguíneo', opcoes: Object.fromEntries(TIPOS_SANGUINEOS.map((t) => [t, t])) },
      { nome: 'alergias', rotulo: 'Alergias' },
      { nome: 'comorbidades', rotulo: 'Comorbidades' },
      { nome: 'uso_continuo', rotulo: 'Medicamentos de uso contínuo' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' },
    ],
    podeEditar: () => true,
  },
  medicamentos: {
    titulo: 'Medicamentos',
    api: '/medicamento',
    colunas: [['nome', 'Nome'], ['principio_ativo', 'Princípio ativo'], ['apresentacao', 'Apresentação'],
      ['concentracao', 'Concentração'], ['via_padrao', 'Via'], ['alerta', 'Alerta'], ['criado_em', 'Cadastrado em', dataHora]],
    campos: [
      { nome: 'nome', rotulo: 'Nome *', obrigatorio: true },
      { nome: 'principio_ativo', rotulo: 'Princípio ativo' },
      { nome: 'apresentacao', rotulo: 'Apresentação' },
      { nome: 'concentracao', rotulo: 'Concentração' },
      { nome: 'via_padrao', rotulo: 'Via padrão' },
      { nome: 'alerta', rotulo: 'Alerta de segurança' },
    ],
    podeEditar: ehAdmin,
  },
  profissionais: {
    titulo: 'Profissionais',
    api: '/profissional',
    semVersao: true,
    colunas: [['nome', 'Nome'], ['tipo_registro', 'Registro', (v, r) => `${v} ${r.numero_registro}`], ['perfil', 'Perfil', (v) => PERFIS[v]],
      ['email', 'E-mail'], ['ativo', 'Situação', (v) => (v ? 'Ativo' : 'Inativo')]],
    campos: [
      { nome: 'nome', rotulo: 'Nome *', obrigatorio: true },
      { nome: 'tipo_registro', rotulo: 'Tipo de registro *', obrigatorio: true, opcoes: { CRM: 'CRM', COREN: 'COREN', SOCORRISTA: 'ID de socorrista' } },
      { nome: 'numero_registro', rotulo: 'Número do registro *', obrigatorio: true },
      { nome: 'perfil', rotulo: 'Perfil *', obrigatorio: true, opcoes: PERFIS },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
      { nome: 'senha', rotulo: 'Senha (deixe vazio para manter)', tipo: 'password' },
    ],
    podeEditar: ehAdmin,
  },
};

async function mapaPacientes() {
  const pacientes = await api('/pessoa');
  return Object.fromEntries(pacientes.map((p) => [p.id, p.nome]));
}

async function htmlCampo(campo, valor) {
  const atributos = `name="${campo.nome}" ${campo.obrigatorio ? 'required' : ''}`;
  let entrada;
  if (campo.opcoes) {
    const mapa = typeof campo.opcoes === 'function' ? await campo.opcoes() : campo.opcoes;
    entrada = `<select ${atributos}>${opcoes(mapa, valor)}</select>`;
  } else if (campo.tipo === 'textarea') {
    entrada = `<textarea ${atributos}>${esc(valor)}</textarea>`;
  } else {
    const v = campo.tipo === 'password' ? '' : campo.tipo === 'date' ? (valor ?? '').slice(0, 10) : valor;
    entrada = `<input type="${campo.tipo ?? 'text'}" ${atributos} value="${esc(v)}">`;
  }
  return `<div class="${campo.tipo === 'textarea' ? 'largo' : ''}"><label>${esc(campo.rotulo)}</label>${entrada}</div>`;
}

async function mostrarCadastro(chave) {
  const cfg = CADASTROS[chave];
  const busca = new URLSearchParams(location.hash.split('?')[1]).get('busca') ?? '';
  const registros = await api(cfg.api + (busca ? `?busca=${encodeURIComponent(busca)}` : ''));

  pagina.innerHTML = `
    <h2>${cfg.titulo}</h2>
    <div class="barra-acoes">
      ${cfg.semVersao ? '' : `<form id="form-busca"><input name="busca" placeholder="Buscar..." value="${esc(busca)}"></form>`}
      <button class="secundario" id="atualizar">Atualizar</button>
      <span class="espaco"></span>
      ${cfg.podeEditar() ? '<button id="novo">Novo</button>' : ''}
    </div>
    <div id="area-form"></div>
    <div class="tabela-container">
      <table>
        <thead><tr>${cfg.colunas.map(([, t]) => `<th>${t}</th>`).join('')}<th></th></tr></thead>
        <tbody>${registros.map((r) => `
          <tr>
            ${cfg.colunas.map(([c, , f]) => `<td>${esc(f ? f(r[c], r) : (r[c] ?? '-'))}</td>`).join('')}
            <td class="acoes">
              ${cfg.podeEditar() ? `<button class="secundario pequeno" data-editar="${r.id}">Editar</button>` : ''}
              ${ehAdmin() && (r.ativo !== false) ? `<button class="perigo pequeno" data-excluir="${r.id}">${cfg.semVersao ? 'Desativar' : 'Excluir'}</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${registros.length ? '' : '<p class="vazio">Nenhum registro encontrado.</p>'}
    </div>
    <p class="vazio">${registros.length} registro(s).</p>`;

  document.getElementById('atualizar').onclick = () => mostrarCadastro(chave);
  document.getElementById('form-busca')?.addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `${chave}?busca=${encodeURIComponent(e.target.busca.value)}`;
  });
  document.getElementById('novo')?.addEventListener('click', () => abrirFormulario(cfg, chave));
  pagina.querySelectorAll('[data-editar]').forEach((b) => {
    b.onclick = () => abrirFormulario(cfg, chave, registros.find((r) => r.id === b.dataset.editar));
  });
  pagina.querySelectorAll('[data-excluir]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Confirma a exclusão? O registro fica guardado no banco para auditoria.')) return;
      await executar(() => api(`${cfg.api}/${b.dataset.excluir}`, { metodo: 'DELETE' }), 'Registro excluído.');
      mostrarCadastro(chave);
    };
  });
}

async function abrirFormulario(cfg, chave, registro = null) {
  const area = document.getElementById('area-form');
  const campos = await Promise.all(cfg.campos.map((c) => htmlCampo(c, registro?.[c.nome])));
  area.innerHTML = `
    <form class="painel" id="form-cadastro">
      <h3>${registro ? 'Editar' : 'Novo'} registro</h3>
      <div class="grade">${campos.join('')}</div>
      <button type="submit">Salvar</button>
      <button type="button" class="secundario" id="cancelar">Cancelar</button>
    </form>`;
  area.scrollIntoView({ behavior: 'smooth' });
  document.getElementById('cancelar').onclick = () => { area.innerHTML = ''; };
  document.getElementById('form-cadastro').onsubmit = async (e) => {
    e.preventDefault();
    const dados = lerFormulario(e.target);
    if (cfg.semVersao && registro) dados.ativo = registro.ativo;
    if (!cfg.semVersao && registro) dados.versao_base = registro.versao;
    const ok = await executar(() => api(registro ? `${cfg.api}/${registro.id}` : cfg.api, {
      metodo: registro ? 'PUT' : 'POST',
      corpo: dados,
    }), 'Registro salvo.');
    if (ok) mostrarCadastro(chave);
  };
}

// ---------- Atendimentos ----------

async function mostrarAtendimentos() {
  const atendimentos = await api('/atendimento');
  pagina.innerHTML = `
    <h2>Atendimentos</h2>
    <div class="barra-acoes">
      <button class="secundario" id="atualizar">Atualizar</button>
    </div>
    <div id="area-detalhe"></div>
    <div class="tabela-container">
      <table>
        <thead><tr><th>Data e hora</th><th>Paciente</th><th>Ocorrência</th><th>Manchester</th><th>START</th>
          <th>Glasgow</th><th>Profissional</th><th>Registrado em</th><th></th></tr></thead>
        <tbody>${atendimentos.map((a) => `
          <tr>
            <td>${dataHora(a.data_hora)}</td>
            <td>${esc(a.paciente_nome)}</td>
            <td>${esc(TIPOS_OCORRENCIA[a.tipo_ocorrencia])}</td>
            <td>${triagem(a.manchester, MANCHESTER)}</td>
            <td>${triagem(a.start, START)}</td>
            <td>${a.glasgow_total ?? '-'}</td>
            <td>${esc(a.profissional_nome)}</td>
            <td>${dataHora(a.criado_em)}</td>
            <td class="acoes">
              <button class="secundario pequeno" data-ver="${a.id}">Ver</button>
              <button class="secundario pequeno" data-editar="${a.id}">Editar</button>
              <button class="secundario pequeno" data-pdf="${a.id}">PDF</button>
              ${ehAdmin() ? `<button class="perigo pequeno" data-excluir="${a.id}">Excluir</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${atendimentos.length ? '' : '<p class="vazio">Nenhum atendimento registrado.</p>'}
    </div>
    <p class="vazio">${atendimentos.length} atendimento(s).</p>`;

  document.getElementById('atualizar').onclick = mostrarAtendimentos;
  pagina.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => verAtendimento(b.dataset.ver); });
  pagina.querySelectorAll('[data-editar]').forEach((b) => { b.onclick = () => editarAtendimento(b.dataset.editar); });
  pagina.querySelectorAll('[data-pdf]').forEach((b) => { b.onclick = () => baixarPdf(b.dataset.pdf); });
  pagina.querySelectorAll('[data-excluir]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Confirma a exclusão lógica deste atendimento?')) return;
      await executar(() => api(`/atendimento/${b.dataset.excluir}`, { metodo: 'DELETE' }), 'Atendimento excluído.');
      mostrarAtendimentos();
    };
  });
}

function htmlDetalheAtendimento(a) {
  const item = (rotulo, valor) => `<div><dt>${rotulo}</dt><dd>${valor ?? '-'}</dd></div>`;
  return `
    <dl class="detalhe">
      ${item('Paciente', esc(a.paciente_nome))}
      ${item('Data e hora', dataHora(a.data_hora))}
      ${item('Ocorrência', esc(TIPOS_OCORRENCIA[a.tipo_ocorrencia]))}
      ${item('Local', esc(a.local))}
      ${item('Profissional', `${esc(a.profissional_nome)} (${esc(a.profissional_registro)})`)}
      ${item('Pressão arterial', a.pa_sistolica != null ? `${a.pa_sistolica}/${a.pa_diastolica} mmHg` : null)}
      ${item('FC / FR', `${a.fc ?? '-'} bpm / ${a.fr ?? '-'} irpm`)}
      ${item('SpO2', a.spo2 != null ? `${a.spo2}%` : null)}
      ${item('Temperatura', a.temperatura != null ? `${a.temperatura} °C` : null)}
      ${item('Glicemia', a.glicemia != null ? `${a.glicemia} mg/dL` : null)}
      ${item('Glasgow', a.glasgow_total != null ? `${a.glasgow_total} (O${a.glasgow_ocular} V${a.glasgow_verbal} M${a.glasgow_motora})` : null)}
      ${item('Manchester', triagem(a.manchester, MANCHESTER))}
      ${item('START', triagem(a.start, START))}
      ${item('Versão', a.versao)}
    </dl>
    <p><strong>Descrição:</strong> ${esc(a.descricao)}</p>
    <h3>Medicamentos administrados</h3>
    ${a.medicamentos.length ? `<table><thead><tr><th>Medicamento</th><th>Dose</th><th>Via</th><th>Horário</th></tr></thead><tbody>
      ${a.medicamentos.map((m) => `<tr><td>${esc(m.medicamento_nome)}</td><td>${Number(m.dose)} ${esc(m.unidade)}</td><td>${esc(m.via ?? '-')}</td><td>${dataHora(m.horario)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="vazio">Nenhum medicamento registrado.</p>'}`;
}

async function verAtendimento(id) {
  const a = await api(`/atendimento/detalhe/${id}`);
  const area = document.getElementById('area-detalhe');
  area.innerHTML = `
    <div class="painel">
      <h3>Atendimento de ${esc(a.paciente_nome)}</h3>
      ${htmlDetalheAtendimento(a)}
      <h3>Ficha de atendimento</h3>
      <form id="form-email" class="barra-acoes">
        <button type="button" id="pdf">Baixar PDF</button>
        <input type="email" name="destinatario" required placeholder="E-mail do paciente ou familiar" style="max-width:320px">
        <button type="submit" class="secundario">Enviar por e-mail</button>
        <button type="button" class="secundario" id="fechar">Fechar</button>
      </form>
    </div>`;
  area.scrollIntoView({ behavior: 'smooth' });
  document.getElementById('pdf').onclick = () => baixarPdf(id);
  document.getElementById('fechar').onclick = () => { area.innerHTML = ''; };
  document.getElementById('form-email').onsubmit = (e) => {
    e.preventDefault();
    const destinatario = e.target.destinatario.value;
    executar(() => api(`/atendimento/${id}/email`, { metodo: 'POST', corpo: { destinatario } }),
      `Ficha enviada por e-mail para ${destinatario}.`);
  };
}

async function editarAtendimento(id) {
  const [a, pacientes, medicamentos] = await Promise.all([
    api(`/atendimento/detalhe/${id}`), api('/pessoa'), api('/medicamento'),
  ]);
  const area = document.getElementById('area-detalhe');
  area.innerHTML = `
    <form class="painel" id="form-atendimento">
      <h3>Editar atendimento</h3>
      ${htmlFormAtendimento({ pacientes, atendimento: a })}
      <button type="submit">Salvar</button>
      <button type="button" class="secundario" id="cancelar">Cancelar</button>
    </form>`;
  area.scrollIntoView({ behavior: 'smooth' });
  const form = document.getElementById('form-atendimento');
  ligarFormAtendimento(form, {
    medicamentos,
    atendimento: a,
    alergiasDoPaciente: async (pacienteId) => (await api(`/prontuario/${pacienteId}`).catch(() => null))?.alergias,
  });
  document.getElementById('cancelar').onclick = () => { area.innerHTML = ''; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const dados = { ...lerFormAtendimento(form), versao_base: a.versao, profissional_id: a.profissional_id };
    if (await executar(() => api(`/atendimento/${id}`, { metodo: 'PUT', corpo: dados }), 'Atendimento atualizado.')) {
      mostrarAtendimentos();
    }
  };
}

async function baixarPdf(id) {
  await executar(async () => {
    const { blob, nome } = await api(`/atendimento/${id}/pdf`, { comoArquivo: true });
    baixarBlob(blob, nome);
  }, 'PDF gerado.');
}

// ---------- Sincronizações e auditoria ----------

async function mostrarSincronizacoes() {
  const operacoes = await api('/sync/operacoes?limite=200');
  const classe = { aplicada: 'ok', conflito: 'pendente', erro: 'falha' };
  pagina.innerHTML = `
    <h2>Sincronizações recebidas</h2>
    <p>Rastro de cada operação enviada pelos dispositivos ao serviço de sincronização.</p>
    <div class="barra-acoes"><button class="secundario" id="atualizar">Atualizar</button></div>
    <div class="tabela-container"><table>
      <thead><tr><th>Recebida em</th><th>Dispositivo</th><th>Profissional</th><th>Entidade</th><th>Ação</th>
        <th>Versão base</th><th>Situação</th><th>Mensagem</th></tr></thead>
      <tbody>${operacoes.map((o) => `
        <tr>
          <td>${dataHora(o.recebido_em)}</td><td>${esc(o.dispositivo_id.slice(0, 8))}</td><td>${esc(o.profissional_nome ?? '-')}</td>
          <td>${esc(o.entidade)}</td><td>${esc(o.acao)}</td><td>${o.versao_base}</td>
          <td><span class="etiqueta ${classe[o.status]}">${esc(o.status)}</span></td><td>${esc(o.mensagem ?? '')}</td>
        </tr>`).join('')}
      </tbody></table>
      ${operacoes.length ? '' : '<p class="vazio">Nenhuma sincronização recebida.</p>'}
    </div>`;
  document.getElementById('atualizar').onclick = mostrarSincronizacoes;
}

async function mostrarAuditoria() {
  const servico = new URLSearchParams(location.hash.split('?')[1]).get('servico') ?? '';
  const logs = await api(`/auditoria?limite=300${servico ? `&servico=${servico}` : ''}`);
  const servicos = { cadastros: 'Cadastros (Node)', atendimentos: 'Atendimentos (Python)', sync: 'Sincronização (Go)', 'app-socorrista': 'App do socorrista (offline)' };
  pagina.innerHTML = `
    <h2>Auditoria de acessos</h2>
    <div class="barra-acoes">
      <select id="filtro" style="max-width:280px">${opcoes(servicos, servico, 'Todos os serviços')}</select>
      <button class="secundario" id="atualizar">Atualizar</button>
    </div>
    <div class="tabela-container"><table>
      <thead><tr><th>Data e hora</th><th>Serviço</th><th>IP</th><th>Profissional</th><th>Método</th><th>Rota</th><th>Status</th><th>Tempo (ms)</th></tr></thead>
      <tbody>${logs.map((l) => `
        <tr>
          <td>${new Date(l.data_hora).toLocaleString('pt-BR')}</td><td>${esc(l.servico)}</td><td>${esc(l.ip)}</td>
          <td>${esc(l.profissional_nome ?? '-')}</td><td>${esc(l.metodo)}</td><td>${esc(l.rota)}</td>
          <td>${l.status ?? '-'}</td><td>${l.duracao_ms ?? '-'}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  document.getElementById('filtro').onchange = (e) => { location.hash = `auditoria?servico=${e.target.value}`; };
  document.getElementById('atualizar').onclick = mostrarAuditoria;
}

// ---------- Início ----------

async function mostrarInicio() {
  const [pessoas, prontuarios, atendimentos, medicamentos, operacoes] = await Promise.all([
    api('/pessoa'), api('/prontuario'), api('/atendimento'), api('/medicamento'), api('/sync/operacoes?limite=500'),
  ]);
  const hoje = new Date().toDateString();
  const deHoje = atendimentos.filter((a) => new Date(a.data_hora).toDateString() === hoje).length;
  const conflitos = operacoes.filter((o) => o.status === 'conflito').length;

  pagina.innerHTML = `
    ${cabecalho('Início', 'Resumo dos dados consolidados no servidor central.', '<button class="secundario" id="atualizar">Atualizar</button>')}
    ${cartoes([
      ['Pacientes', pessoas.length],
      ['Prontuários', prontuarios.length],
      ['Atendimentos', atendimentos.length, `${deHoje} hoje`],
      ['Medicamentos', medicamentos.length],
      ['Operações sincronizadas', operacoes.length, `${conflitos} com conflito`],
    ])}
    <div class="painel">
      <h3 style="margin-top:0">Últimos atendimentos</h3>
      ${atendimentos.length ? `<div class="tabela-container"><table>
        <thead><tr><th>Data e hora</th><th>Paciente</th><th>Ocorrência</th><th>Manchester</th><th>Profissional</th></tr></thead>
        <tbody>${atendimentos.slice(0, 5).map((a) => `
          <tr><td>${dataHora(a.data_hora)}</td><td>${esc(a.paciente_nome)}</td><td>${esc(TIPOS_OCORRENCIA[a.tipo_ocorrencia])}</td>
            <td>${triagem(a.manchester, MANCHESTER)}</td><td>${esc(a.profissional_nome)}</td></tr>`).join('')}
        </tbody></table></div>
        <p><a href="#atendimentos">Ver todos os atendimentos</a></p>` : '<p class="vazio">Nenhum atendimento registrado.</p>'}
    </div>
    <div class="painel">
      <h3 style="margin-top:0">Acessos rápidos</h3>
      <div class="barra-acoes">
        <a class="botao secundario" href="/socorrista/" target="_blank">Abrir app do socorrista</a>
        <a class="botao secundario" href="/docs/" target="_blank">Documentação da API</a>
      </div>
    </div>`;
  document.getElementById('atualizar').onclick = mostrarInicio;
}

// ---------- Navegação e sessão ----------

const PAGINAS = {
  inicio: mostrarInicio,
  pacientes: () => mostrarCadastro('pacientes'),
  prontuarios: () => mostrarCadastro('prontuarios'),
  medicamentos: () => mostrarCadastro('medicamentos'),
  profissionais: () => mostrarCadastro('profissionais'),
  atendimentos: mostrarAtendimentos,
  sincronizacoes: mostrarSincronizacoes,
  auditoria: mostrarAuditoria,
};

async function executar(acao, sucesso) {
  try {
    await acao();
    if (sucesso) mostrarMensagem(msg, sucesso, 'sucesso');
    return true;
  } catch (erro) {
    mostrarMensagem(msg, erro.message);
    return false;
  }
}

async function navegar() {
  if (!sessao) return;
  const nome = location.hash.slice(1).split('?')[0] || 'inicio';
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === `#${nome}`));
  mostrarMensagem(msg, '');
  pagina.innerHTML = '<p class="vazio">Carregando...</p>';
  await executar(PAGINAS[nome] ?? PAGINAS.inicio);
}

function mostrarTelas() {
  document.getElementById('tela-login').classList.toggle('oculto', !!sessao);
  document.getElementById('tela-portal').classList.toggle('oculto', !sessao);
  if (!sessao) return;
  const p = sessao.profissional;
  document.getElementById('usuario').textContent = `${p.nome} · ${p.tipo_registro} ${p.numero_registro} · ${PERFIS[p.perfil]}`;
  document.querySelectorAll('[data-admin]').forEach((a) => a.classList.toggle('oculto', !ehAdmin()));
  navegar();
}

function sair(mensagem) {
  sessao = null;
  sessionStorage.removeItem('portal-sessao');
  mostrarTelas();
  if (mensagem) mostrarMensagem(document.getElementById('msg-login'), mensagem, 'aviso');
}

document.getElementById('form-login').onsubmit = async (e) => {
  e.preventDefault();
  try {
    sessao = await chamarApi('/auth/login', { metodo: 'POST', corpo: lerFormulario(e.target) });
    sessionStorage.setItem('portal-sessao', JSON.stringify(sessao));
    e.target.reset();
    mostrarTelas();
  } catch (erro) {
    mostrarMensagem(document.getElementById('msg-login'), erro.message);
  }
};
document.getElementById('sair').onclick = () => sair();
window.addEventListener('hashchange', navegar);
mostrarTelas();
