// Utilitários de linha de comando
//   npm run backups                          → lista as cópias diárias (JSON)
//   npm run restaurar -- arquivo.json        → importa uma cópia (do app ou diária) para o banco
// E-mail e senha: definidos só pelas variáveis ADMIN_EMAIL e ADMIN_PASSWORD (ver README).
import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'backups') {
  const { BACKUP_DIR } = await import('./backup.js');
  const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort() : [];
  console.log(files.length ? files.map((f) => '  ' + path.join(BACKUP_DIR, f)).join('\n') : 'Nenhuma cópia encontrada.');
} else if (cmd === 'restaurar') {
  const src = args[0];
  if (!src || !fs.existsSync(src)) {
    console.error('Uso: npm run restaurar -- caminho/para/agenda-expert-backup.json');
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!dump?.tables) { console.error('Arquivo inválido: não é uma cópia do Agenda Expert.'); process.exit(1); }
  const { initDb, tx } = await import('./db.js');
  await initDb();
  // ordem respeita as ligações entre tabelas
  const order = ['settings', 'clients', 'anamneses', 'procedures', 'appointments', 'appointment_procedures', 'blocks', 'transactions', 'stock_items', 'stock_moves'];
  await tx(async (t) => {
    for (const name of [...order].reverse()) await t.prepare(`DELETE FROM ${name}`).run();
    for (const name of order) {
      for (const row of dump.tables[name] || []) {
        const cols = Object.keys(row);
        await t.prepare(`INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
      }
      if (name !== 'settings' && name !== 'anamneses') {
        await t.prepare(`SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM ${name}), 0) + 1, false)`).get();
      }
    }
  });
  console.log(`✓ Cópia de ${dump.exported_at} restaurada (${(dump.tables.clients || []).length} clientes, ${(dump.tables.appointments || []).length} atendimentos).`);
  process.exit(0);
} else {
  console.log('Comandos: backups, restaurar');
}
