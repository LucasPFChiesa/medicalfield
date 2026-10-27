// Roteiro oficial de 17 passos, executado no Chrome contra a VM (portal e app do socorrista).
// O passo 9 insere o medicamento direto no PostgreSQL da VM via ssh + psql.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SENHA = process.env.SENHA_DEMO;
const VM = process.env.VM_SSH ?? 'univates@177.44.248.50';
const EMAIL = process.env.EMAIL_TESTE ?? 'lpfctest@gmail.com';
const CLIENTE = process.env.BASE_URL ?? 'https://medicalfield.duckdns.org';
const marca = Date.now().toString().slice(-6);

async function entrar(pagina, tipo, numero) {
  await pagina.selectOption('#tipo_registro', tipo);
  await pagina.fill('#numero_registro', numero);
  await pagina.fill('#senha', SENHA);
  await pagina.click('#form-login button[type=submit]');
}

async function linhasDaTabela(pagina) {
  await pagina.waitForSelector('#pagina h2');
  return pagina.locator('#pagina table tbody tr').count();
}

// Recarrega a página inteira para garantir que a lista veio do servidor agora.
async function abrirPortal(portal, secao) {
  await portal.goto(`/portal/#${secao}`);
  await portal.reload();
  await portal.waitForSelector('#pagina table');
}

