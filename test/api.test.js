// Testes automáticos da API e das regras de negócio do Agenda Expert.
// Sobe um servidor isolado (banco temporário) e exercita cada requisito.
// Rodar: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'));
const PORT = 5400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'teste@agenda.test';
const PASS = 'SenhaDeTeste123';
let server;
let cookie = '';

// datas futuras fixas, independentes do dia em que o teste roda
const D1 = '2031-03-10', D2 = '2031-03-11', D3 = '2031-03-12', D4 = '2031-03-13', D5 = '2031-03-14';

async function req(method, p, body, { headers = {}, auth = true } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie();
  if (auth && set.length) cookie = set[0].split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers, text };
}
const get = (p, o) => req('GET', p, null, o);
const post = (p, b, o) => req('POST', p, b || {}, o);
const put = (p, b) => req('PUT', p, b);
const patch = (p, b) => req('PATCH', p, b);
const del = (p) => req('DELETE', p);

function rawGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

function startServer(extraEnv = {}) {
  return new Promise(async (resolve, reject) => {
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: PASS, ADMIN_NAME: 'Teste', TRUST_PROXY: '1', NODE_ENV: 'test', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    proc.stdout.on('data', (c) => (log += c));
    proc.stderr.on('data', (c) => (log += c));
    proc.on('exit', (code) => reject(Object.assign(new Error('Servidor encerrou:\n' + log), { code, log })));
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/api/health')).ok) return resolve(proc); } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    reject(new Error('Servidor não subiu:\n' + log));
  });
}
const stopServer = (proc) => new Promise((r) => { proc.removeAllListeners('exit'); proc.once('exit', r); proc.kill(); });

before(async () => { server = await startServer(); });

after(() => {
  server?.kill();
  setTimeout(() => fs.rmSync(DATA, { recursive: true, force: true }), 300);
});

const ids = {};
const procId = (name) => ids.procs.find((p) => p.name === name).id;

// ------------------------------------------------------------------ Acesso
test('health responde sem login', async () => {
  const r = await get('/api/health', { auth: false });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
});

test('RF01: sem login nenhuma rota de dados é acessível', async () => {
  for (const p of ['/api/clients', '/api/procedures', '/api/appointments?from=2031-01-01&to=2031-01-02', '/api/transactions?month=2031-03', '/api/backup', '/api/me']) {
    assert.equal((await get(p, { auth: false })).status, 401, p);
  }
});

test('CSU01: credenciais inválidas mostram "E-mail ou senha incorretos"', async () => {
  const r = await post('/api/login', { email: EMAIL, password: 'errada' }, { auth: false, headers: { 'X-Forwarded-For': '10.0.0.1' } });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'E-mail ou senha incorretos');
  const r2 = await post('/api/login', { email: 'outra@x.com', password: PASS }, { auth: false, headers: { 'X-Forwarded-For': '10.0.0.1' } });
  assert.equal(r2.status, 401);
});

test('RF01/RNF06: login correto cria sessão HttpOnly e SameSite', async () => {
  const r = await post('/api/login', { email: EMAIL.toUpperCase(), password: PASS });
  assert.equal(r.status, 200);
  const sc = r.headers.getSetCookie()[0];
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  const me = await get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, EMAIL);
  assert.match(me.data.today, /^\d{4}-\d{2}-\d{2}$/);
});

test('RNF06: senha armazenada com hash (scrypt), nunca em texto', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(DATA, 'agenda-expert.db'), { readOnly: true });
  const u = db.prepare('SELECT password_hash FROM users').get();
  db.close();
  assert.match(u.password_hash, /^scrypt\$/);
  assert.ok(!u.password_hash.includes(PASS));
});

// ------------------------------------------------------------------ Ajustes
test('mensagem do WhatsApp: modelo padrão e edição em Ajustes', async () => {
  const s = (await get('/api/settings')).data;
  assert.match(s.whatsapp_template, /Passando para confirmar seu atendimento, agendado para o dia \[data\], às \[horário\]/);
  assert.match(s.whatsapp_template, /Rua Aiapaina, 3A/);
  const novo = 'Oi [nome], te espero dia [data] às [horário]! 💛';
  assert.equal((await put('/api/settings', { whatsapp_template: novo })).data.whatsapp_template, novo);
  assert.equal((await get('/api/me')).data.settings.whatsapp_template, novo);
  await put('/api/settings', { whatsapp_template: s.whatsapp_template });
});

test('ajustes: salva horário e rejeita horário inválido', async () => {
  const r = await put('/api/settings', { open_time: '08:00', close_time: '20:00', work_days: '0,1,2,3,4,5,6', gap_min: '0' });
  assert.equal(r.status, 200);
  assert.equal(r.data.work_days, '0,1,2,3,4,5,6');
  assert.equal((await put('/api/settings', { open_time: '25:00' })).status, 400);
});

