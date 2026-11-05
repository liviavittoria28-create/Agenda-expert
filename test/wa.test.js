// Testes do robô de confirmação do WhatsApp (sem conexão real: usa um WhatsApp simulado)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-wa-'));
process.env.WA_NO_DELAY = '1';
const L = await import('../server/wa-logic.js');
const { db, seed, nowIso, getSettings } = await import('../server/db.js');
const W = await import('../server/whatsapp.js');
const { todayBR, addDays } = await import('../server/time.js');

// ------------------------------------------------------------------ Funções puras
test('entende as respostas da cliente', () => {
  for (const t of ['1', ' 1 ', 'Confirmo meu horário', 'confirmo', 'Sim!', 'ok', 'Confirmado 👍', 'pode confirmar', 'vou sim', 'Estarei aí', 'SIM, CONFIRMO']) assert.equal(L.parseReply(t), 'confirm', t);
  for (const t of ['2', 'Preciso remarcar', 'quero reagendar', 'Não vou poder', 'não posso', 'nao consigo ir', 'cancelar', 'sim, mas preciso remarcar', 'não confirmo', 'tem outro horário?']) assert.equal(L.parseReply(t), 'reschedule', t);
  for (const t of ['', 'Oi', 'Qual o endereço?', 'Bom dia, tudo bem?', '🤍', 'dia 12 às 14h']) assert.equal(L.parseReply(t), null, t);
});

test('números de telefone: DDI e o "9" extra do celular', () => {
  assert.equal(L.fullNumber('(11) 99999-0000'), '5511999990000');
  assert.equal(L.fullNumber('+55 11 99999-0000'), '5511999990000');
  assert.equal(L.phoneKey('(11) 99999-0000'), L.phoneKey('551199990000'), 'com e sem o 9 são a mesma cliente');
  assert.notEqual(L.phoneKey('(11) 99999-0000'), L.phoneKey('(21) 99999-0000'), 'DDD diferente');
  assert.equal(L.jidNumber('5511999990000@s.whatsapp.net'), '5511999990000');
  assert.equal(L.jidNumber('5511999990000:12@s.whatsapp.net'), '5511999990000');
  assert.equal(L.jidNumber('123456@lid'), null);
});

test('mensagem completa = modelo preenchido + instruções de resposta', () => {
  const a = { client_name: 'Ana Paula', date: '2026-11-05', start: '11:00', end: '13:00', total_cents: 17000, procedures: [{ name: 'Extensão de cílios' }] };
  const msg = L.confirmationMessage({ whatsapp_template: 'Oi [nome], dia [data] às [horário].', wa_footer: '*1* confirmo\n*2* remarcar' }, a);
  assert.equal(msg, 'Oi Ana, dia 05/11/2026 (quinta-feira) às 11:00.\n\n*1* confirmo\n*2* remarcar');
  assert.equal(L.confirmationMessage({ whatsapp_template: 'Oi [nome]', wa_footer: '' }, a), 'Oi Ana');
});

test('quando enviar: horário, "no dia" x "na véspera", status e atendimentos recentes', () => {
  const today = '2026-11-05';
  const old = '2026-11-01T10:00:00Z';
  const appts = [
    { id: 1, date: today, start: '15:00', status: 'agendada', created_at: old },
    { id: 2, date: today, start: '09:00', status: 'agendada', created_at: old }, // já passou às 10h
    { id: 3, date: today, start: '16:00', status: 'confirmada', created_at: old },
    { id: 4, date: today, start: '17:00', status: 'agendada', created_at: old }, // já enviado
    { id: 5, date: today, start: '18:00', status: 'agendada', created_at: '2026-11-05T12:30:00Z' }, // marcado agora
    { id: 6, date: '2026-11-06', start: '10:00', status: 'agendada', created_at: old },
  ];
  const base = { today, nowMin: 600, nowIso: '2026-11-05T13:00:00Z', appointments: appts, sentIds: new Set([4]) };
  const on = { wa_auto: '1', wa_mode: 'same_day', wa_time: '08:00' };
  assert.deepEqual(L.dueAppointments({ ...base, settings: on }).map((a) => a.id), [1]);
  assert.deepEqual(L.dueAppointments({ ...base, settings: { ...on, wa_auto: '0' } }), [], 'desligado');
  assert.deepEqual(L.dueAppointments({ ...base, settings: { ...on, wa_time: '11:00' } }), [], 'antes do horário');
  assert.deepEqual(L.dueAppointments({ ...base, settings: { ...on, wa_mode: 'day_before' } }).map((a) => a.id), [6], 'véspera');
  assert.equal(L.targetDate({ wa_mode: 'day_before' }, '2026-12-31'), '2027-01-01');
});

