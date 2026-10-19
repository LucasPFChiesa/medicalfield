import { pacientes, prontuarios, atendimentos, medicamentos, profissionais, servidor } from './repositorios.js';
import { estaOnline, simuladorEstaOnline, definirSimulador, assinar } from './conectividade.js';
import { sincronizar, contarPendentes, historico, descartar } from './outbox.js';
import { entrar, sair, sessaoAtual, tokenValido } from './sessao.js';
import * as db from './db-local.js';
import { htmlFormAtendimento, ligarFormAtendimento, lerFormAtendimento } from '../comum/form-atendimento.js';
import {
  esc, data, dataHora, triagem, opcoes, lerFormulario, mostrarMensagem, baixarBlob,
  TIPOS_OCORRENCIA, MANCHESTER, START, TIPOS_SANGUINEOS,
} from '../comum/util.js';

const pagina = document.getElementById('pagina');
const msg = document.getElementById('msg');
let sessao = null;
let manterMensagem = false;

// Troca de página sem apagar a mensagem da operação que acabou de ser feita.
function irPara(hash) {
  if (location.hash === `#${hash}`) return navegar(false);
  manterMensagem = true;
  location.hash = hash;
}

const SEXOS = { M: 'Masculino', F: 'Feminino', O: 'Outro' };

async function idsPendentes() {
  return new Set((await db.listar('outbox')).map((op) => op.entidade_id));
}

function situacao(id, pendentes) {
  return pendentes.has(id)
    ? '<span class="etiqueta pendente">pendente</span>'
    : '<span class="etiqueta ok">sincronizado</span>';
}

// ---------- Pacientes ----------

async function paginaPacientes() {
  const busca = (new URLSearchParams(location.hash.split('?')[1]).get('busca') ?? '').toLowerCase();
  const pendentes = await idsPendentes();
  const lista = (await pacientes.listar())
    .filter((p) => !busca || p.nome.toLowerCase().includes(busca) || (p.cpf ?? '').includes(busca))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  pagina.innerHTML = `
    <h2>Pacientes</h2>
    <div class="barra-acoes">
      <form id="form-busca"><input name="busca" placeholder="Buscar por nome ou CPF" value="${esc(busca)}"></form>
      <span class="espaco"></span>
      <button id="novo">Novo paciente</button>
    </div>
    <div id="area-form"></div>
    <div class="tabela-container"><table>
      <thead><tr><th>Nome</th><th>CPF</th><th>Nascimento</th><th>Sexo</th><th>Situação</th><th></th></tr></thead>
      <tbody>${lista.map((p) => `
        <tr>
          <td>${esc(p.nome)}</td><td>${esc(p.cpf ?? '-')}</td><td>${data(p.data_nascimento)}</td>
          <td>${esc(SEXOS[p.sexo] ?? '-')}</td><td>${situacao(p.id, pendentes)}</td>
          <td class="acoes"><a class="botao pequeno" href="#paciente/${p.id}">Abrir</a></td>
        </tr>`).join('')}
      </tbody></table>
      ${lista.length ? '' : '<p class="vazio">Nenhum paciente no dispositivo. Sincronize para baixar os dados do servidor.</p>'}
    </div>`;

  document.getElementById('form-busca').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `pacientes?busca=${encodeURIComponent(e.target.busca.value)}`;
  };
  document.getElementById('novo').onclick = () => formPaciente(document.getElementById('area-form'));
}

function formPaciente(area, paciente = {}) {
  area.innerHTML = `
    <form class="painel" id="form-paciente">
      <h3>${paciente.id ? 'Editar dados do paciente' : 'Novo paciente'}</h3>
      <div class="grade">
        <div><label>Nome *</label><input name="nome" required value="${esc(paciente.nome)}"></div>
        <div><label>CPF (somente números)</label><input name="cpf" pattern="\\d{11}" title="11 dígitos" value="${esc(paciente.cpf)}"></div>
        <div><label>Data de nascimento</label><input type="date" name="data_nascimento" value="${esc(paciente.data_nascimento?.slice(0, 10))}"></div>
        <div><label>Sexo</label><select name="sexo">${opcoes(SEXOS, paciente.sexo)}</select></div>
        <div><label>Telefone</label><input name="telefone" value="${esc(paciente.telefone)}"></div>
        <div><label>E-mail</label><input type="email" name="email" value="${esc(paciente.email)}"></div>
        <div><label>Contato de emergência</label><input name="contato_emergencia_nome" value="${esc(paciente.contato_emergencia_nome)}"></div>
        <div><label>Telefone do contato</label><input name="contato_emergencia_telefone" value="${esc(paciente.contato_emergencia_telefone)}"></div>
      </div>
      <button type="submit">Salvar</button>
      <button type="button" class="secundario" data-cancelar>Cancelar</button>
    </form>`;
  area.querySelector('[data-cancelar]').onclick = () => { area.innerHTML = ''; };
  area.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const salvo = await pacientes.salvar({ ...lerFormulario(e.target), id: paciente.id });
    area.innerHTML = '';
    await irPara(`paciente/${salvo.id}`);
    await depoisDeGravar(`Paciente ${salvo.nome} salvo.`);
  };
}