// ------------------------------------------------------------------ Catálogo
test('RF08: catálogo inicial com os 9 procedimentos e valores do Anexo A', async () => {
  const r = await get('/api/procedures');
  ids.procs = r.data;
  assert.equal(r.data.length, 9);
  const expect = {
    Nanoblading: [62000, 150], 'Design de sobrancelha': [5000, 30], 'Brow lamination': [12000, 60],
    'Extensão de cílios': [17000, 120], 'Manutenção de cílios': [12000, 90], 'Remoção de cílios': [4500, 30],
    'Lash lifting': [18000, 60], 'Depilação buço': [3500, 15], 'Limpeza de pele': [20000, 75],
  };
  for (const [n, [price, dur]] of Object.entries(expect)) {
    const p = r.data.find((x) => x.name === n);
    assert.ok(p, n);
    assert.equal(p.price_cents, price, n);
    assert.equal(p.duration_min, dur, n);
  }
});

test('CSU04: valor < 0 ou duração ≤ 0 são rejeitados', async () => {
  assert.equal((await post('/api/procedures', { name: 'X', price_cents: -1, duration_min: 30 })).status, 400);
  assert.equal((await post('/api/procedures', { name: 'X', price_cents: 100, duration_min: 0 })).status, 400);
  assert.equal((await post('/api/procedures', { name: '', price_cents: 100, duration_min: 30 })).status, 400);
  const ok = await post('/api/procedures', { name: 'Procedimento grátis', price_cents: 0, duration_min: 20 });
  assert.equal(ok.status, 200, 'valor zero é permitido (≥ 0)');
});

test('RF09: adicionar, editar e desativar procedimento', async () => {
  const c = await post('/api/procedures', { name: 'Henna', description: 'Teste', price: '40,00', duration_min: 30 });
  assert.equal(c.status, 200);
  assert.equal(c.data.price_cents, 4000);
  const e = await put(`/api/procedures/${c.data.id}`, { name: 'Henna premium', price_cents: 5500, duration_min: 40 });
  assert.equal(e.data.name, 'Henna premium');
  assert.equal(e.data.duration_min, 40);
  await put(`/api/procedures/${c.data.id}`, { ...e.data, active: false });
  const active = await get('/api/procedures');
  assert.ok(!active.data.some((p) => p.id === c.data.id), 'desativado some das novas marcações');
  const all = await get('/api/procedures?all=1');
  assert.ok(all.data.some((p) => p.id === c.data.id && !p.active), 'mas continua no histórico');
  ids.inactiveProc = c.data.id;
});

