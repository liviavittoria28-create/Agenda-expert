// Banco de dados relacional (SQLite embutido no Node.js) — RSIS02
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_FILE = path.join(DATA_DIR, 'agenda-expert.db');

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Esther Lino',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  birth_date TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone_digits);
CREATE TABLE IF NOT EXISTS anamneses (
  client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  consent INTEGER NOT NULL DEFAULT 0,
  filled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS procedures (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendada',
  cancel_reason TEXT,
  notes TEXT,
  total_cents INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appt_client ON appointments(client_id);
CREATE TABLE IF NOT EXISTS appointment_procedures (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  procedure_id INTEGER REFERENCES procedures(id),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  duration_min INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ap_appt ON appointment_procedures(appointment_id);
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY,
  reason TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 1,
  start_time TEXT,
  end_time TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  method TEXT,
  description TEXT,
  client_id INTEGER REFERENCES clients(id),
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  jid TEXT,
  status TEXT NOT NULL,
  error TEXT,
  reply TEXT,
  reply_text TEXT,
  sent_at TEXT,
  replied_at TEXT
);
CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'un',
  quantity REAL NOT NULL DEFAULT 0,
  min_quantity REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  date TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
`);

export const nowIso = () => new Date().toISOString();

// Catálogo inicial — Anexo A (durações são estimativas a confirmar)
const CATALOG = [
  ['Nanoblading', 'Micropigmentação que harmoniza o olhar através da naturalidade dos fios realistas.', 62000, 150],
  ['Design de sobrancelha', 'Sobrancelhas harmônicas e respeitando sua estrutura natural, olhar limpo e renovado.', 5000, 30],
  ['Brow lamination', 'Procedimento químico que alinha os fios e confere mais volume às sobrancelhas com os fios naturais.', 12000, 60],
  ['Extensão de cílios', 'Aplicação de fios sintéticos sobre os fios naturais; olhar marcante sem perder a naturalidade.', 17000, 120],
  ['Manutenção de cílios', 'Preenchimento das falhas após 20 dias da aplicação.', 12000, 90],
  ['Remoção de cílios', 'Retirada dos fios sintéticos com segurança e sem agredir os fios naturais.', 4500, 30],
  ['Lash lifting', 'Curva quimicamente os fios naturais, permitindo o uso de rímel e um olhar delicado e natural.', 18000, 60],
  ['Depilação buço', 'Limpeza dos pelinhos do buço (bigode) na linha ou cera fria.', 3500, 15],
  ['Limpeza de pele', 'Remoção de cravos e espinhas, recuperação do viço da pele e hidratação dos poros.', 20000, 75],
];

const DEFAULT_SETTINGS = {
  open_time: '08:00',
  close_time: '20:00',
  work_days: '1,2,3,4,5,6', // 0 = domingo
  gap_min: '0',
  studio_name: 'Esther Lino Bio Estética',
  studio_address: 'Rua Aiapaina, 3A — Tatuapé',
  consent_text:
    'Declaro que as informações prestadas nesta ficha são verdadeiras e que fui informada sobre o procedimento, seus cuidados, riscos e contraindicações. Autorizo a realização do procedimento e me comprometo a seguir as orientações de pós-cuidado. Autorizo o armazenamento destes dados pessoais e de saúde exclusivamente para fins de atendimento, conforme a LGPD (Lei 13.709/2018).',
  // Mensagem pronta do botão WhatsApp (editável em Mais → Ajustes).
  // Campos trocados automaticamente: [nome] [data] [horário] [procedimento] [valor]
  whatsapp_template: [
    'Olá! Tudo bem? 🤍',
    '',
    'Passando para confirmar seu atendimento, agendado para o dia [data], às [horário].',
    '',
    '📍 *Studio – Rua Aiapaina, 3A - Tatuapé*',
    '',
    'Será um prazer receber você!',
    'Por favor, confirme sua presença respondendo: “Confirmo meu horário”.',
    '',
    'Assim, posso me preparar para recebê-la com todo carinho! ✨',
  ].join('\n'),
  // Robô de confirmação (Mais → WhatsApp)
  wa_auto: '0',
  wa_mode: 'same_day', // same_day = no dia · day_before = na véspera
  wa_time: '08:00',
  wa_footer: 'Responda com o número:\n*1* – Confirmo meu horário ✅\n*2* – Preciso remarcar 🗓️',
  wa_reply_confirm: 'Perfeito, [nome]! Seu horário de [data] às [horário] está confirmado ✨ Até lá! 🤍',
  wa_reply_reschedule: 'Sem problemas, [nome]! Já avisei aqui e logo te chamo para encontrarmos um novo horário 🤍',
};

export function seed() {
  const t = nowIso();
  const count = db.prepare('SELECT COUNT(*) AS n FROM procedures').get().n;
  if (count === 0) {
    const ins = db.prepare(
      'INSERT INTO procedures (name, description, price_cents, duration_min, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    );
    CATALOG.forEach(([n, d, p, m], i) => ins.run(n, d, p, m, i, t, t));
  }
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSet.run(k, v);
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
