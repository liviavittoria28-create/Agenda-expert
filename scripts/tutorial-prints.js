// Gera os prints do tutorial (public/tutorial/shots) com o Edge/Chrome invisível, em tamanho de iPhone.
// Uso (com o app rodando):  PRINT_EMAIL=... PRINT_PASSWORD=... node scripts/tutorial-prints.js http://localhost:5173
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5173';
const EMAIL = process.env.PRINT_EMAIL, PASSWORD = process.env.PRINT_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Defina PRINT_EMAIL e PRINT_PASSWORD.'); process.exit(1); }
const OUT = path.resolve('public/tutorial/shots');
fs.mkdirSync(OUT, { recursive: true });

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const exe = BROWSERS.find((p) => fs.existsSync(p));
if (!exe) { console.error('Edge ou Chrome não encontrado.'); process.exit(1); }

const PORT = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-prints-'));
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erro no script');
  return r.result.value;
};

async function main() {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('Navegador não respondeu.');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 700, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });

  const open = async (hash) => {
    await send('Page.navigate', { url: `${BASE}/?v=${Date.now()}${hash}` }); // carga completa a cada tela
    await sleep(2200);
  };
  await open('');
  await evaluate(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ email: EMAIL, password: PASSWORD })})}).then(r=>r.status)`);

  const HL = `(() => { if (!document.getElementById('hl')) { const s = document.createElement('style'); s.id = 'hl';
    s.textContent = '.tut-hl{outline:3px solid #b08d57 !important;outline-offset:2px;border-radius:14px;box-shadow:0 0 0 8px rgba(176,141,87,.22)!important} *{animation:none!important;transition:none!important}';
    document.head.appendChild(s); } })();`;
  const shot = async (name, setup) => {
    await evaluate(HL);
    if (setup) await evaluate(`(async () => { ${setup} })()`);
    await sleep(700);
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    fs.writeFileSync(path.join(OUT, `${name}.jpg`), Buffer.from(data, 'base64'));
    console.log(`✓ ${name}.jpg`);
  };

  await open('#/mais');
  await shot('01-mais', `[...document.querySelectorAll('.menu button')].find(b => b.textContent.includes('WhatsApp')).classList.add('tut-hl');`);

  await open('#/mais/whatsapp');
  await shot('02-whatsapp', `document.querySelector('.wa-hero [data-pair]').classList.add('tut-hl');`);

  await shot('03-numero', `document.querySelector('.wa-hero [data-pair]').classList.remove('tut-hl');
    document.querySelector('.wa-hero [data-pair]').click(); await new Promise(r => setTimeout(r, 800));
    const i = document.querySelector('.sheet [name=phone]'); i.value = '(11) 99999-0000'; i.blur();
    document.querySelector('.sheet [data-go]').classList.add('tut-hl');`);

  await open('#/mais/whatsapp');
  await shot('04-codigo', `document.querySelector('section.card').innerHTML = \`<div class="wa-pair"><div class="label">Seu código</div><div class="wa-code">K7P4-X9QM</div>
    <ol class="wa-steps"><li>Toque na notificação do WhatsApp que chegou no celular, <b>ou</b> abra o WhatsApp → <b>Configurações</b> → <b>Aparelhos conectados</b> → <b>Conectar aparelho</b>.</li>
    <li>Escolha <b>Conectar com número de telefone</b>.</li><li>Digite o código acima.</li></ol><button class="btn btn--ghost btn--sm">Cancelar</button></div>\`;
    document.querySelector('.wa-code').classList.add('tut-hl');`);

  await open('#/mais/whatsapp');
  await shot('05-conectado', `document.querySelector('section.card').innerHTML = \`<div class="wa-conn"><span class="wa-dot is-on"></span>
    <div class="grow"><b>WhatsApp conectado</b><span>+5511999990000 · Esther Lino Bio Estética</span></div><button class="btn btn--ghost btn--sm">Desconectar</button></div>\`;
    document.querySelector('.wa-conn').classList.add('tut-hl');`);

  await shot('06-automatico', `const f = document.querySelector('[data-auto]'); f.wa_auto.checked = true; f.wa_mode.value = 'day_before'; f.wa_time.value = '18:00';
    f.classList.add('tut-hl'); f.previousElementSibling.scrollIntoView({ block: 'start' }); window.scrollBy(0, -16);`);

  await shot('07-mensagens', `document.querySelector('[data-auto]').classList.remove('tut-hl'); const p = document.querySelector('[data-preview]');
    p.classList.add('tut-hl'); p.scrollIntoView({ block: 'center' });`);
}

main()
  .catch((e) => { console.error('Falhou:', e.message); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} browser.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500); });
