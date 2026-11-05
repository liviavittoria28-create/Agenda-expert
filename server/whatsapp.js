// Conexão com o WhatsApp (via QR code, como o WhatsApp Web) e robô de confirmação.
// Usa a biblioteca Baileys (não oficial). Gratuito, mas o WhatsApp pode restringir
// números que enviam mensagens em massa — por isso há pausas e limites.
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { db, DATA_DIR, getSettings, nowIso } from './db.js';
import { todayBR, toMin, stampTime } from './time.js';
import { fullNumber, phoneKey, jidNumber, parseReply, fillTemplate, confirmationMessage, dueAppointments, targetDate, humanDelay } from './wa-logic.js';

const AUTH_DIR = path.join(DATA_DIR, 'whatsapp-auth');
const MAX_PER_RUN = 40;

const st = { status: 'disconnected', qr: null, pairing: null, me: null, error: null, sending: false };
let sock = null;
let wantConnected = false;
let retry = 0;

// logger silencioso exigido pela biblioteca
const noop = () => {};
const logger = { level: 'silent', child: () => logger, trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };

export const waState = () => ({ status: st.status, qr: st.qr, pairing: st.pairing, me: st.me, error: st.error, sending: st.sending });
const hasSession = () => fs.existsSync(path.join(AUTH_DIR, 'creds.json'));

// ---------------------------------------------------------------- Conexão
/**
 * Conecta. Sem telefone: gera QR code (escanear de outro aparelho).
 * Com telefone: gera um código de 8 caracteres para digitar no próprio celular
 * (WhatsApp → Aparelhos conectados → Conectar com número de telefone).
 */
export async function connect({ phone } = {}) {
  if (phone && sock && st.status === 'qr' && !sock.authState?.creds?.registered) {
    st.pairing = formatCode(await sock.requestPairingCode(fullNumber(phone)));
    return waState();
  }
  if (sock && ['connecting', 'qr', 'connected'].includes(st.status)) return waState();
  st.pairing = null;
  wantConnected = true;
  st.status = 'connecting';
  st.error = null;
  const B = await import('@whiskeysockets/baileys');
  const makeWASocket = B.default?.default || B.default || B.makeWASocket;
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state: auth, saveCreds } = await B.useMultiFileAuthState(AUTH_DIR);
  let version;
  try { ({ version } = await B.fetchLatestBaileysVersion()); } catch {}
  sock = makeWASocket({
    auth, version, logger,
    browser: B.Browsers.macOS('Agenda Expert'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
  });
  const current = sock;
  sock.ev.on('creds.update', saveCreds);
  if (phone && !auth.creds.registered) {
    await new Promise((r) => setTimeout(r, 2500)); // a conexão precisa estar aberta antes de pedir o código
    st.pairing = formatCode(await sock.requestPairingCode(fullNumber(phone)));
    st.status = 'qr';
  }
  sock.ev.on('connection.update', async (u) => {
    if (current !== sock) return;
    if (u.qr) {
      st.status = 'qr';
      st.qr = await QRCode.toString(u.qr, { type: 'svg', margin: 1, color: { dark: '#2a221c', light: '#ffffff' } });
    }
    if (u.connection === 'open') {
      retry = 0;
      st.status = 'connected';
      st.qr = null;
      st.pairing = null;
      st.error = null;
      const id = sock.user?.id || '';
      st.me = { number: jidNumber(id.replace(/:\d+@/, '@')) || id.split(/[:@]/)[0], name: sock.user?.name || sock.user?.verifiedName || '' };
      console.log(`✓ WhatsApp conectado (${st.me.number})`);
      setTimeout(runScheduler, 5000);
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const wasQr = st.status === 'qr';
      sock = null;
      if (code === B.DisconnectReason.loggedOut || code === B.DisconnectReason.forbidden) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        Object.assign(st, { status: 'disconnected', qr: null, pairing: null, me: null, error: 'O WhatsApp foi desconectado pelo celular. Conecte de novo.' });
        wantConnected = false;
        return;
      }
      if (wasQr && code === B.DisconnectReason.timedOut) {
        Object.assign(st, { status: 'disconnected', qr: null, pairing: null, error: 'O código expirou. Toque em “Conectar” para gerar outro.' });
        wantConnected = false;
        return;
      }
      if (!wantConnected) { Object.assign(st, { status: 'disconnected', qr: null }); return; }
      st.status = 'connecting';
      const wait = Math.min(60000, 2000 * 2 ** retry++);
      setTimeout(() => connect().catch(onError), wait);
    }
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) handleIncoming(m).catch((e) => console.error('WhatsApp (resposta):', e.message));
  });
  return waState();
}

