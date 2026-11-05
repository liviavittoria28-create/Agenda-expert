// Utilitários de linha de comando
//   npm run restaurar -- arquivo.db      → restaura uma cópia de segurança
//   npm run backups                      → lista as cópias disponíveis
import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...args] = process.argv.slice(2);

// e-mail e senha: definidos só pelas variáveis ADMIN_EMAIL e ADMIN_PASSWORD (ver README)
if (cmd === 'backups') {
  const { BACKUP_DIR } = await import('./backup.js');
  const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort() : [];
  console.log(files.length ? files.map((f) => '  ' + path.join(BACKUP_DIR, f)).join('\n') : 'Nenhuma cópia encontrada.');
} else if (cmd === 'restaurar') {
  const src = args[0];
  if (!src || !fs.existsSync(src)) {
    console.error('Uso: npm run restaurar -- caminho/para/agenda-expert-AAAA-MM-DD.db  (pare o servidor antes)');
    process.exit(1);
  }
  // não importa db.js para não manter o arquivo aberto durante a cópia
  const target = path.join(process.env.DATA_DIR || path.resolve('data'), 'agenda-expert.db');
  const safety = target.replace(/\.db$/, `.antes-da-restauracao-${Date.now()}.db`);
  if (fs.existsSync(target)) fs.copyFileSync(target, safety);
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(target + ext)) fs.rmSync(target + ext);
  fs.copyFileSync(src, target);
  console.log(`✓ Restaurado de ${src}\n  (cópia do estado anterior em ${safety})`);
} else {
  console.log('Comandos: backups, restaurar');
}
