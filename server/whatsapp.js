// Conexão com o WhatsApp (via QR code, como o WhatsApp Web) e robô de confirmação.
// Usa a biblioteca Baileys (não oficial). Gratuito, mas o WhatsApp pode restringir
// números que enviam mensagens em massa — por isso há pausas e limites.
import QRCode from 'qrcode';
import { db, getSettings, nowIso } from './db.js';
import { todayBR, toMin, stampTime } from './time.js';
import { fullNumber, phoneKey, jidNumber, parseReply, fillTemplate, confirmationMessage, dueAppointments, targetDate, humanDelay } from './wa-logic.js';

const MAX_PER_RUN = 40;

const st = { status: 'disconnected', qr: null, pairing: null, me: null, error: null, sending: false };
let sock = null;
let wantConnected = false;
let retry = 0;

// logger silencioso exigido pela biblioteca
const noop = () => {};
const logger = { level: 'silent', child: () => logger, trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };

export const waState = () => ({ status: st.status, qr: st.qr, pairing: st.pairing, me: st.me, error: st.error, sending: st.sending });
const hasSession = async () => !!(await db.prepare("SELECT 1 AS ok FROM wa_auth WHERE key = 'creds'").get());

// ---------------------------------------------------------------- Sessão guardada no banco (Supabase)
// Assim a conexão sobrevive a reinícios do servidor, mesmo em hospedagem que apaga o disco.
async function useDbAuthState(B) {
  const enc = (v) => JSON.stringify(v, B.BufferJSON.replacer);
  const dec = (s) => JSON.parse(s, B.BufferJSON.reviver);
  const write = (key, value) => db.prepare('INSERT INTO wa_auth (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(key, enc(value));
  const row = await db.prepare("SELECT value FROM wa_auth WHERE key = 'creds'").get();
  const creds = row ? dec(row.value) : B.initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          if (!ids.length) return data;
          const rows = await db.prepare('SELECT key, value FROM wa_auth WHERE key = ANY(?)').all(ids.map((id) => `${type}-${id}`));
          const map = new Map(rows.map((r) => [r.key, r.value]));
          for (const id of ids) {
            const raw = map.get(`${type}-${id}`);
            let value = raw ? dec(raw) : null;
            if (type === 'app-state-sync-key' && value) value = B.proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) await write(key, value);
              else await db.prepare('DELETE FROM wa_auth WHERE key = ?').run(key);
            }
          }
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}
const clearSession = () => db.prepare('DELETE FROM wa_auth').run();

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
  const { state: auth, saveCreds } = await useDbAuthState(B);
  const version = await waVersion(B);
  sock = makeWASocket({
    auth, version, logger,
    // identificação padrão de navegador (nomes personalizados podem ser recusados no pareamento)
    browser: B.Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
  });
  const current = sock;
  sock.ev.on('creds.update', () => saveCreds().catch((e) => console.error('WhatsApp (sessão):', e.message)));
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
      console.log(`WhatsApp: conexão encerrada (código ${code ?? '?'}: ${u.lastDisconnect?.error?.message || 'sem detalhes'})`);
      if (code === 405 || code === 426) cachedVersion = null; // versão recusada: busca de novo na próxima tentativa
      sock = null;
      if (code === B.DisconnectReason.loggedOut || code === B.DisconnectReason.forbidden) {
        await clearSession().catch(() => {});
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

// Versão do WhatsApp Web: o WhatsApp recusa clientes desatualizados ("sem conexão" no celular).
// Busca a versão atual direto do web.whatsapp.com; se falhar, usa a da biblioteca.
let cachedVersion = null;
async function waVersion(B) {
  if (cachedVersion && Date.now() - cachedVersion.at < 3600e3) return cachedVersion.version;
  const tries = [B.fetchLatestWaWebVersion, B.fetchLatestBaileysVersion];
  for (const fn of tries) {
    try {
      const r = await fn?.({});
      if (r?.version?.length === 3) {
        cachedVersion = { version: r.version, at: Date.now() };
        console.log(`WhatsApp: usando versão ${r.version.join('.')}`);
        return r.version;
      }
    } catch {}
  }
  return undefined; // padrão embutido na biblioteca
}

function onError(e) {
  console.error('WhatsApp:', e.message);
  Object.assign(st, { status: 'disconnected', qr: null, error: 'Não foi possível conectar. Tente de novo em instantes.' });
}

export async function logout() {
  wantConnected = false;
  try { await sock?.logout(); } catch {}
  try { sock?.end?.(); } catch {}
  sock = null;
  await clearSession();
  Object.assign(st, { status: 'disconnected', qr: null, pairing: null, me: null, error: null });
  return waState();
}

/** Reconecta sozinho ao ligar o servidor, se já havia um WhatsApp conectado */
export async function autoStart() {
  if (await hasSession().catch(() => false)) connect().catch(onError);
  setInterval(() => runScheduler().catch((e) => console.error('WhatsApp (agenda):', e.message)), 60_000).unref();
}

// ---------------------------------------------------------------- Dados
export async function appointmentsOn(date) {
  const rows = await db
    .prepare(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone, w.status AS wa_status, w.reply AS wa_reply, w.sent_at AS wa_sent_at, w.error AS wa_error
       FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN wa_messages w ON w.appointment_id = a.id
       WHERE a.date = ? ORDER BY a.start_at`
    )
    .all(date);
  const ids = rows.map((r) => r.id);
  const procs = ids.length ? await db.prepare('SELECT appointment_id, name FROM appointment_procedures WHERE appointment_id = ANY(?) ORDER BY id').all(ids) : [];
  return rows.map((r) => ({
    id: r.id, client_id: r.client_id, client_name: r.client_name, client_phone: r.client_phone, date: r.date,
    start: stampTime(r.start_at), end: stampTime(r.end_at), status: r.status, total_cents: r.total_cents, created_at: r.created_at,
    procedures: procs.filter((p) => p.appointment_id === r.id).map((p) => ({ name: p.name })),
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
  return db.prepare(
    `INSERT INTO wa_messages (appointment_id, phone, jid, status, error, sent_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT (appointment_id) DO UPDATE SET phone = EXCLUDED.phone, jid = EXCLUDED.jid, status = EXCLUDED.status,
       error = EXCLUDED.error, sent_at = EXCLUDED.sent_at, reply = NULL, reply_text = NULL, replied_at = NULL`
  ).run(a.id, fullNumber(a.client_phone), fields.jid || null, fields.status, fields.error || null, nowIso());
}

/** Envia a confirmação de um atendimento agora */
export async function sendConfirmation(appointmentId) {
  const a = await db.prepare('SELECT date FROM appointments WHERE id = ?').get(appointmentId);
  if (!a) throw new Error('Atendimento não encontrado.');
  const appt = (await appointmentsOn(a.date)).find((x) => x.id === appointmentId);
  if (['cancelada', 'faltou', 'concluida'].includes(appt.status)) throw new Error('Este atendimento não precisa de confirmação.');
  try {
    const jid = await sendText(appt.client_phone, confirmationMessage(await getSettings(), appt));
    await record(appt, { status: 'sent', jid });
    return { ok: true };
  } catch (e) {
    await record(appt, { status: 'failed', error: e.message });
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
export async function pendingFor(date) {
  return (await appointmentsOn(date)).filter((a) => a.status === 'agendada' && (!a.wa || a.wa.status === 'failed'));
}

export async function runScheduler() {
  if (st.status !== 'connected' || st.sending) return;
  const settings = await getSettings();
  const today = todayBR();
  const date = targetDate(settings, today);
  const appointments = await appointmentsOn(date);
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
  const pending = (await db
    .prepare(
      `SELECT w.*, a.status AS appt_status, a.date FROM wa_messages w JOIN appointments a ON a.id = w.appointment_id
       WHERE w.status = 'sent' AND w.reply IS NULL AND a.date >= ? AND a.status IN ('agendada','confirmada')
       ORDER BY a.start_at`
    )
    .all(todayBR()))
    .find((w) => jids.includes(w.jid) || keys.has(phoneKey(w.phone)));
  if (!pending) return;

  const appt = (await appointmentsOn(pending.date)).find((a) => a.id === pending.appointment_id);
  const settings = await getSettings();
  await db.prepare('UPDATE wa_messages SET reply = ?, reply_text = ?, replied_at = ? WHERE id = ?').run(intent, String(text).slice(0, 500), nowIso(), pending.id);
  if (intent === 'confirm' && appt.status === 'agendada') {
    await db.prepare("UPDATE appointments SET status = 'confirmada', updated_at = ? WHERE id = ?").run(nowIso(), appt.id);
  }
  const reply = fillTemplate(intent === 'confirm' ? settings.wa_reply_confirm : settings.wa_reply_reschedule, appt).trim();
  if (reply && sock) {
    await sleep(2000 + Math.random() * 3000);
    await sock.sendMessage(m.key.remoteJid, { text: reply });
  }
}

// exportado para testes
export const _test = { handleIncoming, st, setSock: (s) => { sock = s; }, useDbAuthState };