test('roteiro de avaliação (17 passos)', async ({ browser }) => {
  const contextoPortal = await browser.newContext();
  const contextoCliente = await browser.newContext();
  const portal = await contextoPortal.newPage();
  const cliente = await contextoCliente.newPage();

  await test.step('1. Portal: autenticar', async () => {
    await portal.goto('/portal/');
    await entrar(portal, 'CRM', 'admin');
    await expect(portal.locator('#usuario')).toContainText('Lucas Chiesa');
  });

  await test.step('2. Portal: listar cadastros', async () => {
    await abrirPortal(portal, 'pacientes');
    expect(await linhasDaTabela(portal)).toBeGreaterThanOrEqual(5);
    await abrirPortal(portal, 'medicamentos');
    expect(await linhasDaTabela(portal)).toBeGreaterThanOrEqual(10);
  });

  await test.step('3. Portal: listar prontuários', async () => {
    await abrirPortal(portal, 'prontuarios');
    expect(await linhasDaTabela(portal)).toBeGreaterThanOrEqual(5);
  });

  let atendimentosNoPortal;
  await test.step('4. Portal: listar atendimentos', async () => {
    await abrirPortal(portal, 'atendimentos');
    atendimentosNoPortal = await linhasDaTabela(portal);
    expect(atendimentosNoPortal).toBeGreaterThanOrEqual(3);
  });

  await test.step('5. Cliente: autenticar', async () => {
    await cliente.goto(CLIENTE + '/socorrista/');
    await cliente.click('[data-simular=online]');
    await entrar(cliente, 'SOCORRISTA', 'socorrista');
    await expect(cliente.locator('#usuario')).toContainText('Socorrista Teste');
  });

  await test.step('6. Cliente: sincronizar dados a partir do portal', async () => {
    await cliente.click('#botao-sincronizar');
    await expect(cliente.locator('#msg')).toContainText('Sincronização concluída');
    await cliente.goto(CLIENTE + '/socorrista/#medicamentos');
    expect(await linhasDaTabela(cliente)).toBeGreaterThanOrEqual(10);
    await cliente.goto(CLIENTE + '/socorrista/#pacientes');
    expect(await linhasDaTabela(cliente)).toBeGreaterThanOrEqual(5);
  });

  await test.step('7. Cliente online: registrar atendimento', async () => {
    await cliente.goto(CLIENTE + '/socorrista/#novo-atendimento');
    const form = cliente.locator('#form-atendimento');
    await form.locator('[name=paciente_id]').selectOption({ label: 'Ana Paula Ferreira' });
    await form.locator('[name=tipo_ocorrencia]').selectOption('clinica');
    await form.locator('[name=local]').fill('Teste automático online');
    await form.locator('[name=descricao]').fill(`Crise asmática (E2E online ${marca})`);
    await form.locator('[name=fr]').fill('28');
    await form.locator('[name=spo2]').fill('91');
    await form.locator('[name=glasgow_ocular]').selectOption('4');
    await form.locator('[name=glasgow_verbal]').selectOption('5');
    await form.locator('[name=glasgow_motora]').selectOption('6');
    await expect(form.locator('[data-glasgow-total]')).toHaveText('15');
    await form.locator('[name=manchester]').selectOption('amarelo');
    await form.locator('[data-adicionar-medicamento]').click();
    await form.locator('[name=medicamento_id]').selectOption({ label: 'Salbutamol' });
    await form.locator('[name=dose]').fill('400');
    await form.locator('[name=unidade]').fill('mcg');
    await form.locator('button[type=submit]').click();
    await expect(cliente.locator('#msg')).toContainText('Sincronização concluída');
    await expect(cliente.locator('h2 .etiqueta')).toHaveText('sincronizado');
  });

  await test.step('8. Portal: visualizar atendimento registrado', async () => {
    await abrirPortal(portal, 'atendimentos');
    expect(await linhasDaTabela(portal)).toBe(atendimentosNoPortal + 1);
    atendimentosNoPortal += 1;
    await portal.locator('#pagina tbody tr', { hasText: 'Ana Paula Ferreira' }).first().locator('[data-ver]').click();
    await expect(portal.locator('#area-detalhe')).toContainText(`E2E online ${marca}`);
  });

  const medicamentoNovo = `Ipratrópio E2E ${marca}`;
  await test.step('9. Portal: inserir medicamento novo via banco de dados', async () => {
    const sql = `INSERT INTO medicamento (nome, principio_ativo, apresentacao, via_padrao) VALUES ('${medicamentoNovo}', 'Brometo de ipratrópio', 'Solução para nebulização', 'Inalatória')`;
    execFileSync('ssh', ['-o', 'BatchMode=yes', VM, `psql -d medicalfield -c "${sql}"`]);
    await abrirPortal(portal, 'medicamentos');
    await expect(portal.locator('#pagina tbody')).toContainText(medicamentoNovo);
  });

  await test.step('10. Portal: listar atendimentos', async () => {
    await abrirPortal(portal, 'atendimentos');
    expect(await linhasDaTabela(portal)).toBe(atendimentosNoPortal);
  });

  await test.step('11. Cliente: sincronizar novamente e receber o medicamento novo', async () => {
    await cliente.click('#botao-sincronizar');
    await expect(cliente.locator('#msg')).toContainText('Sincronização concluída');
    await cliente.goto(CLIENTE + '/socorrista/#medicamentos');
    await expect(cliente.locator('#pagina tbody')).toContainText(medicamentoNovo);
  });

  const vitima = `Vítima Offline E2E ${marca}`;
  const requisicoesOffline = [];
  await test.step('12. Cliente offline: criar pessoa, prontuário e atendimento', async () => {
    await cliente.click('[data-simular=offline]');
    await expect(cliente.locator('#indicador')).toHaveText('Offline');
    cliente.on('request', (r) => { if (r.url().includes('/api/')) requisicoesOffline.push(r.url()); });

    await cliente.goto(CLIENTE + '/socorrista/#pacientes');
    await cliente.click('#novo');
    await cliente.fill('#form-paciente [name=nome]', vitima);
    await cliente.selectOption('#form-paciente [name=sexo]', 'M');
    await cliente.fill('#form-paciente [name=contato_emergencia_nome]', 'Familiar de teste');
    await cliente.click('#form-paciente button[type=submit]');
    await expect(cliente.locator('#msg')).toContainText(`Paciente ${vitima} salvo. Guardado no dispositivo (offline)`);

    await cliente.selectOption('#form-prontuario [name=tipo_sanguineo]', 'O+');
    await cliente.fill('#form-prontuario [name=alergias]', 'Dipirona');
    await cliente.click('#form-prontuario button[type=submit]');
    await expect(cliente.locator('#msg')).toContainText('Prontuário salvo. Guardado no dispositivo (offline)');

    await cliente.click('#pagina a.botao[href^="#novo-atendimento/"]');
    const form = cliente.locator('#form-atendimento');
    await expect(form.locator('[name=paciente_id] option:checked')).toHaveText(vitima);
    await form.locator('[name=tipo_ocorrencia]').selectOption('acidente_transito');
    await form.locator('[name=descricao]').fill(`Colisão em rodovia sem sinal (E2E offline ${marca})`);
    await form.locator('[name=pa_sistolica]').fill('110');
    await form.locator('[name=pa_diastolica]').fill('70');
    await form.locator('[name=glasgow_ocular]').selectOption('3');
    await form.locator('[name=glasgow_verbal]').selectOption('4');
    await form.locator('[name=glasgow_motora]').selectOption('6');
    await form.locator('[name=manchester]').selectOption('laranja');
    await form.locator('[name=start]').selectOption('amarelo');
    await form.locator('[data-adicionar-medicamento]').click();
    await form.locator('[name=medicamento_id]').selectOption({ label: 'Dipirona sódica' });
    await expect(form.locator('.alerta-medicamento')).toContainText('alergia a "dipirona"');
    await form.locator('[name=medicamento_id]').selectOption({ label: 'Soro fisiológico 0,9%' });
    await form.locator('[name=dose]').fill('500');
    await form.locator('[name=unidade]').fill('mL');
    await form.locator('button[type=submit]').click();
    await expect(cliente.locator('#msg')).toContainText('Atendimento registrado. Guardado no dispositivo (offline)');

    await expect(cliente.locator('#contador-pendentes')).toHaveText('3');
    await cliente.goto(CLIENTE + '/socorrista/#sincronizacao');
    expect(await cliente.locator('#pagina table').first().locator('tbody tr').count()).toBe(3);
    expect(requisicoesOffline).toEqual([]);
  });

  await test.step('13. Portal: cadastro novo ainda não aparece', async () => {
    await abrirPortal(portal, 'pacientes');
    await expect(portal.locator('#pagina tbody')).not.toContainText(vitima);
    await abrirPortal(portal, 'prontuarios');
    await expect(portal.locator('#pagina tbody')).not.toContainText(vitima);
    await abrirPortal(portal, 'atendimentos');
    expect(await linhasDaTabela(portal)).toBe(atendimentosNoPortal);
  });

  await test.step('14. Cliente online: sincronizar com o portal', async () => {
    await cliente.click('[data-simular=online]');
    // o Observer da conectividade dispara o envio da fila automaticamente
    await expect(cliente.locator('#contador-pendentes')).toHaveText('0', { timeout: 20_000 });
    await expect(cliente.locator('#msg')).toContainText('3 enviada(s)');
  });

  await test.step('15. Portal: registros novos aparecem', async () => {
    await abrirPortal(portal, 'pacientes');
    await expect(portal.locator('#pagina tbody')).toContainText(vitima);
    await abrirPortal(portal, 'prontuarios');
    await expect(portal.locator('#pagina tbody')).toContainText(vitima);
    await abrirPortal(portal, 'atendimentos');
    expect(await linhasDaTabela(portal)).toBe(atendimentosNoPortal + 1);
    await expect(portal.locator('#pagina tbody')).toContainText(vitima);
    await abrirPortal(portal, 'sincronizacoes');
    await expect(portal.locator('#pagina tbody tr').first()).toContainText('aplicada');
  });

  await test.step('16. Gerar a ficha de atendimento em PDF', async () => {
    await cliente.goto(CLIENTE + '/socorrista/#atendimentos');
    await cliente.locator('#pagina tbody tr', { hasText: vitima }).locator('text=Ver').click();
    await expect(cliente.locator('h2 .etiqueta')).toHaveText('sincronizado');
    const [download] = await Promise.all([cliente.waitForEvent('download'), cliente.click('#pdf')]);
    expect(download.suggestedFilename()).toMatch(/^ficha-atendimento-.*\.pdf$/);
    const conteudo = readFileSync(await download.path());
    expect(conteudo.subarray(0, 4).toString()).toBe('%PDF');
  });

  await test.step('17. Enviar a ficha por e-mail', async () => {
    await cliente.fill('#form-ficha [name=destinatario]', EMAIL);
    await cliente.click('#form-ficha button[type=submit]');
    await expect(cliente.locator('#msg')).toContainText(`Ficha enviada para ${EMAIL}`, { timeout: 30_000 });
  });

  await contextoPortal.close();
  await contextoCliente.close();
});