async function paginaPaciente(id) {
  const paciente = await pacientes.buscar(id);
  if (!paciente || paciente.excluido_em) {
    pagina.innerHTML = '<p class="vazio">Paciente não encontrado neste dispositivo.</p>';
    return;
  }
  const [prontuario] = await prontuarios.listarDoPaciente(id);
  const lista = (await atendimentos.listarDoPaciente(id)).sort((a, b) => b.data_hora.localeCompare(a.data_hora));
  const pendentes = await idsPendentes();
  const p = prontuario ?? {};

  pagina.innerHTML = `
    <h2>${esc(paciente.nome)} ${situacao(paciente.id, pendentes)}</h2>
    <div class="barra-acoes">
      <a class="botao" href="#novo-atendimento/${id}">Registrar atendimento</a>
      <button class="secundario" id="editar">Editar dados</button>
    </div>
    <div id="area-form"></div>
    <div class="painel">
      <dl class="detalhe">
        <div><dt>CPF</dt><dd>${esc(paciente.cpf ?? '-')}</dd></div>
        <div><dt>Nascimento</dt><dd>${data(paciente.data_nascimento)}</dd></div>
        <div><dt>Sexo</dt><dd>${esc(SEXOS[paciente.sexo] ?? '-')}</dd></div>
        <div><dt>Telefone</dt><dd>${esc(paciente.telefone ?? '-')}</dd></div>
        <div><dt>Contato de emergência</dt><dd>${esc(paciente.contato_emergencia_nome ?? '-')} ${esc(paciente.contato_emergencia_telefone ?? '')}</dd></div>
      </dl>
    </div>

    <form class="painel" id="form-prontuario">
      <h3>Prontuário ${prontuario ? situacao(prontuario.id, pendentes) : '<span class="etiqueta">não criado</span>'}</h3>
      <div class="grade">
        <div><label>Tipo sanguíneo</label><select name="tipo_sanguineo">${opcoes(Object.fromEntries(TIPOS_SANGUINEOS.map((t) => [t, t])), p.tipo_sanguineo, 'Não informado')}</select></div>
        <div><label>Alergias (separe por vírgula)</label><input name="alergias" value="${esc(p.alergias)}"></div>
        <div><label>Comorbidades</label><input name="comorbidades" value="${esc(p.comorbidades)}"></div>
        <div><label>Uso contínuo</label><input name="uso_continuo" value="${esc(p.uso_continuo)}"></div>
        <div class="largo"><label>Observações</label><textarea name="observacoes">${esc(p.observacoes)}</textarea></div>
      </div>
      <button type="submit">${prontuario ? 'Salvar prontuário' : 'Criar prontuário'}</button>
    </form>

    <h3>Atendimentos anteriores</h3>
    ${tabelaAtendimentos(lista, pendentes, { [id]: paciente })}`;

  document.getElementById('editar').onclick = () => formPaciente(document.getElementById('area-form'), paciente);
  document.getElementById('form-prontuario').onsubmit = async (e) => {
    e.preventDefault();
    await prontuarios.salvar({ ...lerFormulario(e.target), id: prontuario?.id, paciente_id: id });
    await paginaPaciente(id);
    await depoisDeGravar('Prontuário salvo.');
  };
}

// ---------- Atendimentos ----------

