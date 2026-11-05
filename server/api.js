// API REST do Agenda Expert
import { db, nowIso, getSettings, tx } from './db.js';
import {
  createSession, destroySession, verifyPassword,
  loginAllowed, loginFailed, loginOk, COOKIE,
} from './auth.js';
import { toMin, fromMin, stamp, stampTime, isDate, isTime, addDays, diffDays, weekday, fmtBR, todayBR } from './time.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (msg, extra) => new HttpError(400, msg, extra);
const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado.`);

const STATUSES = ['agendada', 'confirmada', 'concluida', 'cancelada', 'faltou'];
const FREEING = ['cancelada', 'faltou']; // RN07
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s) => String(s || '').replace(/\D/g, '');
const str = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const toCents = (v) => {
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

// ---------------------------------------------------------------- Roteador
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth !== false });
};
export function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

// ---------------------------------------------------------------- Auth
route('POST', '/api/login', ({ body, ip, setCookie }) => {
  if (!loginAllowed(ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const email = String(body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) {
    loginFailed(ip);
    throw new HttpError(401, 'E-mail ou senha incorretos');
  }
  loginOk(ip);
  const s = createSession(user.id);
  setCookie(COOKIE, s.token, s.maxAge);
  return { user: { id: user.id, email: user.email, name: user.name } };
}, { auth: false });

route('POST', '/api/logout', ({ token, setCookie }) => {
  destroySession(token);
  setCookie(COOKIE, '', 0);
  return { ok: true };
}, { auth: false });

// verificação de saúde para o serviço de hospedagem
route('GET', '/api/health', () => {
  db.prepare('SELECT 1').get();
  return { ok: true };
}, { auth: false });

route('GET', '/api/me', ({ user }) => ({ user, settings: getSettings(), today: todayBR() }));

// E-mail e senha são definidos só pelas variáveis de ambiente (ADMIN_EMAIL / ADMIN_PASSWORD)
route('PUT', '/api/account', () => {
  throw new HttpError(409, 'O e-mail e a senha são definidos nas variáveis do servidor (ADMIN_EMAIL e ADMIN_PASSWORD).', { code: 'account_managed' });
});

// ---------------------------------------------------------------- Ajustes
route('GET', '/api/settings', () => getSettings());
route('PUT', '/api/settings', ({ body }) => {
  const allowed = ['open_time', 'close_time', 'work_days', 'gap_min', 'consent_text'];
  if (body.open_time && !isTime(body.open_time)) throw bad('Horário de abertura inválido.');
  if (body.close_time && !isTime(body.close_time)) throw bad('Horário de fechamento inválido.');
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of allowed) if (body[k] != null) up.run(k, String(body[k]));
  return getSettings();
});

// ---------------------------------------------------------------- Clientes
const anamneseState = (a) => (!a ? 'pendente' : a.consent ? 'ok' : 'rascunho');

function clientRow(c) {
  return {
    id: c.id, name: c.name, phone: c.phone, birth_date: c.birth_date, email: c.email, notes: c.notes,
    active: !!c.active, created_at: c.created_at, updated_at: c.updated_at,
    anamnese: c.a_consent == null ? 'pendente' : c.a_consent ? 'ok' : 'rascunho',
  };
}

route('GET', '/api/clients', ({ query }) => {
  const q = String(query.q || '').trim();
  const showInactive = query.inactive === '1';
  const where = [];
  const args = [];
  if (!showInactive) where.push('c.active = 1');
  if (q) {
    const d = digits(q);
    if (d.length >= 3) {
      where.push('(c.name LIKE ? OR c.phone_digits LIKE ?)');
      args.push(`%${q}%`, `%${d}%`);
    } else {
      where.push('c.name LIKE ?');
      args.push(`%${q}%`);
    }
  }
  const rows = db
    .prepare(
      `SELECT c.*, a.consent AS a_consent FROM clients c LEFT JOIN anamneses a ON a.client_id = c.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name COLLATE NOCASE LIMIT ${q ? 50 : 1000}`
    )
    .all(...args);
  // ordenação sem acento
  return rows.map(clientRow).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
});

function validateClient(body, id) {
  const name = str(body.name, 120);
  const phone = str(body.phone, 30);
  const fields = [];
  if (!name) fields.push('name');
  if (!phone || digits(phone).length < 10) fields.push('phone');
  if (fields.length) throw bad('Preencha nome e telefone válidos.', { fields });
  if (body.birth_date && !isDate(body.birth_date)) throw bad('Data de nascimento inválida.', { fields: ['birth_date'] });
  const email = str(body.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('E-mail inválido.', { fields: ['email'] });
  const dup = db.prepare('SELECT id, name FROM clients WHERE phone_digits = ? AND id IS NOT ?').get(digits(phone), id ?? null);
  if (dup && !body.allow_duplicate)
    throw new HttpError(409, `Já existe cliente com este telefone: ${dup.name}.`, { code: 'duplicate_phone', existing_id: dup.id });
  return { name, phone, phone_digits: digits(phone), birth_date: body.birth_date || null, email, notes: str(body.notes) };
}

route('POST', '/api/clients', ({ body }) => {
  const c = validateClient(body);
  const t = nowIso();
  const r = db
    .prepare('INSERT INTO clients (name, phone, phone_digits, birth_date, email, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(c.name, c.phone, c.phone_digits, c.birth_date, c.email, c.notes, t, t);
  return getClient(Number(r.lastInsertRowid));
});

function getClient(id) {
  const c = db.prepare('SELECT c.*, a.consent AS a_consent FROM clients c LEFT JOIN anamneses a ON a.client_id = c.id WHERE c.id = ?').get(id);
  if (!c) throw notFound('Cliente');
  return clientRow(c);
}

route('GET', '/api/clients/:id', ({ params }) => {
  const client = getClient(Number(params.id));
  const a = db.prepare('SELECT * FROM anamneses WHERE client_id = ?').get(client.id);
  const history = listAppointments('a.client_id = ?', [client.id], 'ORDER BY a.start_at DESC');
  const spent = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM transactions WHERE client_id = ? AND type = 'in'").get(client.id).s;
  const links =
    db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE client_id = ?').get(client.id).n +
    db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE client_id = ?').get(client.id).n;
  return {
    ...client,
    anamnese_data: a ? { ...JSON.parse(a.data), consent: !!a.consent, filled_at: a.filled_at, updated_at: a.updated_at } : null,
    history,
    spent_cents: spent,
    can_delete: links === 0,
  };
});

route('PUT', '/api/clients/:id', ({ params, body }) => {
  const id = Number(params.id);
  getClient(id);
  const c = validateClient(body, id);
  db.prepare('UPDATE clients SET name=?, phone=?, phone_digits=?, birth_date=?, email=?, notes=?, updated_at=? WHERE id=?').run(
    c.name, c.phone, c.phone_digits, c.birth_date, c.email, c.notes, nowIso(), id
  );
  return getClient(id);
});

route('POST', '/api/clients/:id/active', ({ params, body }) => {
  const id = Number(params.id);
  getClient(id);
  db.prepare('UPDATE clients SET active = ?, updated_at = ? WHERE id = ?').run(body.active ? 1 : 0, nowIso(), id);
  return getClient(id);
});

route('DELETE', '/api/clients/:id', ({ params }) => {
  const id = Number(params.id);
  getClient(id);
  const n =
    db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE client_id = ?').get(id).n +
    db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE client_id = ?').get(id).n;
  if (n > 0) throw new HttpError(409, 'Cliente com atendimentos ou movimentações não pode ser excluída — apenas inativada.'); // RN14
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  return { ok: true };
});

// Anamnese — RF05, RF06
route('PUT', '/api/clients/:id/anamnese', ({ params, body }) => {
  const id = Number(params.id);
  getClient(id);
  const consent = body.consent ? 1 : 0;
  const { consent: _c, filled_at: _f, updated_at: _u, ...data } = body;
  const t = nowIso();
  const filledAt = consent ? todayBR() : null;
  db.prepare(
    `INSERT INTO anamneses (client_id, data, consent, filled_at, created_at, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, consent = excluded.consent,
       filled_at = COALESCE(excluded.filled_at, anamneses.filled_at), updated_at = excluded.updated_at`
  ).run(id, JSON.stringify(data).slice(0, 20000), consent, filledAt, t, t);
  if (!consent) db.prepare('UPDATE anamneses SET filled_at = NULL WHERE client_id = ?').run(id);
  return { ok: true, state: consent ? 'ok' : 'rascunho' };
});

// ---------------------------------------------------------------- Procedimentos
const procRow = (p) => ({ ...p, active: !!p.active });
route('GET', '/api/procedures', ({ query }) =>
  db.prepare(`SELECT * FROM procedures ${query.all === '1' ? '' : 'WHERE active = 1'} ORDER BY active DESC, sort, name`).all().map(procRow)
);
function validateProc(body) {
  const name = str(body.name, 120);
  const price = toCents(body.price_cents ?? body.price);
  const dur = Number(body.duration_min);
  if (!name) throw bad('Informe o nome do procedimento.', { fields: ['name'] });
  if (!Number.isFinite(price) || price < 0) throw bad('O valor deve ser maior ou igual a zero.', { fields: ['price'] });
  if (!Number.isInteger(dur) || dur <= 0 || dur > 720) throw bad('A duração deve ser maior que zero (em minutos).', { fields: ['duration_min'] });
  return { name, description: str(body.description), price, dur };
}
route('POST', '/api/procedures', ({ body }) => {
  const p = validateProc(body);
  const t = nowIso();
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM procedures').get().s;
  const r = db.prepare('INSERT INTO procedures (name, description, price_cents, duration_min, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(p.name, p.description, p.price, p.dur, sort, t, t);
  return procRow(db.prepare('SELECT * FROM procedures WHERE id = ?').get(r.lastInsertRowid));
});
route('PUT', '/api/procedures/:id', ({ params, body }) => {
  const id = Number(params.id);
  if (!db.prepare('SELECT id FROM procedures WHERE id = ?').get(id)) throw notFound('Procedimento');
  const p = validateProc(body);
  db.prepare('UPDATE procedures SET name=?, description=?, price_cents=?, duration_min=?, active=?, updated_at=? WHERE id=?')
    .run(p.name, p.description, p.price, p.dur, body.active === false ? 0 : 1, nowIso(), id);
  return procRow(db.prepare('SELECT * FROM procedures WHERE id = ?').get(id));
});

// ---------------------------------------------------------------- Agendamentos
function listAppointments(where, args, order = 'ORDER BY a.start_at') {
  const rows = db
    .prepare(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone, an.consent AS a_consent
       FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN anamneses an ON an.client_id = a.client_id
       WHERE ${where} ${order}`
    )
    .all(...args);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const procs = db
    .prepare(`SELECT * FROM appointment_procedures WHERE appointment_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids);
  const byAppt = new Map();
  for (const p of procs) {
    if (!byAppt.has(p.appointment_id)) byAppt.set(p.appointment_id, []);
    byAppt.get(p.appointment_id).push({ procedure_id: p.procedure_id, name: p.name, price_cents: p.price_cents, duration_min: p.duration_min });
  }
  const txs = db
    .prepare(`SELECT appointment_id, id FROM transactions WHERE appointment_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  const txBy = new Map(txs.map((t) => [t.appointment_id, t.id]));
  return rows.map((r) => ({
    id: r.id, client_id: r.client_id, client_name: r.client_name, client_phone: r.client_phone,
    date: r.date, start: stampTime(r.start_at), end: stampTime(r.end_at), start_at: r.start_at, end_at: r.end_at,
    status: r.status, cancel_reason: r.cancel_reason, notes: r.notes,
    total_cents: r.total_cents, duration_min: r.duration_min,
    anamnese: r.a_consent == null ? 'pendente' : r.a_consent ? 'ok' : 'rascunho',
    procedures: byAppt.get(r.id) || [],
    transaction_id: txBy.get(r.id) || null,
    created_at: r.created_at, updated_at: r.updated_at,
  }));
}
const getAppointment = (id) => {
  const a = listAppointments('a.id = ?', [id])[0];
  if (!a) throw notFound('Agendamento');
  return a;
};

