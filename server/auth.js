// Autenticação: senha com hash scrypt + sessão por cookie HttpOnly — RF01, RNF06
import crypto from 'node:crypto';
import { db, nowIso } from './db.js';

const SESSION_DAYS = 30;
export const COOKIE = 'ae_sess';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').run(sha(token), userId, expires, nowIso());
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export async function getSessionUser(token) {
  if (!token) return null;
  const row = await db
    .prepare('SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .get(sha(token));
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    await destroySession(token);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

export async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export async function upsertUser(email, password, name) {
  const t = nowIso();
  const existing = await db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  const h = hashPassword(password);
  if (existing) {
    await db.prepare('UPDATE users SET email = ?, password_hash = ?, name = COALESCE(?, name), updated_at = ? WHERE id = ?').run(
      email.toLowerCase(), h, name ?? null, t, existing.id
    );
    await db.prepare('DELETE FROM sessions').run();
  } else {
    await db.prepare('INSERT INTO users (email, name, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)').run(
      email.toLowerCase(), name || 'Esther Lino', h, t, t
    );
  }
}

// Limite simples de tentativas de login por IP
const attempts = new Map();
export function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a) return true;
  if (Date.now() - a.first > 15 * 60e3) {
    attempts.delete(ip);
    return true;
  }
  return a.count < 10;
}
export function loginFailed(ip) {
  const a = attempts.get(ip) || { count: 0, first: Date.now() };
  a.count++;
  attempts.set(ip, a);
}
export function loginOk(ip) {
  attempts.delete(ip);
}