// ------------------------------------------------------------------ Envio e chatbot (WhatsApp simulado)
const sent = [];
const fakeSock = {
  onWhatsApp: async (n) => [{ exists: !n.endsWith('0001'), jid: `${n.slice(0, 4)}${n.slice(5)}@s.whatsapp.net` }], // WhatsApp sem o 9
  presenceSubscribe: async () => {},
  sendPresenceUpdate: async () => {},
  sendMessage: async (jid, m) => { sent.push({ jid, text: m.text }); return { key: { remoteJid: jid } }; },
};
let ids = {};
const today = todayBR();
const tomorrow = addDays(today, 1);

after(() => {
  try { db.close(); } catch {}
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

before(() => {
  seed();
  const t = nowIso();
  const old = new Date(Date.now() - 864e5).toISOString();
  const client = (n, p) => Number(db.prepare('INSERT INTO clients (name, phone, phone_digits, created_at, updated_at) VALUES (?,?,?,?,?)').run(n, p, p.replace(/\D/g, ''), t, t).lastInsertRowid);
  const appt = (cid, date, start, status = 'agendada') => {
    const id = Number(db.prepare(`INSERT INTO appointments (client_id, date, start_at, end_at, status, total_cents, duration_min, created_at, updated_at) VALUES (?,?,?,?,?,18000,60,?,?)`)
      .run(cid, date, `${date}T${start}:00-03:00`, `${date}T${start}:00-03:00`, status, old, old).lastInsertRowid);
    db.prepare("INSERT INTO appointment_procedures (appointment_id, procedure_id, name, price_cents, duration_min) VALUES (?,7,'Lash lifting',18000,60)").run(id);
    return id;
  };
  ids.ana = client('Ana Paula Souza', '(11) 99999-0000');
  ids.bia = client('Beatriz Lopes', '(11) 95555-4444');
  ids.semZap = client('Sem WhatsApp', '(11) 90000-0001');
  ids.a1 = appt(ids.ana, tomorrow, '10:00');
  ids.a2 = appt(ids.bia, tomorrow, '14:00');
  ids.a3 = appt(ids.semZap, tomorrow, '16:00');
  ids.a4 = appt(ids.bia, tomorrow, '18:00', 'cancelada');
  W._test.setSock(fakeSock);
  W._test.st.status = 'connected';
});

test('envia a confirmação com a mensagem da Esther e registra', async () => {
  await W.sendConfirmation(ids.a1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, '551199990000@s.whatsapp.net');
  assert.match(sent[0].text, /^Olá! Tudo bem\? 🤍/);
  assert.match(sent[0].text, /agendado para o dia \d{2}\/\d{2}\/\d{4} \(.+\), às 10:00/);
  assert.match(sent[0].text, /Rua Aiapaina, 3A/);
  assert.match(sent[0].text, /\*1\* – Confirmo meu horário/);
  const row = db.prepare('SELECT * FROM wa_messages WHERE appointment_id = ?').get(ids.a1);
  assert.equal(row.status, 'sent');
});

test('número sem WhatsApp fica registrado como falha', async () => {
  await assert.rejects(W.sendConfirmation(ids.a3), /não tem WhatsApp/);
  assert.equal(db.prepare('SELECT status FROM wa_messages WHERE appointment_id = ?').get(ids.a3).status, 'failed');
});

test('não envia para atendimento cancelado', async () => {
  await assert.rejects(W.sendConfirmation(ids.a4), /não precisa/);
});

test('cliente responde "1": atendimento vira Confirmada e o robô agradece', async () => {
  sent.length = 0;
  await W._test.handleIncoming({ key: { remoteJid: '551199990000@s.whatsapp.net' }, message: { conversation: '1' } });
  assert.equal(db.prepare('SELECT status FROM appointments WHERE id = ?').get(ids.a1).status, 'confirmada');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Perfeito, Ana! Seu horário de .+ às 10:00 está confirmado/);
  const w = db.prepare('SELECT reply, reply_text FROM wa_messages WHERE appointment_id = ?').get(ids.a1);
  assert.deepEqual({ ...w }, { reply: 'confirm', reply_text: '1' });
});

test('depois de respondida, o robô fica em silêncio (a conversa é da Esther)', async () => {
  sent.length = 0;
  await W._test.handleIncoming({ key: { remoteJid: '551199990000@s.whatsapp.net' }, message: { conversation: 'sim, obrigada!' } });
  assert.equal(sent.length, 0);
});

test('resposta pelo identificador novo do WhatsApp (LID) com o número alternativo', async () => {
  await W.sendConfirmation(ids.a2);
  sent.length = 0;
  await W._test.handleIncoming({ key: { remoteJid: '98765432@lid', remoteJidAlt: '5511955554444@s.whatsapp.net' }, message: { extendedTextMessage: { text: 'Preciso remarcar 😕' } } });
  assert.equal(db.prepare('SELECT status FROM appointments WHERE id = ?').get(ids.a2).status, 'agendada', 'não muda sozinho');
  assert.equal(db.prepare('SELECT reply FROM wa_messages WHERE appointment_id = ?').get(ids.a2).reply, 'reschedule');
  assert.equal(sent[0].jid, '98765432@lid', 'responde na mesma conversa');
  assert.match(sent[0].text, /Sem problemas, Beatriz!/);
});

test('ignora grupos, mensagens próprias, desconhecidos e textos que não entende', async () => {
  sent.length = 0;
  await W._test.handleIncoming({ key: { remoteJid: '123@g.us', participant: '5511999990000@s.whatsapp.net' }, message: { conversation: '1' } });
  await W._test.handleIncoming({ key: { remoteJid: '5511999990000@s.whatsapp.net', fromMe: true }, message: { conversation: '1' } });
  await W._test.handleIncoming({ key: { remoteJid: '5521988887777@s.whatsapp.net' }, message: { conversation: '1' } });
  await W._test.handleIncoming({ key: { remoteJid: '5511955554444@s.whatsapp.net' }, message: { conversation: 'Qual o endereço?' } });
  assert.equal(sent.length, 0);
});

test('envio automático: respeita liga/desliga e não envia duas vezes', async () => {
  const set = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  const cid = db.prepare('SELECT id FROM clients WHERE name = ?').get('Ana Paula Souza').id;
  const old = new Date(Date.now() - 864e5).toISOString();
  const id = Number(db.prepare(`INSERT INTO appointments (client_id, date, start_at, end_at, status, total_cents, duration_min, created_at, updated_at) VALUES (?,?,?,?,'agendada',5000,30,?,?)`)
    .run(cid, tomorrow, `${tomorrow}T19:00:00-03:00`, `${tomorrow}T19:30:00-03:00`, old, old).lastInsertRowid);
  set('wa_mode', 'day_before');
  set('wa_time', '00:00');
  sent.length = 0;
  set('wa_auto', '0');
  await W.runScheduler();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 0, 'desligado não envia');
  set('wa_auto', '1');
  await W.runScheduler();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, 1, 'só o novo atendimento (os outros já foram enviados ou falharam)');
  assert.match(sent[0].text, /às 19:00/);
  await W.runScheduler();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, 1, 'não reenvia');
  assert.equal(getSettings().wa_auto, '1');
  assert.ok(id);
});