function blocksOn(date) {
  return db.prepare('SELECT * FROM blocks WHERE start_date <= ? AND end_date >= ?').all(date, date);
}

// Verifica sobreposição com atendimentos (RN02) e bloqueios (RN03)
function findConflict(date, startMin, endMin, excludeId) {
  const gap = Number(getSettings().gap_min || 0);
  for (const b of blocksOn(date)) {
    if (b.all_day) return { type: 'block', message: `Agenda bloqueada neste dia: ${b.reason}.` };
    const bs = toMin(b.start_time), be = toMin(b.end_time);
    if (startMin < be && endMin > bs) return { type: 'block', message: `Horário bloqueado (${b.start_time}–${b.end_time}): ${b.reason}.` };
  }
  const appts = db
    .prepare(
      `SELECT a.start_at, a.end_at, c.name FROM appointments a JOIN clients c ON c.id = a.client_id
       WHERE a.date = ? AND a.status NOT IN ('cancelada','faltou') AND a.id IS NOT ?`
    )
    .all(date, excludeId ?? null);
  for (const a of appts) {
    const s = toMin(stampTime(a.start_at)), e = toMin(stampTime(a.end_at));
    if (startMin < e + gap && endMin + gap > s)
      return { type: 'appointment', message: `Conflito com o atendimento de ${a.name} (${fromMin(s)}–${fromMin(e)}).` };
  }
  return null;
}