// ------------------------------------------------------------------ Clientes
test('CSU02: nome e telefone obrigatórios; e-mail validado', async () => {
  const r = await post('/api/clients', { name: '', phone: '' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.data.fields.sort(), ['name', 'phone']);
  assert.equal((await post('/api/clients', { name: 'A', phone: '123' })).status, 400);
  assert.equal((await post('/api/clients', { name: 'A', phone: '(11) 91234-5678', email: 'invalido' })).status, 400);
  assert.equal((await post('/api/clients', { name: 'A', phone: '(11) 91234-5678', birth_date: '2020-13-40' })).status, 400);
});

test('RF03: cadastrar clientes', async () => {
  const a = await post('/api/clients', { name: 'Ana Paula Souza', phone: '(11) 99999-0000', birth_date: '1992-03-14', email: 'ana@exemplo.com', notes: 'Prefere manhã' });
  assert.equal(a.status, 200);
  assert.equal(a.data.anamnese, 'pendente');
  ids.ana = a.data.id;
  ids.bia = (await post('/api/clients', { name: 'Beatriz Lopes', phone: '11955554444' })).data.id;
  ids.carla = (await post('/api/clients', { name: 'Carla Mendes', phone: '(11) 96666-3333' })).data.id;
});

test('CSU02: telefone já cadastrado avisa e oferece o cadastro existente', async () => {
  const r = await post('/api/clients', { name: 'Outra Ana', phone: '11 99999 0000' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'duplicate_phone');
  assert.equal(r.data.existing_id, ids.ana);
});

test('RF04: buscar por nome (parcial) ou telefone, editar e inativar', async () => {
  assert.ok((await get('/api/clients?q=paula')).data.some((c) => c.id === ids.ana));
  assert.ok((await get('/api/clients?q=99999')).data.some((c) => c.id === ids.ana));
  assert.ok((await get('/api/clients?q=(11) 95555')).data.some((c) => c.id === ids.bia));
  const e = await put(`/api/clients/${ids.carla}`, { name: 'Carla Mendes Silva', phone: '(11) 96666-3333' });
  assert.equal(e.data.name, 'Carla Mendes Silva');
  await post(`/api/clients/${ids.carla}/active`, { active: false });
  assert.ok(!(await get('/api/clients')).data.some((c) => c.id === ids.carla), 'inativa some da lista');
  assert.ok((await get('/api/clients?inactive=1')).data.some((c) => c.id === ids.carla && !c.active));
  await post(`/api/clients/${ids.carla}/active`, { active: true });
});

test('RF05/RF06/CSU03: anamnese sem termo vira rascunho; com termo registra a data', async () => {
  const r1 = await put(`/api/clients/${ids.ana}/anamnese`, { alergias: 'sim', alergias_detalhe: 'látex', gestante: 'nao', consent: false });
  assert.equal(r1.data.state, 'rascunho');
  assert.equal((await get(`/api/clients/${ids.ana}`)).data.anamnese, 'rascunho');
  await put(`/api/clients/${ids.ana}/anamnese`, { alergias: 'sim', alergias_detalhe: 'látex', gestante: 'nao', consent: true });
  const c = await get(`/api/clients/${ids.ana}`);
  assert.equal(c.data.anamnese, 'ok');
  assert.equal(c.data.anamnese_data.alergias_detalhe, 'látex');
  assert.match(c.data.anamnese_data.filled_at, /^\d{4}-\d{2}-\d{2}$/);
});

// ------------------------------------------------------------------ Agendamentos
test('RF10/RF11/RN04/RN06: cria agendamento, calcula término e nasce "agendada"', async () => {
  const r = await post('/api/appointments', { client_id: ids.ana, procedure_ids: [procId('Extensão de cílios')], date: D1, start: '10:00' });
  assert.equal(r.status, 200);
  assert.equal(r.data.end, '12:00');
  assert.equal(r.data.status, 'agendada');
  assert.equal(r.data.total_cents, 17000);
  assert.equal(r.data.start_at, `${D1}T10:00:00-03:00`, 'RSIS05: guardado com fuso de Brasília');
  assert.ok(r.data.created_at && r.data.updated_at, 'RSIS07: datas de criação/alteração');
  ids.apptAna = r.data.id;
});

test('RF10: vários procedimentos somam duração e valor', async () => {
  const r = await post('/api/appointments', { client_id: ids.bia, procedure_ids: [procId('Design de sobrancelha'), procId('Depilação buço')], date: D1, start: '12:00' });
  assert.equal(r.status, 200, 'encostado no fim do anterior é permitido');
  assert.equal(r.data.end, '12:45');
  assert.equal(r.data.total_cents, 8500);
  assert.equal(r.data.procedures.length, 2);
  ids.apptBia = r.data.id;
});

test('validações de agendamento', async () => {
  const base = { client_id: ids.bia, procedure_ids: [procId('Design de sobrancelha')], date: D2, start: '10:00' };
  assert.equal((await post('/api/appointments', { ...base, client_id: 999999 })).status, 400);
  assert.equal((await post('/api/appointments', { ...base, procedure_ids: [] })).status, 400);
  assert.equal((await post('/api/appointments', { ...base, date: '2031-02-30' })).status, 400);
  assert.equal((await post('/api/appointments', { ...base, start: '25:00' })).status, 400);
  assert.equal((await post('/api/appointments', { ...base, procedure_ids: [ids.inactiveProc] })).status, 400, 'procedimento desativado');
  assert.equal((await post('/api/appointments', { ...base, procedure_ids: [procId('Nanoblading')], start: '23:00' })).status, 400, 'passa da meia-noite');
});

test('RN02/RF12: impede sobreposição e sugere o próximo horário livre', async () => {
  const r = await post('/api/appointments', { client_id: ids.carla, procedure_ids: [procId('Lash lifting')], date: D1, start: '11:00' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'conflict');
  assert.match(r.data.error, /Ana Paula Souza/);
  assert.deepEqual(r.data.next_free, { date: D1, start: '12:45' });
  const r2 = await post('/api/appointments', { client_id: ids.carla, procedure_ids: [procId('Lash lifting')], date: D1, start: '09:30' });
  assert.equal(r2.status, 409, 'término invade o próximo');
});

test('RN13/RF07: alerta de anamnese pendente (sem bloquear)', async () => {
  const r = await post('/api/appointments/check', { client_id: ids.bia, procedure_ids: [procId('Lash lifting')], date: D2, start: '10:00' });
  assert.equal(r.status, 200);
  assert.equal(r.data.conflict, null);
  assert.ok(r.data.warnings.some((w) => w.code === 'anamnese'));
  const ana = await post('/api/appointments/check', { client_id: ids.ana, procedure_ids: [procId('Lash lifting')], date: D2, start: '10:00' });
  assert.ok(!ana.data.warnings.some((w) => w.code === 'anamnese'), 'anamnese ok não alerta');
});

test('RN12: manutenção de cílios antes de 20 dias avisa, mas não bloqueia', async () => {
  const p = { client_id: ids.ana, procedure_ids: [procId('Manutenção de cílios')], start: '10:00' };
  const early = await post('/api/appointments/check', { ...p, date: '2031-03-20' });
  const w = early.data.warnings.find((x) => x.code === 'cilios');
  assert.ok(w, 'avisa');
  assert.match(w.message, /10 dias/);
  const late = await post('/api/appointments/check', { ...p, date: '2031-04-05' });
  assert.ok(!late.data.warnings.some((x) => x.code === 'cilios'), 'após 20 dias não avisa');
  const saved = await post('/api/appointments', { ...p, date: '2031-03-20' });
  assert.equal(saved.status, 200, 'profissional pode seguir mesmo assim');
  await del(`/api/appointments/${saved.data.id}`);
});

test('RN08: mudar o catálogo não altera atendimentos já criados', async () => {
  const id = procId('Extensão de cílios');
  await put(`/api/procedures/${id}`, { name: 'Extensão de cílios', price_cents: 25000, duration_min: 150 });
  const a = await get(`/api/appointments/${ids.apptAna}`);
  assert.equal(a.data.total_cents, 17000);
  assert.equal(a.data.end, '12:00');
  // reagendar mantém o valor praticado
  const r = await put(`/api/appointments/${ids.apptAna}`, { client_id: ids.ana, procedure_ids: [id], date: D1, start: '09:00' });
  assert.equal(r.status, 200);
  assert.equal(r.data.total_cents, 17000);
  assert.equal(r.data.end, '11:00');
  const novo = await post('/api/appointments/check', { client_id: ids.ana, procedure_ids: [id], date: D5, start: '09:00' });
  assert.equal(novo.data.total_cents, 25000, 'novos agendamentos usam o preço novo');
  await put(`/api/procedures/${id}`, { name: 'Extensão de cílios', price_cents: 17000, duration_min: 120 });
});

test('RF13/CSU06-B: reagendar revalida conflitos', async () => {
  const r = await put(`/api/appointments/${ids.apptBia}`, { client_id: ids.bia, procedure_ids: [procId('Design de sobrancelha'), procId('Depilação buço')], date: D1, start: '10:00' });
  assert.equal(r.status, 409);
  const ok = await put(`/api/appointments/${ids.apptBia}`, { client_id: ids.bia, procedure_ids: [procId('Design de sobrancelha'), procId('Depilação buço')], date: D1, start: '14:00', notes: 'Remarcado' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.notes, 'Remarcado');
});

test('RF14/RN05: status válidos e cancelamento exige motivo', async () => {
  assert.equal((await patch(`/api/appointments/${ids.apptAna}/status`, { status: 'inventado' })).status, 400);
  const semMotivo = await patch(`/api/appointments/${ids.apptAna}/status`, { status: 'cancelada', cancel_reason: '  ' });
  assert.equal(semMotivo.status, 400);
  assert.match(semMotivo.data.error, /motivo/i);
  assert.equal((await patch(`/api/appointments/${ids.apptAna}/status`, { status: 'confirmada' })).data.status, 'confirmada');
  const c = await patch(`/api/appointments/${ids.apptAna}/status`, { status: 'cancelada', cancel_reason: 'Imprevisto' });
  assert.equal(c.data.status, 'cancelada');
  assert.equal(c.data.cancel_reason, 'Imprevisto');
});

test('RN07: cancelada libera o horário e permanece no histórico', async () => {
  const r = await post('/api/appointments', { client_id: ids.carla, procedure_ids: [procId('Lash lifting')], date: D1, start: '09:30' });
  assert.equal(r.status, 200, 'horário liberado');
  const hist = await get(`/api/clients/${ids.ana}`);
  assert.ok(hist.data.history.some((a) => a.id === ids.apptAna && a.status === 'cancelada'), 'RF26: segue no histórico');
  const back = await patch(`/api/appointments/${ids.apptAna}/status`, { status: 'agendada' });
  assert.equal(back.status, 409, 'não reativa por cima de outro atendimento');
  // "Cliente faltou" também libera
  await patch(`/api/appointments/${r.data.id}/status`, { status: 'faltou' });
  const again = await post('/api/appointments', { client_id: ids.bia, procedure_ids: [procId('Lash lifting')], date: D1, start: '09:30' });
  assert.equal(again.status, 200);
  ids.apptFree = again.data.id;
});

test('intervalo entre atendimentos (ajuste) é respeitado', async () => {
  await put('/api/settings', { gap_min: '15' });
  await post('/api/appointments', { client_id: ids.carla, procedure_ids: [procId('Design de sobrancelha')], date: D2, start: '09:00' });
  assert.equal((await post('/api/appointments', { client_id: ids.bia, procedure_ids: [procId('Design de sobrancelha')], date: D2, start: '09:30' })).status, 409);
  const ok = await post('/api/appointments', { client_id: ids.bia, procedure_ids: [procId('Design de sobrancelha')], date: D2, start: '09:45' });
  assert.equal(ok.status, 200);
  await put('/api/settings', { gap_min: '0' });
});

// ------------------------------------------------------------------ Bloqueios
test('RF19/RN03: bloqueio de dia inteiro impede agendamento', async () => {
  const b = await post('/api/blocks', { reason: 'Viagem', start_date: D3, end_date: D3, all_day: true });
  assert.equal(b.status, 200);
  ids.blockDay = b.data.id;
  const r = await post('/api/appointments', { client_id: ids.ana, procedure_ids: [procId('Lash lifting')], date: D3, start: '10:00' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /bloqueada/i);
  assert.equal(r.data.next_free.date, D4, 'sugere o próximo dia livre');
});

test('RF19: bloqueio de intervalo de horário', async () => {
  const b = await post('/api/blocks', { reason: 'Dentista', start_date: D4, end_date: D4, all_day: false, start_time: '12:00', end_time: '14:00' });
  assert.equal(b.status, 200);
  assert.equal((await post('/api/appointments', { client_id: ids.ana, procedure_ids: [procId('Lash lifting')], date: D4, start: '13:00' })).status, 409);
  assert.equal((await post('/api/appointments', { client_id: ids.ana, procedure_ids: [procId('Lash lifting')], date: D4, start: '11:30' })).status, 409, 'término invade o bloqueio');
  assert.equal((await post('/api/appointments', { client_id: ids.ana, procedure_ids: [procId('Lash lifting')], date: D4, start: '14:00' })).status, 200);
});

test('validações de bloqueio', async () => {
  assert.equal((await post('/api/blocks', { reason: '', start_date: D5 })).status, 400);
  assert.equal((await post('/api/blocks', { reason: 'X', start_date: D5, end_date: D4 })).status, 400, 'fim antes do início');
  assert.equal((await post('/api/blocks', { reason: 'X', start_date: D5, all_day: false, start_time: '14:00', end_time: '12:00' })).status, 400);
});

test('CSU07: bloquear período com atendimentos lista-os e pede confirmação', async () => {
  const r = await post('/api/blocks', { reason: 'Curso', start_date: D1, end_date: D2, all_day: true });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'appointments_in_block');
  assert.ok(r.data.appointments.length >= 3);
  assert.ok(r.data.appointments.every((a) => !['cancelada', 'faltou'].includes(a.status)), 'ignora cancelados');
  const ok = await post('/api/blocks', { reason: 'Curso', start_date: D1, end_date: D2, all_day: true, confirm: true });
  assert.equal(ok.status, 200);
  await del(`/api/blocks/${ok.data.id}`);
});

test('RF20: bloqueios aparecem no calendário, editam e removem', async () => {
  const cal = await get(`/api/appointments?from=${D3}&to=${D4}`);
  assert.equal(cal.data.blocks.length, 2);
  const e = await put(`/api/blocks/${ids.blockDay}`, { reason: 'Viagem a Minas', start_date: D3, end_date: D3, all_day: true });
  assert.equal(e.data.reason, 'Viagem a Minas');
  await del(`/api/blocks/${ids.blockDay}`);
  assert.equal((await post('/api/appointments', { client_id: ids.carla, procedure_ids: [procId('Lash lifting')], date: D3, start: '10:00' })).status, 200, 'horário volta a ficar livre');
  assert.equal((await get(`/api/blocks?from=2031-01-01`)).data.length, 1);
});

test('RF16/RF18: calendário por período e contagem anual (sem cancelados/faltas)', async () => {
  const day = await get(`/api/appointments?from=${D1}&to=${D1}`);
  assert.ok(day.data.appointments.every((a) => a.date === D1));
  assert.deepEqual(day.data.appointments.map((a) => a.start), [...day.data.appointments.map((a) => a.start)].sort(), 'ordenado por horário');
  const year = await get('/api/appointments/year/2031');
  assert.equal(year.data.months.length, 12);
  const active = (await get('/api/appointments?from=2031-03-01&to=2031-03-31')).data.appointments.filter((a) => !['cancelada', 'faltou'].includes(a.status));
  assert.equal(year.data.months[2].count, active.length);
  assert.equal(year.data.months[1].days, 28);
  assert.equal((await get('/api/appointments?from=x&to=y')).status, 400);
});

// ------------------------------------------------------------------ Financeiro
test('RN10/CSU09: valor > 0, data, categoria e tipo obrigatórios', async () => {
  const ok = { type: 'in', amount_cents: 1000, date: D1, category: 'Atendimento', method: 'Pix' };
  assert.equal((await post('/api/transactions', { ...ok, amount_cents: 0 })).status, 400);
  assert.equal((await post('/api/transactions', { ...ok, amount_cents: -5 })).status, 400);
  assert.equal((await post('/api/transactions', { ...ok, category: '' })).status, 400);
  assert.equal((await post('/api/transactions', { ...ok, date: '' })).status, 400);
  assert.equal((await post('/api/transactions', { ...ok, type: 'x' })).status, 400);
});

test('RF22/RN09: entrada a partir de atendimento concluído (sem duplicar)', async () => {
  await patch(`/api/appointments/${ids.apptFree}/status`, { status: 'concluida' });
  const a = await get(`/api/appointments/${ids.apptFree}`);
  const t = await post('/api/transactions', { type: 'in', amount_cents: a.data.total_cents, date: a.data.date, category: 'Atendimento', method: 'Pix', description: 'Lash lifting — Beatriz', client_id: ids.bia, appointment_id: a.data.id });
  assert.equal(t.status, 200);
  assert.equal(t.data.client_name, 'Beatriz Lopes');
  assert.equal((await get(`/api/appointments/${ids.apptFree}`)).data.transaction_id, t.data.id);
  const dup = await post('/api/transactions', { type: 'in', amount_cents: 100, date: D1, category: 'Atendimento', appointment_id: a.data.id });
  assert.equal(dup.status, 409);
  ids.txIn = t.data.id;
});

test('RF21/RF24/RN11: resumo mensal = entradas − saídas, só do mês', async () => {
  await post('/api/transactions', { type: 'out', amount: '320,50', date: '2031-03-03', category: 'Materiais', method: 'Cartão de crédito', description: 'Cola' });
  await post('/api/transactions', { type: 'out', amount_cents: 15000, date: '2031-03-01', category: 'Aluguel', method: 'Pix' });
  await post('/api/transactions', { type: 'in', amount_cents: 99999, date: '2031-04-01', category: 'Atendimento', method: 'Dinheiro' });
  await post('/api/transactions', { type: 'in', amount_cents: 99999, date: '2031-02-28', category: 'Atendimento', method: 'Dinheiro' });
  const r = await get('/api/transactions?month=2031-03');
  assert.equal(r.data.summary.income_cents, 18000);
  assert.equal(r.data.summary.expense_cents, 47050);
  assert.equal(r.data.summary.balance_cents, 18000 - 47050);
  assert.equal(r.data.items.length, 3);
  assert.equal((await get('/api/transactions?month=31-3')).status, 400);
});

test('RF25: filtros por tipo, categoria e forma de pagamento', async () => {
  assert.equal((await get('/api/transactions?month=2031-03&type=out')).data.items.length, 2);
  assert.equal((await get('/api/transactions?month=2031-03&type=in')).data.items.length, 1);
  assert.equal((await get('/api/transactions?month=2031-03&category=Aluguel')).data.items.length, 1);
  assert.equal((await get('/api/transactions?month=2031-03&method=Pix')).data.items.length, 2);
  const f = await get('/api/transactions?month=2031-03&type=out&method=Pix');
  assert.equal(f.data.items.length, 1);
  assert.equal(f.data.summary.balance_cents, 18000 - 47050, 'resumo do mês não muda com filtro');
});

test('RF23: editar e excluir movimentação', async () => {
  const e = await put(`/api/transactions/${ids.txIn}`, { type: 'in', amount_cents: 20000, date: D1, category: 'Atendimento', method: 'Dinheiro' });
  assert.equal(e.data.amount_cents, 20000);
  assert.equal(e.data.appointment_id, ids.apptFree, 'mantém o vínculo com o atendimento');
  const t = await post('/api/transactions', { type: 'out', amount_cents: 500, date: D1, category: 'Outras saídas' });
  assert.equal((await del(`/api/transactions/${t.data.id}`)).status, 200);
  assert.equal((await del(`/api/transactions/${t.data.id}`)).status, 404);
});

test('RF27: exporta planilha CSV do mês (Excel pt-BR)', async () => {
  const r = await get('/api/transactions/export?month=2031-03');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /financeiro-2031-03\.csv/);
  const bytes = new Uint8Array(await (await fetch(BASE + '/api/transactions/export?month=2031-03', { headers: { Cookie: cookie } })).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM para acentos no Excel');
  assert.match(r.text, /"Data";"Tipo";"Categoria"/);
  assert.match(r.text, /"Saldo";-270,50/);
  assert.match(r.text, /03\/03\/2031/);
});

// ------------------------------------------------------------------ Integridade
test('RN14: cliente com histórico não pode ser excluída, só inativada', async () => {
  const r = await del(`/api/clients/${ids.ana}`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /inativada/);
  const nova = await post('/api/clients', { name: 'Sem Histórico', phone: '(11) 90000-1111' });
  assert.equal((await get(`/api/clients/${nova.data.id}`)).data.can_delete, true);
  assert.equal((await del(`/api/clients/${nova.data.id}`)).status, 200);
  assert.equal((await get(`/api/clients/${nova.data.id}`)).status, 404);
});

test('RF13: excluir agendamento preserva a movimentação financeira', async () => {
  assert.equal((await del(`/api/appointments/${ids.apptFree}`)).status, 200);
  const r = await get('/api/transactions?month=2031-03&type=in');
  assert.equal(r.data.items.length, 1);
  assert.equal(r.data.items[0].appointment_id, null);
});

test('RF26: ficha da cliente traz histórico e total pago', async () => {
  const c = await get(`/api/clients/${ids.bia}`);
  assert.ok(c.data.history.length >= 2);
  assert.equal(c.data.spent_cents, 20000);
});

// ------------------------------------------------------------------ WhatsApp
test('WhatsApp: começa desconectado e não envia sem conexão', async () => {
  const r = await get('/api/whatsapp');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'disconnected');
  assert.match(r.data.target_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(r.data.appointments));
  assert.equal((await post('/api/whatsapp/send', {})).status, 409);
  assert.equal((await get('/api/whatsapp', { auth: false })).status, 401, 'exige login');
  assert.equal((await post('/api/whatsapp/connect', { phone: '123' })).status, 400, 'número inválido');
});

test('WhatsApp: ajustes do robô validados', async () => {
  assert.equal((await put('/api/settings', { wa_time: '99:00' })).status, 400);
  assert.equal((await put('/api/settings', { wa_mode: 'sempre' })).status, 400);
  const r = await put('/api/settings', { wa_auto: true, wa_mode: 'day_before', wa_time: '18:00' });
  assert.equal(r.data.wa_auto, '1');
  assert.equal(r.data.wa_mode, 'day_before');
  assert.match(r.data.wa_footer, /\*1\*/);
  await put('/api/settings', { wa_auto: '0', wa_mode: 'same_day', wa_time: '08:00' });
  const a = (await get(`/api/appointments?from=${D1}&to=${D1}`)).data.appointments[0];
  assert.equal(a.wa, null, 'atendimento sem envio');
});

// ------------------------------------------------------------------ Estoque (RF28)
test('RF28: estoque com entrada, saída e quantidade mínima', async () => {
  const it = await post('/api/stock', { name: 'Cola para cílios', unit: 'frasco', quantity: '1', min_quantity: '2' });
  assert.equal(it.status, 200);
  assert.equal((await post(`/api/stock/${it.data.id}/move`, { type: 'in', quantity: '3' })).data.quantity, 4);
  assert.equal((await post(`/api/stock/${it.data.id}/move`, { type: 'out', quantity: '2,5' })).data.quantity, 1.5);
  assert.equal((await post(`/api/stock/${it.data.id}/move`, { type: 'out', quantity: 10 })).status, 400, 'estoque insuficiente');
  assert.equal((await post(`/api/stock/${it.data.id}/move`, { type: 'in', quantity: 0 })).status, 400);
  assert.equal((await get(`/api/stock/${it.data.id}/moves`)).data.length, 2);
  assert.equal((await get('/api/dashboard')).data.low_stock, 1);
  assert.equal((await post('/api/stock', { name: '' })).status, 400);
});

// ------------------------------------------------------------------ Backup (RNF07)
test('RNF07: backup diário gravado e download completo sem senhas', async () => {
  const files = fs.readdirSync(path.join(DATA, 'backups'));
  assert.ok(files.some((f) => /^agenda-expert-\d{4}-\d{2}-\d{2}\.db$/.test(f)));
  const r = await get('/api/backup');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /agenda-expert-backup/);
  assert.ok(r.data.tables.clients.length >= 3);
  assert.ok(r.data.tables.appointments.length > 0);
  assert.equal(r.data.tables.users, undefined, 'não exporta usuários/senhas');
  assert.ok(!r.text.includes('scrypt$'));
});

// ------------------------------------------------------------------ Segurança e PWA
test('cabeçalhos de segurança', async () => {
  const r = await get('/', { auth: false });
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('bloqueia requisições de escrita vindas de outro site (CSRF)', async () => {
  const r = await post('/api/clients', { name: 'Hacker', phone: '(11) 91111-1111' }, { headers: { Origin: 'https://site-malicioso.com' } });
  assert.equal(r.status, 403);
});

test('não expõe arquivos fora da pasta pública', async () => {
  for (const p of ['/%2e%2e/server/db.js', '/..%2f..%2fpackage.json', '/%2e%2e/.env']) {
    const r = await rawGet(p);
    assert.ok(!r.body.includes('DatabaseSync') && !r.body.includes('ADMIN_PASSWORD') && !r.body.includes('"scripts"'), p);
  }
});

test('JSON inválido e rotas inexistentes', async () => {
  const r = await fetch(BASE + '/api/clients', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{quebrado' });
  assert.equal(r.status, 400);
  assert.equal((await get('/api/nao-existe')).status, 404);
  assert.equal((await get('/api/clients/999999')).status, 404);
});

test('XSS: dados são guardados como texto (a interface escapa ao exibir)', async () => {
  const r = await post('/api/clients', { name: '<img src=x onerror=alert(1)>', phone: '(11) 92222-3333' });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, '<img src=x onerror=alert(1)>');
  await del(`/api/clients/${r.data.id}`);
});

test('RNF01: PWA — manifesto, ícones e service worker versionado', async () => {
  const m = await get('/manifest.webmanifest', { auth: false });
  assert.equal(m.data.display, 'standalone');
  assert.equal(m.data.lang, 'pt-BR');
  for (const icon of m.data.icons) assert.equal((await fetch(BASE + icon.src)).status, 200, icon.src);
  assert.equal((await fetch(BASE + '/icons/apple-touch-icon.png')).status, 200);
  const sw = await get('/sw.js', { auth: false });
  assert.match(sw.text, /const VERSION = 'ae-[0-9a-f]{10}'/);
  const html = await get('/clientes/qualquer', { auth: false });
  assert.match(html.text, /<html lang="pt-BR">/, 'rotas do app devolvem o index');
});

// ------------------------------------------------------------------ Conta e sessão
test('acesso não pode ser alterado pelo app (somente pelas variáveis de ambiente)', async () => {
  const r = await put('/api/account', { current_password: PASS, new_password: 'OutraSenha999' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'account_managed');
  assert.equal((await get('/api/me')).status, 200, 'sessão continua válida');
});

test('sair encerra a sessão', async () => {
  assert.equal((await get('/api/me')).status, 200);
  const old = cookie;
  await post('/api/logout');
  const r = await fetch(BASE + '/api/me', { headers: { Cookie: old } });
  assert.equal(r.status, 401);
});

test('limita tentativas de login (força bruta)', async () => {
  const h = { headers: { 'X-Forwarded-For': '198.51.100.7' }, auth: false };
  for (let i = 0; i < 10; i++) assert.equal((await post('/api/login', { email: EMAIL, password: 'x' + i }, h)).status, 401);
  const blocked = await post('/api/login', { email: EMAIL, password: PASS }, h);
  assert.equal(blocked.status, 429);
  const other = await post('/api/login', { email: EMAIL, password: PASS }, { headers: { 'X-Forwarded-For': '198.51.100.8' }, auth: false });
  assert.equal(other.status, 200, 'outros IPs não são afetados');
});

// ------------------------------------------------------------------ Desempenho (RNF04/RNF10)
test('RNF10: 5.000 clientes e 10 anos de atendimentos sem lentidão', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(DATA, 'agenda-expert.db'));
  const t = new Date().toISOString();
  db.exec('BEGIN');
  const ic = db.prepare('INSERT INTO clients (name, phone, phone_digits, created_at, updated_at) VALUES (?,?,?,?,?)');
  const ia = db.prepare("INSERT INTO appointments (client_id, date, start_at, end_at, status, total_cents, duration_min, created_at, updated_at) VALUES (?,?,?,?,'concluida',5000,30,?,?)");
  const ip = db.prepare("INSERT INTO appointment_procedures (appointment_id, procedure_id, name, price_cents, duration_min) VALUES (?,2,'Design de sobrancelha',5000,30)");
  const first = Number(ic.run('Cliente 0', '(11) 90000-0000', '11900000000', t, t).lastInsertRowid);
  for (let i = 1; i < 5000; i++) ic.run(`Cliente ${i}`, `(11) 9${String(i).padStart(4, '0')}-0000`, `119${String(i).padStart(4, '0')}0000`, t, t);
  // ~8 atendimentos por dia útil durante 10 anos ≈ 25 mil
  const start = Date.UTC(2015, 0, 1);
  for (let d = 0; d < 3650; d++) {
    const date = new Date(start + d * 864e5).toISOString().slice(0, 10);
    for (let k = 0; k < 7; k++) {
      const h = String(8 + k).padStart(2, '0');
      const id = ia.run(first + ((d * 7 + k) % 5000), date, `${date}T${h}:00:00-03:00`, `${date}T${h}:30:00-03:00`, t, t).lastInsertRowid;
      ip.run(id);
    }
  }
  db.exec('COMMIT');
  db.close();
  await post('/api/login', { email: EMAIL, password: PASS }, { headers: { 'X-Forwarded-For': '10.9.9.9' } });
  const timed = async (p) => { const t0 = performance.now(); const r = await get(p); assert.equal(r.status, 200, p); return performance.now() - t0; };
  const times = {
    busca: await timed('/api/clients?q=Cliente 4999'),
    lista: await timed('/api/clients'),
    mes: await timed('/api/appointments?from=2024-02-25&to=2024-04-06'),
    ano: await timed('/api/appointments/year/2024'),
    ficha: await timed(`/api/clients/${first}`),
  };
  for (const [k, ms] of Object.entries(times)) assert.ok(ms < 1500, `${k} demorou ${ms.toFixed(0)} ms`);
  console.log('   tempos com 5.000 clientes / ~25 mil atendimentos (ms):', Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v)])));
});