const formatCode = (c) => String(c || '').replace(/(.{4})(?=.)/, '$1-');

function onError(e) {
  console.error('WhatsApp:', e.message);
  Object.assign(st, { status: 'disconnected', qr: null, error: 'Não foi possível conectar. Tente de novo em instantes.' });
}

export async function logout() {
  wantConnected = false;
  try { await sock?.logout(); } catch {}
  try { sock?.end?.(); } catch {}
  sock = null;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  Object.assign(st, { status: 'disconnected', qr: null, pairing: null, me: null, error: null });
  return waState();
}

/** Reconecta sozinho ao ligar o servidor, se já havia um WhatsApp conectado */
export function autoStart() {
  if (hasSession()) connect().catch(onError);
  setInterval(() => runScheduler().catch((e) => console.error('WhatsApp (agenda):', e.message)), 60_000).unref();
}

// ---------------------------------------------------------------- Dados
export function appointmentsOn(date) {
  const rows = db
    .prepare(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone, w.status AS wa_status, w.reply AS wa_reply, w.sent_at AS wa_sent_at, w.error AS wa_error
       FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN wa_messages w ON w.appointment_id = a.id
       WHERE a.date = ? ORDER BY a.start_at`
    )
    .all(date);
  const procs = db.prepare('SELECT name FROM appointment_procedures WHERE appointment_id = ? ORDER BY id');
  return rows.map((r) => ({
    id: r.id, client_id: r.client_id, client_name: r.client_name, client_phone: r.client_phone, date: r.date,
    start: stampTime(r.start_at), end: stampTime(r.end_at), status: r.status, total_cents: r.total_cents, created_at: r.created_at,
    procedures: procs.all(r.id),
    wa: r.wa_status ? { status: r.wa_status, reply: r.wa_reply, sent_at: r.wa_sent_at, error: r.wa_error } : null,
  }));
}

// ---------------------------------------------------------------- Envio
// WA_NO_DELAY=1 tira as pausas (usado nos testes automáticos)
const sleep = (ms) => new Promise((r) => setTimeout(r, process.env.WA_NO_DELAY ? 0 : ms));

async function sendText(phone, text) {
  if (!sock || st.status !== 'connected') throw new Error('WhatsApp não está conectado.');
  const number = fullNumber(phone);
  const found = (await sock.onWhatsApp(number))?.[0];
  if (!found?.exists) throw new Error('Este número não tem WhatsApp.');
  try {
    await sock.presenceSubscribe(found.jid);
    await sock.sendPresenceUpdate('composing', found.jid);
    await sleep(1200 + Math.random() * 1500);
    await sock.sendPresenceUpdate('paused', found.jid);
  } catch {}
  const sent = await sock.sendMessage(found.jid, { text });
  return sent?.key?.remoteJid || found.jid;
}

function record(a, fields) {
  db.prepare(
    `INSERT INTO wa_messages (appointment_id, phone, jid, status, error, sent_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(appointment_id) DO UPDATE SET phone = excluded.phone, jid = excluded.jid, status = excluded.status,
       error = excluded.error, sent_at = excluded.sent_at, reply = NULL, reply_text = NULL, replied_at = NULL`
  ).run(a.id, fullNumber(a.client_phone), fields.jid || null, fields.status, fields.error || null, nowIso());
}

/** Envia a confirmação de um atendimento agora */
export async function sendConfirmation(appointmentId) {
  const a = db.prepare('SELECT date FROM appointments WHERE id = ?').get(appointmentId);
  if (!a) throw new Error('Atendimento não encontrado.');
  const appt = appointmentsOn(a.date).find((x) => x.id === appointmentId);
  if (['cancelada', 'faltou', 'concluida'].includes(appt.status)) throw new Error('Este atendimento não precisa de confirmação.');
  try {
    const jid = await sendText(appt.client_phone, confirmationMessage(getSettings(), appt));
    record(appt, { status: 'sent', jid });
    return { ok: true };
  } catch (e) {
    record(appt, { status: 'failed', error: e.message });
    throw e;
  }
}

/** Envia, com pausas, todas as confirmações pendentes (automático ou "Enviar todas") */
export async function sendBatch(list) {
  if (st.sending) return { queued: 0 };
  st.sending = true;
  let sent = 0;
  (async () => {
    try {
      for (const a of list.slice(0, MAX_PER_RUN)) {
        if (st.status !== 'connected') break;
        try { await sendConfirmation(a.id); sent++; } catch {}
        await sleep(humanDelay());
      }
    } finally {
      st.sending = false;
      if (sent) console.log(`✓ WhatsApp: ${sent} confirmação(ões) enviada(s)`);
    }
  })();
  return { queued: Math.min(list.length, MAX_PER_RUN) };
}

/** Pendentes da data-alvo, sem considerar horário (para o botão "Enviar todas") */
export function pendingFor(date) {
  return appointmentsOn(date).filter((a) => a.status === 'agendada' && (!a.wa || a.wa.status === 'failed'));
}

export async function runScheduler() {
  if (st.status !== 'connected' || st.sending) return;
  const settings = getSettings();
  const today = todayBR();
  const date = targetDate(settings, today);
  const appointments = appointmentsOn(date);
  const sentIds = new Set(appointments.filter((a) => a.wa).map((a) => a.id)); // não reenvia nem quem falhou
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const due = dueAppointments({ settings, today, nowMin: toMin(now), nowIso: nowIso(), appointments, sentIds });
  if (due.length) await sendBatch(due);
}

// ---------------------------------------------------------------- Respostas (mini chatbot)
function messageText(m) {
  const msg = m.message?.ephemeralMessage?.message || m.message?.viewOnceMessage?.message || m.message || {};
  return msg.conversation || msg.extendedTextMessage?.text || msg.buttonsResponseMessage?.selectedDisplayText || msg.listResponseMessage?.title || '';
}

async function handleIncoming(m) {
  if (m.key?.fromMe) return;
  const jids = [m.key?.remoteJid, m.key?.remoteJidAlt, m.key?.senderPn].filter(Boolean);
  if (!jids.length || jids.some((j) => j.endsWith('@g.us') || j === 'status@broadcast')) return;
  const text = messageText(m);
  const intent = parseReply(text);
  if (!intent) return; // não entendeu: fica em silêncio para a Esther responder

  // procura a confirmação pendente desta cliente (enviada, sem resposta, atendimento futuro)
  const keys = new Set(jids.map(jidNumber).filter(Boolean).map(phoneKey));
  const pending = db
    .prepare(
      `SELECT w.*, a.status AS appt_status, a.date FROM wa_messages w JOIN appointments a ON a.id = w.appointment_id
       WHERE w.status = 'sent' AND w.reply IS NULL AND a.date >= ? AND a.status IN ('agendada','confirmada')
       ORDER BY a.start_at`
    )
    .all(todayBR())
    .find((w) => jids.includes(w.jid) || keys.has(phoneKey(w.phone)));
  if (!pending) return;

  const appt = appointmentsOn(pending.date).find((a) => a.id === pending.appointment_id);
  const settings = getSettings();
  db.prepare('UPDATE wa_messages SET reply = ?, reply_text = ?, replied_at = ? WHERE id = ?').run(intent, String(text).slice(0, 500), nowIso(), pending.id);
  if (intent === 'confirm' && appt.status === 'agendada') {
    db.prepare("UPDATE appointments SET status = 'confirmada', updated_at = ? WHERE id = ?").run(nowIso(), appt.id);
  }
  const reply = fillTemplate(intent === 'confirm' ? settings.wa_reply_confirm : settings.wa_reply_reschedule, appt).trim();
  if (reply && sock) {
    await sleep(2000 + Math.random() * 3000);
    await sock.sendMessage(m.key.remoteJid, { text: reply });
  }
}

// exportado para testes
export const _test = { handleIncoming, st, setSock: (s) => { sock = s; } };