function nextFree(date, startMin, dur, excludeId) {
  const st = getSettings();
  const open = toMin(st.open_time || '08:00'), close = toMin(st.close_time || '20:00');
  const days = String(st.work_days || '1,2,3,4,5,6').split(',').map(Number);
  let d = date;
  let m = Math.max(startMin, open);
  m = Math.ceil(m / 15) * 15;
  for (let i = 0; i < 60; i++) {
    if (days.includes(weekday(d))) {
      for (; m + dur <= close; m += 15) {
        if (!findConflict(d, m, m + dur, excludeId)) return { date: d, start: fromMin(m) };
      }
    }
    d = addDays(d, 1);
    m = open;
  }
  return null;
}

function softWarnings(clientId, date, procs, excludeId) {
  const w = [];
  const an = db.prepare('SELECT consent FROM anamneses WHERE client_id = ?').get(clientId);
  if (!an || !an.consent) w.push({ code: 'anamnese', message: 'Esta cliente ainda não tem anamnese completa. Recomenda-se preencher antes do procedimento.' }); // RN13
  if (procs.some((p) => norm(p.name).includes('manutencao de cilios'))) {
    const last = db
      .prepare(
        `SELECT a.date FROM appointments a JOIN appointment_procedures ap ON ap.appointment_id = a.id
         WHERE a.client_id = ? AND a.date <= ? AND a.id IS NOT ? AND a.status NOT IN ('cancelada','faltou')
         AND (lower(ap.name) LIKE '%extens%c%lios%' OR lower(ap.name) LIKE '%manuten%c%lios%')
         ORDER BY a.date DESC LIMIT 1`
      )
      .get(clientId, date, excludeId ?? null);
    if (last) {
      const days = diffDays(last.date, date);
      if (days < 20)
        w.push({ code: 'cilios', message: `Última aplicação/manutenção de cílios em ${fmtBR(last.date)} (${days} dia${days === 1 ? '' : 's'}). A manutenção é indicada a partir de 20 dias.` }); // RN12
    }
  }
  return w;
}

