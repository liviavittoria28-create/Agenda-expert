// Cópia de segurança diária — RNF07
// Grava um arquivo JSON por dia com todos os dados em DATA_DIR/backups (mantém os últimos 30).
// Com o Supabase, os dados já ficam online; esta cópia é uma proteção extra
// (e pode ser baixada a qualquer momento em Mais → Baixar cópia de segurança).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';
import { todayBR } from './time.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP || 30);

export async function runBackup() {
  const { exportAll } = await import('./api.js');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `agenda-expert-${todayBR()}.json`);
  if (fs.existsSync(file)) return file;
  fs.writeFileSync(file, JSON.stringify(await exportAll()));
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  console.log(`✓ Backup diário: ${path.basename(file)}`);
  return file;
}

export function startBackups() {
  const run = () => runBackup().catch((e) => console.error('Falha no backup:', e.message));
  setTimeout(run, 3000).unref();
  setInterval(run, 60 * 60 * 1000).unref(); // verifica de hora em hora; grava 1 cópia por dia
}