// ------------------------------------------------------------------ Acesso pelas variáveis de ambiente
test('mudar ADMIN_EMAIL/ADMIN_PASSWORD e reiniciar troca o acesso e encerra sessões', async () => {
  const oldCookie = cookie;
  await stopServer(server);
  server = await startServer({ ADMIN_EMAIL: 'nova@agenda.test', ADMIN_PASSWORD: 'SenhaNova2027' });
  assert.equal((await fetch(BASE + '/api/me', { headers: { Cookie: oldCookie } })).status, 401, 'sessão antiga encerrada');
  assert.equal((await post('/api/login', { email: EMAIL, password: PASS }, { headers: { 'X-Forwarded-For': '10.1.1.1' } })).status, 401, 'acesso antigo não vale mais');
  assert.equal((await post('/api/login', { email: 'nova@agenda.test', password: 'SenhaNova2027' }, { headers: { 'X-Forwarded-For': '10.1.1.1' } })).status, 200);
  assert.ok((await get('/api/clients')).data.length >= 3, 'dados preservados');
  // reiniciar com as mesmas variáveis não derruba a sessão
  await stopServer(server);
  server = await startServer({ ADMIN_EMAIL: 'nova@agenda.test', ADMIN_PASSWORD: 'SenhaNova2027' });
  assert.equal((await get('/api/me')).status, 200, 'sessão mantida quando nada mudou');
});

test('em produção, o servidor não sobe sem e-mail e senha válidos', async () => {
  await stopServer(server);
  for (const env of [{ ADMIN_PASSWORD: '' }, { ADMIN_PASSWORD: 'curta' }, { ADMIN_PASSWORD: 'coloque-a-senha-aqui' }, { ADMIN_EMAIL: 'invalido' }]) {
    const err = await startServer({ NODE_ENV: 'production', ...env }).then((p) => { p.kill(); return null; }, (e) => e);
    assert.ok(err, JSON.stringify(env));
    assert.equal(err.code, 1, JSON.stringify(env));
  }
  server = await startServer({ ADMIN_EMAIL: 'nova@agenda.test', ADMIN_PASSWORD: 'SenhaNova2027' });
});