function prepareAppointment(body, excludeId) {
  const clientId = Number(body.client_id);
  const client = db.prepare('SELECT id, active FROM clients WHERE id = ?').get(clientId);
  if (!client) throw bad('Selecione a cliente.', { fields: ['client'] });
  const ids = Array.isArray(body.procedure_ids) ? body.procedure_ids.map(Number) : [];
  if (!ids.length) throw bad('Selecione ao menos um procedimento.', { fields: ['procedures'] });
  if (!isDate(body.date)) throw bad('Informe a data.', { fields: ['date'] });
  if (!isTime(body.start)) throw bad('Informe o horário de início.', { fields: ['start'] });

  // Ao editar, procedimentos já gravados mantêm valor e duração praticados (RN08)
  const kept = excludeId
    ? new Map(db.prepare('SELECT * FROM appointment_procedures WHERE appointment_id = ?').all(excludeId).map((p) => [p.procedure_id, p]))
    : new Map();
  const procs = ids.map((id) => {
    if (kept.has(id)) return kept.get(id);
    const p = db.prepare('SELECT * FROM procedures WHERE id = ? AND active = 1').get(id);
    if (!p) throw bad('Procedimento inválido ou desativado.');
    return { procedure_id: p.id, name: p.name, price_cents: p.price_cents, duration_min: p.duration_min };
  });
  const dur = procs.reduce((s, p) => s + p.duration_min, 0);
  const startMin = toMin(body.start);
  const endMin = startMin + dur; // RN04
  if (endMin > 24 * 60) throw bad('O atendimento ultrapassa a meia-noite. Escolha um horário mais cedo.');
  const total = procs.reduce((s, p) => s + p.price_cents, 0);
  return { clientId, procs, dur, total, date: body.date, startMin, endMin };
}

route('GET', '/api/appointments', ({ query }) => {
  const from = query.from, to = query.to;
  if (!isDate(from) || !isDate(to)) throw bad('Período inválido.');
  return { appointments: listAppointments('a.date BETWEEN ? AND ?', [from, to]), blocks: listBlocks(from, to) };
});

