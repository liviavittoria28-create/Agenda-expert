// Grava o tutorial (public/tutorial/?rec) em MP4 vertical 720x1280, usando o Edge/Chrome invisível.
// Uso (com o app rodando):  node scripts/tutorial-video.js http://localhost:5173 [saida.mp4]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { remux } from './mp4-remux.js';

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = path.resolve(process.argv[3] || 'Tutorial-WhatsApp-Agenda-Expert.mp4');
const W = 720, H = 1280;

const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p));
if (!exe) { console.error('Edge ou Chrome não encontrado.'); process.exit(1); }

const PORT = 9335;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-video-'));
const browser = spawn(exe, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map(); this.handlers = {}; }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      else if (m.method && this.handlers[m.method]) this.handlers[m.method](m.params);
    };
    return this;
  }
  send(method, params = {}) { const id = ++this.seq; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(method, fn) { this.handlers[method] = fn; }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erro no script');
    return r.result.value;
  }
}

async function main() {
  let list;
  for (let i = 0; i < 50 && !list?.length; i++) {
    try { list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page'); } catch {}
    if (!list?.length) await sleep(200);
  }
  if (!list?.length) throw new Error('Navegador não respondeu.');
  const player = await new CDP(list[0].webSocketDebuggerUrl).open();
  const recT = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const rec = await new CDP(recT.webSocketDebuggerUrl).open();

  // página que toca o tutorial
  await player.send('Page.enable');
  await player.send('Emulation.setDeviceMetricsOverride', { width: W / 2, height: H / 2, deviceScaleFactor: 2, mobile: false });
  await player.send('Page.navigate', { url: `${BASE}/tutorial/?rec=1` });
  await sleep(3000); // fontes e imagens

  // página que grava: desenha cada quadro num canvas e grava com MediaRecorder (H.264)
  await rec.eval(`(() => {
    const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H}; document.body.appendChild(c);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#4a3628'; ctx.fillRect(0, 0, ${W}, ${H});
    const type = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error('Este navegador não grava MP4.');
    const mr = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 2_500_000 });
    const chunks = []; mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    window.rec = {
      last: null,
      frame(b64) { const img = new Image(); img.onload = () => { window.rec.last = img; ctx.drawImage(img, 0, 0, ${W}, ${H}); }; img.src = 'data:image/jpeg;base64,' + b64; },
      // redesenha sempre: o canvas só gera quadros de vídeo quando é pintado
      start() { mr.start(1000); setInterval(() => window.rec.last && ctx.drawImage(window.rec.last, 0, 0, ${W}, ${H}), 33); },
      stop() { return new Promise((r) => { mr.onstop = async () => { window.buf = new Uint8Array(await new Blob(chunks, { type: 'video/mp4' }).arrayBuffer()); r(window.buf.length); }; mr.stop(); }); },
      slice(i, n) { const b = window.buf.subarray(i, i + n); let s = ''; for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000)); return btoa(s); },
    };
    return type;
  })()`);

  await player.send('Page.bringToFront'); // o navegador só envia quadros da aba que está na frente
  let frames = 0;
  player.on('Page.screencastFrame', ({ data, sessionId }) => {
    frames++;
    rec.send('Runtime.evaluate', { expression: `rec.frame(${JSON.stringify(data)})` }).catch(() => {});
    player.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await player.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(800);
  await rec.eval('rec.start()');
  await sleep(600);
  await player.eval('window.__start()');
  const t0 = Date.now();
  // reserva: se a transmissão de quadros não vier, tira prints seguidos (~12 por segundo)
  let polling = false;
  setTimeout(async () => {
    if (frames > 5) return;
    polling = true;
    while (polling) {
      try { const { data } = await player.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }); frames++; rec.send('Runtime.evaluate', { expression: `rec.frame(${JSON.stringify(data)})` }).catch(() => {}); } catch {}
      await sleep(80);
    }
  }, 1500);
  process.stdout.write('Gravando');
  while (!(await player.eval('!!window.__done'))) {
    if (Date.now() - t0 > 5 * 60e3) throw new Error('Tempo esgotado.');
    process.stdout.write('.');
    await sleep(2000);
  }
  await sleep(1800); // segura a última cena
  polling = false;
  await player.send('Page.stopScreencast');
  const size = await rec.eval('rec.stop()');
  const parts = [];
  const N = 1_500_000;
  for (let i = 0; i < size; i += N) parts.push(Buffer.from(await rec.eval(`rec.slice(${i}, ${N})`), 'base64'));
  // o navegador grava em pedaços (MP4 fragmentado); junta num MP4 comum com duração e busca
  const fixed = remux(Buffer.concat(parts));
  fs.writeFileSync(OUT, fixed.buffer);
  console.log(`\n✓ ${OUT} (${(fixed.buffer.length / 1e6).toFixed(1)} MB, ${fixed.seconds.toFixed(1)} s de vídeo, ${fixed.samples} quadros)`);
}

main()
  .catch((e) => { console.error('\nFalhou:', e.message); process.exitCode = 1; })
  .finally(() => { browser.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500); });