test('sem rede de verdade: app abre pelo Service Worker e aceita login offline', async ({ browser }) => {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await pagina.goto(CLIENTE + '/socorrista/');
  await pagina.click('[data-simular=online]');
  await entrar(pagina, 'COREN', 'enfermeiro');
  await expect(pagina.locator('#usuario')).toContainText('Enfermeiro Teste');
  await expect(pagina.locator('#msg')).toContainText('Sincronização concluída');
  await pagina.evaluate(() => navigator.serviceWorker.ready);
  await pagina.click('#sair');
  await expect(pagina.locator('#tela-login')).toBeVisible();

  await contexto.setOffline(true);
  await pagina.reload();
  // simulador continua em ONLINE, mas a rede real caiu
  await expect(pagina.locator('#indicador')).toHaveText('Sem rede');
  await entrar(pagina, 'COREN', 'enfermeiro');
  await expect(pagina.locator('#usuario')).toContainText('login offline');
  await pagina.goto(CLIENTE + '/socorrista/#pacientes');
  expect(await linhasDaTabela(pagina)).toBeGreaterThanOrEqual(5);

  // senha errada continua bloqueada sem rede
  await pagina.click('#sair');
  await pagina.selectOption('#tipo_registro', 'COREN');
  await pagina.fill('#numero_registro', 'enfermeiro');
  await pagina.fill('#senha', 'senha-errada');
  await pagina.click('#form-login button[type=submit]');
  await expect(pagina.locator('#msg-login')).toContainText('incorretos');
  await contexto.close();
});

test('internet cai sem o navegador perceber: app detecta e volta sozinho', async ({ browser }) => {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await pagina.goto(CLIENTE + '/socorrista/');
  await pagina.click('[data-simular=online]');
  await entrar(pagina, 'CRM', 'admin');
  await expect(pagina.locator('#indicador')).toHaveText('Online');

  // navigator.onLine continua true, mas nada chega ao servidor
  await pagina.route('**/api/**', (rota) => rota.abort('internetdisconnected'));
  await expect(pagina.locator('#indicador')).toHaveText('Sem rede', { timeout: 10_000 });

  await pagina.unroute('**/api/**');
  await expect(pagina.locator('#indicador')).toHaveText('Online', { timeout: 10_000 });
  await contexto.close();
});