route('GET', '/api/appointments/year/:year', ({ params }) => {
  const y = String(Number(params.year));
  const counts = db
    .prepare(
      `SELECT substr(date,6,2) AS m, COUNT(*) AS n FROM appointments
       WHERE substr(date,1,4) = ? AND status NOT IN ('cancelada','faltou') GROUP BY m`
    )
    .all(y);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0, blocked_days: 0, days: 0 }));
  for (const c of counts) months[Number(c.m) - 1].count = c.n;
  const blocks = db.prepare("SELECT * FROM blocks WHERE all_day = 1 AND start_date <= ? AND end_date >= ?").all(`${y}-12-31`, `${y}-01-01`);
  for (let i = 0; i < 12; i++) {
    const first = `${y}-${String(i + 1).padStart(2, '0')}-01`;
    const days = new Date(Date.UTC(Number(y), i + 1, 0)).getUTCDate();
    months[i].days = days;
    const set = new Set();
    for (const b of blocks) {
      for (let d = 0; d < days; d++) {
        const ds = addDays(first, d);
        if (ds >= b.start_date && ds <= b.end_date) set.add(ds);
      }
    }
    months[i].blocked_days = set.size;
  }
  return { year: Number(y), months };
});

route('POST', '/api/appointments/check', ({ body }) => {
  const p = prepareAppointment(body, body.id ? Number(body.id) : null);
  const conflict = findConflict(p.date, p.startMin, p.endMin, body.id ? Number(body.id) : null);
  return {
    end: fromMin(p.endMin), duration_min: p.dur, total_cents: p.total,
    conflict, next_free: conflict ? nextFree(p.date, p.startMin, p.dur, body.id ? Number(body.id) : null) : null,
    warnings: softWarnings(p.clientId, p.date, p.procs, body.id ? Number(body.id) : null),
  };
});

function assertFree(p, excludeId) {
  const conflict = findConflict(p.date, p.startMin, p.endMin, excludeId);
  if (conflict) throw new HttpError(409, conflict.message, { code: 'conflict', next_free: nextFree(p.date, p.startMin, p.dur, excludeId) });
}

function saveProcs(apptId, procs) {
  db.prepare('DELETE FROM appointment_procedures WHERE appointment_id = ?').run(apptId);
  const ins = db.prepare('INSERT INTO appointment_procedures (appointment_id, procedure_id, name, price_cents, duration_min) VALUES (?,?,?,?,?)');
  for (const p of procs) ins.run(apptId, p.procedure_id, p.name, p.price_cents, p.duration_min);
}

route('POST', '/api/appointments', ({ body }) => {
  const p = prepareAppointment(body);
  assertFree(p);
  const t = nowIso();
  const id = tx(() => {
    const r = db
      .prepare(
        `INSERT INTO appointments (client_id, date, start_at, end_at, status, notes, total_cents, duration_min, created_at, updated_at)
         VALUES (?,?,?,?,'agendada',?,?,?,?,?)`
      )
      .run(p.clientId, p.date, stamp(p.date, fromMin(p.startMin)), stamp(p.date, fromMin(p.endMin)), str(body.notes), p.total, p.dur, t, t);
    const id = Number(r.lastInsertRowid);
    saveProcs(id, p.procs);
    return id;
  });
  return getAppointment(id);
});

route('GET', '/api/appointments/:id', ({ params }) => getAppointment(Number(params.id)));

route('PUT', '/api/appointments/:id', ({ params, body }) => {
  const id = Number(params.id);
  const current = getAppointment(id);
  const p = prepareAppointment(body, id);
  if (!FREEING.includes(current.status)) assertFree(p, id);
  tx(() => {
    db.prepare('UPDATE appointments SET client_id=?, date=?, start_at=?, end_at=?, notes=?, total_cents=?, duration_min=?, updated_at=? WHERE id=?').run(
      p.clientId, p.date, stamp(p.date, fromMin(p.startMin)), stamp(p.date, fromMin(p.endMin)), str(body.notes), p.total, p.dur, nowIso(), id
    );
    saveProcs(id, p.procs);
  });
  return getAppointment(id);
});

route('PATCH', '/api/appointments/:id/status', ({ params, body }) => {
  const id = Number(params.id);
  const a = getAppointment(id);
  const status = String(body.status || '');
  if (!STATUSES.includes(status)) throw bad('Status inválido.');
  const reason = str(body.cancel_reason, 500);
  if (status === 'cancelada' && !reason) throw bad('Informe o motivo do cancelamento.', { fields: ['cancel_reason'] }); // RN05
  // Voltar de cancelada/faltou para um status ativo exige horário livre
  if (FREEING.includes(a.status) && !FREEING.includes(status)) {
    const c = findConflict(a.date, toMin(a.start), toMin(a.end), id);
    if (c) throw new HttpError(409, c.message + ' Reagende antes de reativar.');
  }
  db.prepare('UPDATE appointments SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ?').run(
    status, status === 'cancelada' ? reason : null, nowIso(), id
  );
  return getAppointment(id);
});

