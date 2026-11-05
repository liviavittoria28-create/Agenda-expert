// Roda os testes da API conectando por DATABASE_URL (protocolo de rede do Postgres),
// exatamente como o app conecta no Supabase — usando um Postgres local temporário.
// Uso: npm run test:postgres
import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = 55432;
const pg = await PGlite.create();
const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1', maxConnections: 20 });
await server.start();
console.log(`Postgres de teste em 127.0.0.1:${PORT}`);

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', '--test-concurrency=1', 'test/api.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable` },
});
child.on('exit', async (code) => {
  await server.stop().catch(() => {});
  await pg.close().catch(() => {});
  process.exit(code ?? 1);
});