function tabelaAtendimentos(lista, pendentes, pacientesPorId) {
  if (!lista.length) return '<p class="vazio">Nenhum atendimento.</p>';
  return `<div class="tabela-container"><table>
    <thead><tr><th>Data e hora</th><th>Paciente</th><th>Ocorrência</th><th>Manchester</th><th>START</th><th>Glasgow</th><th>Situação</th><th></th></tr></thead>
    <tbody>${lista.map((a) => `
      <tr>
        <td>${dataHora(a.data_hora)}</td>
        <td>${esc(pacientesPorId[a.paciente_id]?.nome ?? '-')}</td>
        <td>${esc(TIPOS_OCORRENCIA[a.tipo_ocorrencia])}</td>
        <td>${triagem(a.manchester, MANCHESTER)}</td>
        <td>${triagem(a.start, START)}</td>
        <td>${totalGlasgow(a)}</td>
        <td>${situacao(a.id, pendentes)}</td>
        <td class="acoes"><a class="botao pequeno" href="#atendimento/${a.id}">Ver</a></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function totalGlasgow(a) {
  return a.glasgow_ocular ? a.glasgow_ocular + a.glasgow_verbal + a.glasgow_motora : '-';
}

async function paginaAtendimentos() {
  const lista = (await atendimentos.listar()).sort((a, b) => b.data_hora.localeCompare(a.data_hora));
  const pacientesPorId = Object.fromEntries((await db.listar('pacientes')).map((p) => [p.id, p]));
  pagina.innerHTML = `
    <h2>Atendimentos</h2>
    <p class="vazio">Atendimentos guardados neste dispositivo (registrados aqui ou recebidos do servidor).</p>
    ${tabelaAtendimentos(lista, await idsPendentes(), pacientesPorId)}`;
}

async function paginaNovoAtendimento(pacienteId) {
  const listaPacientes = (await pacientes.listar()).sort((a, b) => a.nome.localeCompare(b.nome));
  pagina.innerHTML = `
    <h2>Registrar atendimento</h2>
    <p>Paciente ainda não cadastrado? <a href="#pacientes">Cadastre primeiro em Pacientes</a>.</p>
    <form class="painel" id="form-atendimento">
      ${htmlFormAtendimento({ pacientes: listaPacientes, atendimento: { paciente_id: pacienteId } })}
      <button type="submit">Salvar atendimento</button>
    </form>`;

  const form = document.getElementById('form-atendimento');
  ligarFormAtendimento(form, {
    medicamentos: await medicamentos.listar(),
    alergiasDoPaciente: async (id) => (await prontuarios.listarDoPaciente(id))[0]?.alergias,
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const dados = lerFormAtendimento(form);
    const glasgow = [dados.glasgow_ocular, dados.glasgow_verbal, dados.glasgow_motora];
    if (glasgow.some((g) => g !== null) && glasgow.some((g) => g === null)) {
      mostrarMensagem(msg, 'Informe os três componentes da Escala de Glasgow ou nenhum.');
      return;
    }
    const [prontuario] = await prontuarios.listarDoPaciente(dados.paciente_id);
    const salvo = await atendimentos.salvar({
      ...dados,
      prontuario_id: prontuario?.id ?? null,
      profissional_id: sessao.profissional.id,
    });
    await irPara(`atendimento/${salvo.id}`);
    await depoisDeGravar('Atendimento registrado.');
  };
}

async function paginaAtendimento(id) {
  const a = await atendimentos.buscar(id);
  if (!a) {
    pagina.innerHTML = '<p class="vazio">Atendimento não encontrado neste dispositivo.</p>';
    return;
  }
  const paciente = await pacientes.buscar(a.paciente_id);
  const profissional = await profissionais.buscar(a.profissional_id);
  const nomesMedicamentos = Object.fromEntries((await medicamentos.listarTodos()).map((m) => [m.id, m.nome]));
  const pendente = (await idsPendentes()).has(id);
  const item = (rotulo, valor) => `<div><dt>${rotulo}</dt><dd>${valor ?? '-'}</dd></div>`;

  pagina.innerHTML = `
    <h2>Atendimento de ${esc(paciente?.nome ?? '-')} ${pendente ? '<span class="etiqueta pendente">pendente</span>' : '<span class="etiqueta ok">sincronizado</span>'}</h2>
    <div class="painel">
      <dl class="detalhe">
        ${item('Data e hora', dataHora(a.data_hora))}
        ${item('Ocorrência', esc(TIPOS_OCORRENCIA[a.tipo_ocorrencia]))}
        ${item('Local', esc(a.local))}
        ${item('Profissional', esc(profissional?.nome))}
        ${item('Pressão arterial', a.pa_sistolica != null ? `${a.pa_sistolica}/${a.pa_diastolica} mmHg` : null)}
        ${item('FC / FR', `${a.fc ?? '-'} bpm / ${a.fr ?? '-'} irpm`)}
        ${item('SpO2', a.spo2 != null ? `${a.spo2}%` : null)}
        ${item('Temperatura', a.temperatura != null ? `${a.temperatura} °C` : null)}
        ${item('Glicemia', a.glicemia != null ? `${a.glicemia} mg/dL` : null)}
        ${item('Glasgow', totalGlasgow(a))}
        ${item('Manchester', triagem(a.manchester, MANCHESTER))}
        ${item('START', triagem(a.start, START))}
      </dl>
      <p><strong>Descrição:</strong> ${esc(a.descricao)}</p>
      <h3>Medicamentos administrados</h3>
      ${a.medicamentos?.length ? `<table><thead><tr><th>Medicamento</th><th>Dose</th><th>Via</th><th>Horário</th></tr></thead><tbody>
        ${a.medicamentos.map((m) => `<tr><td>${esc(nomesMedicamentos[m.medicamento_id] ?? '-')}</td><td>${Number(m.dose)} ${esc(m.unidade)}</td><td>${esc(m.via ?? '-')}</td><td>${dataHora(m.horario)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="vazio">Nenhum medicamento registrado.</p>'}
    </div>
    <div class="painel">
      <h3>Ficha de atendimento</h3>
      ${pendente ? '<p class="vazio">A ficha é gerada pelo servidor: sincronize este atendimento para baixar o PDF ou enviá-lo por e-mail.</p>' : ''}
      <form id="form-ficha" class="barra-acoes">
        <button type="button" id="pdf" ${pendente ? 'disabled' : ''}>Baixar PDF</button>
        <input type="email" name="destinatario" required placeholder="E-mail do paciente ou familiar" value="${esc(paciente?.email)}" style="max-width:320px">
        <button type="submit" class="secundario" ${pendente ? 'disabled' : ''}>Enviar por e-mail</button>
      </form>
    </div>`;

  document.getElementById('pdf').onclick = () => executar(async () => {
    const { blob, nome } = await servidor.baixarFicha(id);
    baixarBlob(blob, nome);
  }, 'PDF gerado.');
  document.getElementById('form-ficha').onsubmit = (e) => {
    e.preventDefault();
    const destinatario = e.target.destinatario.value;
    executar(() => servidor.enviarFicha(id, destinatario), `Ficha enviada para ${destinatario}.`);
  };
}

// ---------- Medicamentos ----------

async function paginaMedicamentos() {
  const lista = await medicamentos.listar();
  pagina.innerHTML = `
    <h2>Medicamentos</h2>
    <p class="vazio">Catálogo recebido do servidor na última sincronização.</p>
    <div class="tabela-container"><table>
      <thead><tr><th>Nome</th><th>Princípio ativo</th><th>Apresentação</th><th>Concentração</th><th>Via</th><th>Alerta</th></tr></thead>
      <tbody>${lista.map((m) => `
        <tr><td>${esc(m.nome)}</td><td>${esc(m.principio_ativo ?? '-')}</td><td>${esc(m.apresentacao ?? '-')}</td>
          <td>${esc(m.concentracao ?? '-')}</td><td>${esc(m.via_padrao ?? '-')}</td><td>${esc(m.alerta ?? '')}</td></tr>`).join('')}
      </tbody></table>
      ${lista.length ? '' : '<p class="vazio">Nenhum medicamento. Sincronize para baixar o catálogo.</p>'}
    </div>`;
}

// ---------- Sincronização ----------

async function paginaSincronizacao() {
  const fila = await db.listar('outbox');
  const ultimos = (await historico()).slice(-30).reverse();
  const [cursor, ultima] = await Promise.all([db.lerMeta('cursor'), db.lerMeta('ultima_sincronizacao')]);
  const classe = { aplicada: 'ok', duplicada: 'ok', conflito: 'pendente', erro: 'falha' };

  pagina.innerHTML = `
    <h2>Sincronização</h2>
    <div class="painel">
      <dl class="detalhe">
        <div><dt>Conexão</dt><dd>${estaOnline() ? 'Online' : 'Offline'}</dd></div>
        <div><dt>Operações pendentes</dt><dd>${fila.length}</dd></div>
        <div><dt>Última sincronização</dt><dd>${dataHora(ultima)}</dd></div>
        <div><dt>Cursor do servidor</dt><dd>${cursor ?? 0}</dd></div>
      </dl>
      <button id="sincronizar-agora" ${estaOnline() ? '' : 'disabled'}>Sincronizar agora</button>
    </div>

    <h3>Operações pendentes de envio</h3>
    ${fila.length ? `<div class="tabela-container"><table>
      <thead><tr><th>#</th><th>Entidade</th><th>Ação</th><th>Registro</th><th>Feita em</th><th>Tentativas</th><th>Último erro</th><th></th></tr></thead>
      <tbody>${fila.map((op) => `
        <tr>
          <td>${op.seq}</td><td>${esc(op.entidade)}</td><td>${esc(op.acao)}</td>
          <td>${esc(op.dados?.nome ?? op.dados?.descricao?.slice(0, 40) ?? op.entidade_id.slice(0, 8))}</td>
          <td>${dataHora(op.criado_em)}</td><td>${op.tentativas}</td>
          <td>${op.ultimo_erro ? `<span class="etiqueta falha">${esc(op.ultimo_erro)}</span>` : '-'}</td>
          <td>${op.definitivo ? `<button class="perigo pequeno" data-descartar="${op.seq}">Descartar</button>` : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p class="vazio">Nada pendente: todos os registros locais já estão no servidor.</p>'}

    <h3>Histórico recente</h3>
    ${ultimos.length ? `<div class="tabela-container"><table>
      <thead><tr><th>Data e hora</th><th>Entidade</th><th>Ação</th><th>Resultado</th><th>Mensagem</th></tr></thead>
      <tbody>${ultimos.map((h) => `
        <tr><td>${dataHora(h.data_hora)}</td><td>${esc(h.entidade)}</td><td>${esc(h.acao)}</td>
          <td><span class="etiqueta ${classe[h.status]}">${esc(h.status)}</span></td><td>${esc(h.mensagem)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="vazio">Nenhuma sincronização feita ainda.</p>'}`;

  document.getElementById('sincronizar-agora').onclick = () => sincronizarComAviso();
  pagina.querySelectorAll('[data-descartar]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Descartar esta operação? A alteração local não será enviada ao servidor.')) return;
      await descartar(Number(b.dataset.descartar));
      await atualizarTopo();
      paginaSincronizacao();
    };
  });
}

async function sincronizarComAviso() {
  if (!estaOnline()) {
    mostrarMensagem(msg, 'Offline: os dados continuam guardados no dispositivo e serão enviados quando a conexão voltar.', 'aviso');
    return;
  }
  if (!tokenValido(sessao.token)) {
    await sair();
    await mostrarTelas('Sua sessão expirou. Entre novamente (online) para sincronizar; os dados pendentes continuam guardados.');
    return;
  }
  const botao = document.getElementById('botao-sincronizar');
  botao.disabled = true;
  try {
    const r = await sincronizar();
    const partes = [`${r.aplicadas} enviada(s)`, `${r.recebidos} registro(s) recebido(s)`];
    if (r.duplicadas) partes.push(`${r.duplicadas} já recebida(s) antes`);
    if (r.conflitos) partes.push(`${r.conflitos} conflito(s)`);
    if (r.erros) partes.push(`${r.erros} erro(s)`);
    mostrarMensagem(msg, `Sincronização concluída: ${partes.join(', ')}.${r.mensagens.length ? ' ' + r.mensagens.join(' | ') : ''}`,
      r.erros || r.conflitos ? 'aviso' : 'sucesso');
  } catch (erro) {
    if (erro.status === 401) {
      await sair();
      await mostrarTelas('O servidor recusou o token. Entre novamente para sincronizar.');
      return;
    }
    mostrarMensagem(msg, `Falha na sincronização: ${erro.message}. As operações continuam na fila.`);
  } finally {
    botao.disabled = false;
    await atualizarTopo();
    redesenharSemPerderFormulario();
  }
}

// Atualiza as etiquetas de situação depois de sincronizar, exceto quando o
// usuário está com um formulário aberto.
function redesenharSemPerderFormulario() {
  const atual = location.hash.slice(1).split(/[/?]/)[0];
  const formularioAberto = atual === 'novo-atendimento' || document.getElementById('area-form')?.children.length;
  if (!formularioAberto) navegar(false);
}

async function depoisDeGravar(texto) {
  await atualizarTopo();
  if (estaOnline()) {
    await sincronizarComAviso();
  } else {
    mostrarMensagem(msg, `${texto} Guardado no dispositivo (offline) e pendente de envio.`, 'aviso');
  }
}

// ---------- Estrutura da tela ----------

async function atualizarTopo() {
  const online = estaOnline();
  const indicador = document.getElementById('indicador');
  indicador.className = `indicador ${online ? 'online' : 'offline'}`;
  indicador.textContent = online ? 'Online' : (simuladorEstaOnline() ? 'Sem rede' : 'Offline');
  document.querySelectorAll('[data-simular]').forEach((b) => {
    b.classList.toggle('selecionado', (b.dataset.simular === 'online') === simuladorEstaOnline());
  });
  document.getElementById('contador-pendentes').textContent = await contarPendentes();
  document.getElementById('botao-sincronizar').disabled = !online;
}

const PAGINAS = {
  pacientes: paginaPacientes,
  paciente: paginaPaciente,
  'novo-atendimento': paginaNovoAtendimento,
  atendimentos: paginaAtendimentos,
  atendimento: paginaAtendimento,
  medicamentos: paginaMedicamentos,
  sincronizacao: paginaSincronizacao,
};

async function executar(acao, sucesso) {
  try {
    await acao();
    if (sucesso) mostrarMensagem(msg, sucesso, 'sucesso');
  } catch (erro) {
    mostrarMensagem(msg, erro.message);
  }
}

async function navegar(limparMensagem = true) {
  if (!sessao) return;
  const [nome, parametro] = location.hash.slice(1).split('?')[0].split('/');
  const atual = PAGINAS[nome] ? nome : 'pacientes';
  document.querySelectorAll('#menu a').forEach((a) => {
    a.classList.toggle('ativo', a.getAttribute('href') === `#${atual}` || (atual === 'paciente' && a.getAttribute('href') === '#pacientes'));
  });
  if (limparMensagem && !manterMensagem) mostrarMensagem(msg, '');
  manterMensagem = false;
  await executar(() => PAGINAS[atual](parametro));
}

async function mostrarTelas(aviso) {
  sessao = await sessaoAtual();
  const logado = !!sessao;
  document.getElementById('tela-login').classList.toggle('oculto', logado);
  document.getElementById('tela-app').classList.toggle('oculto', !logado);
  for (const id of ['botao-sincronizar', 'usuario', 'sair']) document.getElementById(id).classList.toggle('oculto', !logado);
  await atualizarTopo();

  if (!logado) {
    document.getElementById('aviso-login').textContent = estaOnline()
      ? 'Online: o login é validado pelo servidor.'
      : 'Offline: só entra quem já fez login online neste dispositivo.';
    if (aviso) mostrarMensagem(document.getElementById('msg-login'), aviso, 'aviso');
    return;
  }
  const p = sessao.profissional;
  document.getElementById('usuario').textContent = `${p.nome} (${p.tipo_registro} ${p.numero_registro})${sessao.modo === 'offline' ? ' · login offline' : ''}`;
  await navegar();
}

document.getElementById('form-login').onsubmit = async (e) => {
  e.preventDefault();
  const { tipo_registro, numero_registro, senha } = e.target.elements;
  try {
    await entrar(tipo_registro.value, numero_registro.value, senha.value);
    e.target.reset();
    mostrarMensagem(document.getElementById('msg-login'), '');
    await mostrarTelas();
    if (estaOnline() && (await db.lerMeta('cursor')) === undefined) await sincronizarComAviso();
  } catch (erro) {
    mostrarMensagem(document.getElementById('msg-login'), erro.message);
  }
};

document.getElementById('sair').onclick = async () => {
  await sair();
  location.hash = '';
  mostrarTelas();
};

document.getElementById('botao-sincronizar').onclick = () => sincronizarComAviso();

document.querySelectorAll('[data-simular]').forEach((b) => {
  b.onclick = () => definirSimulador(b.dataset.simular === 'online');
});

// Observers da conectividade: atualizam a tela e, quando a conexão volta,
// disparam o envio da fila pendente.
assinar(() => {
  atualizarTopo();
  if (!sessao) mostrarTelas();
});
assinar(async ({ voltouAgora }) => {
  if (voltouAgora && sessao && (await contarPendentes()) > 0) sincronizarComAviso();
});

window.addEventListener('hashchange', () => navegar());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/socorrista/sw.js', { scope: '/socorrista/' })
    .catch((erro) => console.error('Service Worker não registrado:', erro));
}

mostrarTelas();