route('DELETE', '/api/appointments/:id', ({ params }) => {
  const id = Number(params.id);
  getAppointment(id);
  tx(() => {
    db.prepare('UPDATE transactions SET appointment_id = NULL WHERE appointment_id = ?').run(id);
    db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  });
  return { ok: true };
});

// ---------------------------------------------------------------- Bloqueios — RF19, RF20
function listBlocks(from, to) {
  return db.prepare('SELECT * FROM blocks WHERE start_date <= ? AND end_date >= ? ORDER BY start_date').all(to, from)
    .map((b) => ({ ...b, all_day: !!b.all_day }));
}
route('GET', '/api/blocks', ({ query }) => {
  const from = isDate(query.from) ? query.from : todayBR();
  const to = isDate(query.to) ? query.to : '9999-12-31';
  return listBlocks(from, to);
});

function validateBlock(body) {
  const reason = str(body.reason, 200);
  if (!reason) throw bad('Informe o motivo do bloqueio.', { fields: ['reason'] });
  if (!isDate(body.start_date)) throw bad('Informe a data inicial.', { fields: ['start_date'] });
  const end = body.end_date || body.start_date;
  if (!isDate(end) || end < body.start_date) throw bad('A data final deve ser igual ou posterior à inicial.', { fields: ['end_date'] });
  const allDay = body.all_day !== false;
  if (!allDay) {
    if (!isTime(body.start_time) || !isTime(body.end_time) || body.end_time <= body.start_time)
      throw bad('Informe um intervalo de horário válido.', { fields: ['start_time', 'end_time'] });
  }
  return { reason, start_date: body.start_date, end_date: end, all_day: allDay ? 1 : 0, start_time: allDay ? null : body.start_time, end_time: allDay ? null : body.end_time };
}

function apptsInBlock(b, excludeIds = []) {
  const list = listAppointments("a.date BETWEEN ? AND ? AND a.status NOT IN ('cancelada','faltou')", [b.start_date, b.end_date]);
  return list.filter((a) => {
    if (b.all_day) return true;
    return toMin(a.start) < toMin(b.end_time) && toMin(a.end) > toMin(b.start_time);
  });
}

