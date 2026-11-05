// Cópia de segurança automática diária — RNF07
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from './db.js';
import { todayBR } from './time.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP || 30);

export function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `agenda-expert-${todayBR()}.db`);
  if (fs.existsSync(file)) return file;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  console.log(`✓ Backup diário: ${path.basename(file)}`);
  return file;
}

export function startBackups() {
  try { runBackup(); } catch (e) { console.error('Falha no backup:', e.message); }
  setInterval(() => {
    try { runBackup(); } catch (e) { console.error('Falha no backup:', e.message); }
  }, 60 * 60 * 1000).unref(); // verifica de hora em hora; grava 1 cópia por dia
}