function saveBlock(body, id) {
  const b = validateBlock(body);
  const inside = apptsInBlock(b);
  if (inside.length && !body.confirm)
    throw new HttpError(409, 'Há atendimentos neste período.', { code: 'appointments_in_block', appointments: inside }); // CSU07
  const t = nowIso();
  if (id) {
    db.prepare('UPDATE blocks SET reason=?, start_date=?, end_date=?, all_day=?, start_time=?, end_time=?, updated_at=? WHERE id=?')
      .run(b.reason, b.start_date, b.end_date, b.all_day, b.start_time, b.end_time, t, id);
    return id;
  }
  return Number(
    db.prepare('INSERT INTO blocks (reason, start_date, end_date, all_day, start_time, end_time, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(b.reason, b.start_date, b.end_date, b.all_day, b.start_time, b.end_time, t, t).lastInsertRowid
  );
}
const getBlock = (id) => {
  const b = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
  if (!b) throw notFound('Bloqueio');
  return { ...b, all_day: !!b.all_day };
};
route('POST', '/api/blocks', ({ body }) => getBlock(saveBlock(body)));
route('PUT', '/api/blocks/:id', ({ params, body }) => {
  getBlock(Number(params.id));
  return getBlock(saveBlock(body, Number(params.id)));
});
route('DELETE', '/api/blocks/:id', ({ params }) => {
  getBlock(Number(params.id));
  db.prepare('DELETE FROM blocks WHERE id = ?').run(Number(params.id));
  return { ok: true };
});

// ---------------------------------------------------------------- Financeiro — RF21–RF25
export const CATEGORIES = {
  in: ['Atendimento', 'Venda de produto', 'Outras entradas'],
  out: ['Materiais', 'Aluguel', 'Marketing', 'Contas (água, luz, internet)', 'Impostos e taxas', 'Equipamentos', 'Cursos', 'Outras saídas'],
};
export const METHODS = ['Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'Transferência'];

route('GET', '/api/finance/meta', () => ({ categories: CATEGORIES, methods: METHODS }));

function monthTx(month, f = {}) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw bad('Mês inválido.');
  const where = ['t.date LIKE ?'];
  const args = [`${month}-%`];
  if (f.type === 'in' || f.type === 'out') (where.push('t.type = ?'), args.push(f.type));
  if (f.category) (where.push('t.category = ?'), args.push(f.category));
  if (f.method) (where.push('t.method = ?'), args.push(f.method));
  return db
    .prepare(
      `SELECT t.*, c.name AS client_name FROM transactions t LEFT JOIN clients c ON c.id = t.client_id
       WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.id DESC`
    )
    .all(...args);
}

route('GET', '/api/transactions', ({ query }) => {
  const all = monthTx(query.month);
  const sum = (type) => all.filter((t) => t.type === type).reduce((s, t) => s + t.amount_cents, 0);
  const income = sum('in'), expense = sum('out'); // RN11
  const byCategory = {};
  for (const t of all) {
    const k = `${t.type}|${t.category}`;
    byCategory[k] = (byCategory[k] || 0) + t.amount_cents;
  }
  return {
    month: query.month,
    summary: { income_cents: income, expense_cents: expense, balance_cents: income - expense },
    by_category: Object.entries(byCategory).map(([k, v]) => ({ type: k.split('|')[0], category: k.split('|')[1], amount_cents: v })).sort((a, b) => b.amount_cents - a.amount_cents),
    items: monthTx(query.month, query),
  };
});

function validateTx(body) {
  const type = body.type;
  if (type !== 'in' && type !== 'out') throw bad('Escolha entrada ou saída.', { fields: ['type'] });
  const amount = toCents(body.amount_cents ?? body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw bad('O valor deve ser maior que zero.', { fields: ['amount'] }); // RN10
  if (!isDate(body.date)) throw bad('Informe a data.', { fields: ['date'] });
  const category = str(body.category, 80);
  if (!category) throw bad('Escolha a categoria.', { fields: ['category'] });
  const clientId = body.client_id ? Number(body.client_id) : null;
  const apptId = body.appointment_id ? Number(body.appointment_id) : null;
  return { type, amount, date: body.date, category, method: str(body.method, 40), description: str(body.description, 300), clientId, apptId };
}
const getTx = (id) => {
  const t = db.prepare('SELECT t.*, c.name AS client_name FROM transactions t LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = ?').get(id);
  if (!t) throw notFound('Movimentação');
  return t;
};
route('POST', '/api/transactions', ({ body }) => {
  const v = validateTx(body);
  if (v.apptId) {
    const ex = db.prepare('SELECT id FROM transactions WHERE appointment_id = ?').get(v.apptId);
    if (ex && !body.allow_duplicate) throw new HttpError(409, 'Já existe uma entrada registrada para este atendimento.', { code: 'duplicate_tx', existing_id: ex.id });
  }
  const t = nowIso();
  const r = db
    .prepare('INSERT INTO transactions (type, amount_cents, date, category, method, description, client_id, appointment_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(v.type, v.amount, v.date, v.category, v.method, v.description, v.clientId, v.apptId, t, t);
  return getTx(Number(r.lastInsertRowid));
});
route('PUT', '/api/transactions/:id', ({ params, body }) => {
  const id = Number(params.id);
  const cur = getTx(id);
  const v = validateTx({ ...body, client_id: body.client_id ?? cur.client_id, appointment_id: body.appointment_id ?? cur.appointment_id });
  db.prepare('UPDATE transactions SET type=?, amount_cents=?, date=?, category=?, method=?, description=?, client_id=?, appointment_id=?, updated_at=? WHERE id=?')
    .run(v.type, v.amount, v.date, v.category, v.method, v.description, v.clientId, v.apptId, nowIso(), id);
  return getTx(id);
});
route('DELETE', '/api/transactions/:id', ({ params }) => {
  getTx(Number(params.id));
  db.prepare('DELETE FROM transactions WHERE id = ?').run(Number(params.id));
  return { ok: true };
});

// Exportação em planilha (CSV compatível com Excel pt-BR) — RF27
route('GET', '/api/transactions/export', ({ query }) => {
  const items = monthTx(query.month).slice().reverse();
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Data', 'Tipo', 'Categoria', 'Forma de pagamento', 'Descrição', 'Cliente', 'Valor (R$)'].map(q).join(';')];
  let inc = 0, out = 0;
  for (const t of items) {
    if (t.type === 'in') inc += t.amount_cents; else out += t.amount_cents;
    lines.push([fmtBR(t.date), t.type === 'in' ? 'Entrada' : 'Saída', t.category, t.method, t.description, t.client_name, (t.type === 'out' ? '-' : '') + money(t.amount_cents)].map(q).join(';'));
  }
  lines.push('', [q('Total de entradas'), money(inc)].join(';'), [q('Total de saídas'), money(out)].join(';'), [q('Saldo'), money(inc - out)].join(';'));
  return {
    __raw: '﻿' + lines.join('\r\n'),
    __type: 'text/csv; charset=utf-8',
    __filename: `financeiro-${query.month}.csv`,
  };
});

// ---------------------------------------------------------------- Estoque (desejável) — RF28
route('GET', '/api/stock', () => db.prepare('SELECT * FROM stock_items WHERE active = 1 ORDER BY name COLLATE NOCASE').all());
function validateItem(body) {
  const name = str(body.name, 120);
  if (!name) throw bad('Informe o nome do item.', { fields: ['name'] });
  const min = Number(String(body.min_quantity ?? 0).replace(',', '.'));
  if (!Number.isFinite(min) || min < 0) throw bad('Quantidade mínima inválida.', { fields: ['min_quantity'] });
  return { name, unit: str(body.unit, 20) || 'un', min };
}
route('POST', '/api/stock', ({ body }) => {
  const v = validateItem(body);
  const qty = Number(String(body.quantity ?? 0).replace(',', '.')) || 0;
  const t = nowIso();
  const r = db.prepare('INSERT INTO stock_items (name, unit, quantity, min_quantity, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(v.name, v.unit, Math.max(0, qty), v.min, t, t);
  return db.prepare('SELECT * FROM stock_items WHERE id = ?').get(r.lastInsertRowid);
});
route('PUT', '/api/stock/:id', ({ params, body }) => {
  const id = Number(params.id);
  const v = validateItem(body);
  db.prepare('UPDATE stock_items SET name=?, unit=?, min_quantity=?, active=?, updated_at=? WHERE id=?').run(v.name, v.unit, v.min, body.active === false ? 0 : 1, nowIso(), id);
  return db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
});
route('POST', '/api/stock/:id/move', ({ params, body }) => {
  const id = Number(params.id);
  const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
  if (!item) throw notFound('Item');
  const qty = Number(String(body.quantity ?? '').replace(',', '.'));
  if (!Number.isFinite(qty) || qty <= 0) throw bad('Informe uma quantidade maior que zero.', { fields: ['quantity'] });
  const type = body.type === 'out' ? 'out' : 'in';
  if (type === 'out' && qty > item.quantity) throw bad(`Estoque insuficiente (${item.quantity} ${item.unit}).`);
  tx(() => {
    db.prepare('INSERT INTO stock_moves (item_id, type, quantity, date, note, created_at) VALUES (?,?,?,?,?,?)').run(id, type, qty, todayBR(), str(body.note), nowIso());
    db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(type === 'in' ? qty : -qty, nowIso(), id);
  });
  return db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
});
route('GET', '/api/stock/:id/moves', ({ params }) =>
  db.prepare('SELECT * FROM stock_moves WHERE item_id = ? ORDER BY id DESC LIMIT 50').all(Number(params.id))
);

// ---------------------------------------------------------------- Painel do dia
route('GET', '/api/dashboard', () => {
  const today = todayBR();
  const month = today.slice(0, 7);
  const todays = listAppointments('a.date = ?', [today]);
  const inc = db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE type='in' AND date LIKE ?").get(`${month}-%`).s;
  const out = db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE type='out' AND date LIKE ?").get(`${month}-%`).s;
  const low = db.prepare('SELECT COUNT(*) n FROM stock_items WHERE active = 1 AND quantity <= min_quantity AND min_quantity > 0').get().n;
  return { today, appointments: todays, month_balance_cents: inc - out, low_stock: low };
});

// ---------------------------------------------------------------- Cópia de segurança (download)
route('GET', '/api/backup', () => {
  const tables = ['clients', 'anamneses', 'procedures', 'appointments', 'appointment_procedures', 'blocks', 'transactions', 'stock_items', 'stock_moves', 'settings'];
  const dump = { app: 'Agenda Expert', exported_at: nowIso(), tables: {} };
  for (const t of tables) dump.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return { __raw: JSON.stringify(dump, null, 1), __type: 'application/json', __filename: `agenda-expert-backup-${todayBR()}.json` };
});
