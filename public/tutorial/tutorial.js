// Tutorial animado: conectar o WhatsApp pelo celular (código) e como o robô funciona
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const screen = $('#screen'), tap = $('#tap'), caption = $('#caption'), chapter = $('#chapter');
  const phone = $('.phone');

  // ---------------------------------------------------------------- Telas
  const CODE = 'K7P4-X9QM';
  const CONFIRM_MSG =
    'Olá! Tudo bem? 🤍\n\nPassando para confirmar seu atendimento, agendado para o dia 06/11/2026 (sexta-feira), às 14:00.\n\n📍 <b>Studio – Rua Aiapaina, 3A - Tatuapé</b>\n\nSerá um prazer receber você!\n\nResponda com o número:\n<b>1</b> – Confirmo meu horário ✅\n<b>2</b> – Preciso remarcar 🗓️';

  const S = {
    intro: () => `<div class="scr" style="background:linear-gradient(160deg,#4a3628,#2a221c);color:#fff">
      <div class="center"><div style="font-size:34px">✦</div><div class="big-title">Conectar o WhatsApp<br><i style="color:#e3c48f">só com o código</i></div>
      <div class="pill" style="background:rgba(255,255,255,.12);color:#f3d9a8">+ como o robô confirma</div></div></div>`,
    more: () => `<div class="scr"><div class="a-eyebrow">Esther Lino</div><div class="a-title">Mais</div>
      <div class="a-card">
        <div class="a-row"><i>🔒</i><div>Bloqueios de agenda<small>Folgas e viagens</small></div></div>
        <div class="a-row"><i>📦</i><div>Estoque de materiais<small>Entradas e saídas</small></div></div>
        <div class="a-row" data-t="wa"><i>💬</i><div>WhatsApp<small>Desconectado — toque para conectar</small></div></div>
        <div class="a-row"><i>⚙️</i><div>Ajustes<small>Horário e termo</small></div></div>
      </div></div>`,
    wa: () => `<div class="scr"><div class="a-eyebrow">Robô de confirmação</div><div class="a-title">WhatsApp</div>
      <div class="a-card a-hero"><div class="a-ico">💬</div><b>Conecte o WhatsApp do estúdio</b>
        <p>O app envia a confirmação sozinho e entende quando a cliente responde 1 ou 2.</p>
        <span class="a-btn a-btn--gold">Conectar com QR code</span>
        <span class="a-btn a-btn--ghost" data-t="num">Conectar com número</span></div></div>`,
    number: () => S.wa().replace('</div></div>', '</div></div>').replace(/<\/div>$/, '') +
      `<div class="a-dim"></div><div class="a-sheet"><div class="a-title" style="font-size:22px">Conectar com número</div>
        <div style="color:var(--ink-2);font-size:10.5px">Número do WhatsApp do estúdio:</div>
        <div class="a-input" data-type></div><span class="a-btn a-btn--gold" data-t="gen">Gerar código</span></div></div>`,
    code: () => `<div class="scr"><div class="a-eyebrow">Robô de confirmação</div><div class="a-title">WhatsApp</div>
      <div class="a-card" style="padding:14px"><div class="a-label" style="margin:0">Seu código</div><div class="a-code">${CODE}</div>
      <div style="color:var(--ink-2);font-size:10.5px;line-height:1.5">1. Toque na notificação do WhatsApp<br>2. ou: Configurações → Aparelhos conectados → Conectar com número de telefone<br>3. Digite o código</div></div></div>`,
    notif: (show = true) => `<div class="scr"><div class="w-lock"><div class="clock">9:41</div>
      ${show ? `<div class="w-notif" data-t="notif"><small>WhatsApp · agora</small><b>Insira o código para conectar um aparelho</b><span style="font-size:10.5px;color:#444">Toque para digitar o código de 8 caracteres.</span></div>` : ''}</div></div>`,
    settings: (step = 0) => `<div class="scr"><div class="w-top">${step ? '‹ Aparelhos conectados' : 'Configurações'}</div>
      ${step === 0 ? `<div class="w-list"><div class="w-item"><i>👤</i>Conta</div><div class="w-item"><i>🔒</i>Privacidade</div><div class="w-item"><i>💬</i>Conversas</div>
        <div class="w-item" data-t="linked"><i>💻</i>Aparelhos conectados</div><div class="w-item"><i>🔔</i>Notificações</div></div>`
      : `<div style="text-align:center;padding:24px 10px;color:#555"><div style="font-size:40px">💻📱</div><p style="font-size:11px">Use o WhatsApp em outros aparelhos.</p>
        <span class="a-btn" style="background:#1f8f4e;color:#fff" data-t="link">Conectar um aparelho</span></div>`}</div>`,
    camera: () => `<div class="scr"><div class="w-cam"><div style="font-weight:800">Escaneie o QR code</div><div class="w-frame"></div>
      <div class="w-link" data-t="phone">Conectar com número de telefone</div></div></div>`,
    enter: (typed = '', done = false) => done
      ? `<div class="scr"><div class="w-top">Aparelhos conectados</div><div class="w-ok"><div class="big">✓</div><b>Aparelho conectado</b><p style="color:#666;font-size:11px">Chrome (Mac OS) · ativo agora</p></div></div>`
      : `<div class="scr"><div class="w-top">Insira o código</div><p style="text-align:center;color:#555;font-size:11px;margin-top:22px">Digite o código exibido no outro aparelho.</p>
        <div class="w-boxes">${[...CODE].map((c, i) => (c === '-' ? '<span class="dash">-</span>' : `<span>${typed.replace('-', '')[i > 4 ? i - 1 : i] || ''}</span>`)).join('')}</div></div>`,
    connected: () => `<div class="scr"><div class="a-eyebrow">Robô de confirmação</div><div class="a-title">WhatsApp</div>
      <div class="a-card" style="padding:14px;display:flex;align-items:center;gap:10px"><span class="a-dot"></span><div><b style="font-size:12.5px">WhatsApp conectado</b><div style="color:var(--ink-2);font-size:10.5px">+55 11 99999-0000</div></div></div>
      <div class="a-label" style="margin-top:14px">Confirmações · amanhã</div>
      <div class="a-appt"><b>14:00 · Maria Silva</b><span>Lash lifting</span><br><span class="badge" style="background:#efece8;color:#8b857f">Aguardando envio</span></div></div>`,
    auto: (on = false, mode = 0, toast = false) => `<div class="scr"><div class="a-eyebrow">WhatsApp</div><div class="a-title" style="font-size:24px">Envio automático</div>
      <div class="a-card" style="padding:12px"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:11.5px">Enviar confirmações sozinho</b><span class="a-switch ${on ? 'on' : ''}" data-t="sw"></span></div>
        <div class="a-label">Quando</div><div class="a-seg"><span class="${mode === 0 ? 'on' : ''}">No dia</span><span class="${mode === 1 ? 'on' : ''}" data-t="eve">Na véspera</span></div>
        <div class="a-label">A partir das</div><div class="a-input" style="font-size:12px">18:00</div>
        <span class="a-btn a-btn--gold" data-t="save">Salvar envio automático</span></div>
      ${toast ? '<div class="a-toast">✓ Envio automático ligado</div>' : ''}</div>`,
    chat: (name, initials) => `<div class="scr"><div class="w-chat-head"><span class="av">${initials}</span><div><b>${name}</b><small>online</small></div></div><div class="w-chat" data-chat></div></div>`,
    agenda: (badge) => `<div class="scr"><div class="a-eyebrow">Sexta-feira</div><div class="a-title">6 de novembro</div>
      <div class="a-appt" style="--c:${badge === 'conf' ? '#6c8a68' : '#c29a52'}"><b>14:00 · Maria Silva</b><span>Lash lifting</span><br><span class="badge ${badge === 'conf' ? 'conf' : ''}">${badge === 'conf' ? '● Confirmada · pelo WhatsApp' : '● Agendada'}</span></div>
      <div class="a-appt"><b>16:00 · Ana Paula Souza</b><span>Extensão de cílios</span><br><span class="badge">● Agendada</span>${badge === 'rem' ? ' <span class="badge rem">Pediu para remarcar</span>' : ''}</div></div>`,
    end: () => `<div class="scr" style="background:linear-gradient(160deg,#4a3628,#2a221c);color:#fff"><div class="center"><div style="font-size:40px">✨</div>
      <div class="big-title">Pronto!</div><p style="font-size:11.5px;opacity:.8;line-height:1.6;padding:0 10px">O robô confirma sozinho.<br>Você só cuida das clientes que pedirem para remarcar.</p></div></div>`,
  };

  // ---------------------------------------------------------------- Ações
  let timers = [];
  let speed = 1;
  const at = (ms, fn) => timers.push(setTimeout(fn, ms / speed));
  const show = (html) => { screen.innerHTML = html; };
  const tapOn = (sel) => {
    const el = screen.querySelector(`[data-t="${sel}"]`);
    if (!el) return;
    const p = phone.getBoundingClientRect(), r = el.getBoundingClientRect();
    tap.style.left = `${r.left - p.left + r.width / 2 - 22}px`;
    tap.style.top = `${r.top - p.top + r.height / 2 - 22}px`;
    el.classList.add('hl');
    tap.classList.remove('is-on'); void tap.offsetWidth; tap.classList.add('is-on');
  };
  const typeInto = (sel, text, start, step = 110) => {
    [...text].forEach((_, i) => at(start + i * step, () => {
      const el = screen.querySelector(sel);
      if (el) el.innerHTML = `${text.slice(0, i + 1)}<span class="cur"></span>`;
    }));
  };
  const msg = (dir, html, opts = {}) => {
    const chat = screen.querySelector('[data-chat]');
    if (!chat) return;
    chat.querySelector('.typing')?.remove();
    const d = document.createElement('div');
    d.className = `msg ${dir}`;
    d.innerHTML = `${opts.bot ? '<span class="bot">🤖 robô Agenda Expert</span>' : ''}${html}<time>${opts.time || '18:00'}${dir === 'out' ? ' ✓✓' : ''}</time>`;
    chat.appendChild(d);
  };
  const typing = (left = true) => {
    const chat = screen.querySelector('[data-chat]');
    if (!chat) return;
    const t = document.createElement('div');
    t.className = 'typing';
    if (!left) t.style.alignSelf = 'flex-end';
    t.innerHTML = '<i></i><i></i><i></i>';
    chat.appendChild(t);
  };

  // ---------------------------------------------------------------- Cenas
  const scenes = [
    { ch: 'Introdução', cap: 'Vamos conectar o WhatsApp do estúdio <b>usando só o celular</b> — sem QR code.', dur: 4500, run: () => show(S.intro()) },
    { ch: 'Parte 1 · No app', cap: 'No Agenda Expert, toque em <b>Mais</b> e depois em <b>WhatsApp</b>.', dur: 5000, run: () => { show(S.more()); at(1800, () => tapOn('wa')); } },
    { ch: 'Parte 1 · No app', cap: 'Toque em <b>Conectar com número</b>. (O QR code é para quando o app está no computador.)', dur: 5500, run: () => { show(S.wa()); at(2400, () => tapOn('num')); } },
    { ch: 'Parte 1 · No app', cap: 'Digite o <b>número do WhatsApp do estúdio</b>, com DDD, e toque em <b>Gerar código</b>.', dur: 7000, run: () => { show(S.number()); typeInto('[data-type]', '(11) 99999-0000', 700); at(4900, () => tapOn('gen')); } },
    { ch: 'Parte 1 · No app', cap: 'O app mostra um <b>código de 8 letras</b>. Deixe essa tela aberta.', dur: 6000, run: () => show(S.code()) },
    { ch: 'Parte 2 · No WhatsApp', cap: 'O WhatsApp manda uma <b>notificação pedindo o código</b>. Toque nela.', dur: 5500, run: () => { show(S.notif(false)); at(900, () => show(S.notif(true))); at(3300, () => tapOn('notif')); } },
    { ch: 'Parte 2 · No WhatsApp', cap: 'Não chegou? Abra <b>Configurações → Aparelhos conectados → Conectar um aparelho</b>.', dur: 7000, run: () => { show(S.settings(0)); at(1700, () => tapOn('linked')); at(3000, () => show(S.settings(1))); at(4800, () => tapOn('link')); } },
    { ch: 'Parte 2 · No WhatsApp', cap: 'Na câmera, toque em <b>Conectar com número de telefone</b>, lá embaixo.', dur: 5000, run: () => { show(S.camera()); at(2400, () => tapOn('phone')); } },
    { ch: 'Parte 2 · No WhatsApp', cap: 'Digite o <b>código de 8 letras</b> que o app mostrou…', dur: 7000, run: () => {
      show(S.enter(''));
      [...CODE.replace('-', '')].forEach((_, i) => at(700 + i * 380, () => show(S.enter(CODE.replace('-', '').slice(0, i + 1)))));
      at(4900, () => show(S.enter('', true)));
    } },
    { ch: 'Parte 3 · Pronto', cap: '…e volte ao app: <b>WhatsApp conectado!</b> ✅', dur: 5000, run: () => show(S.connected()) },
    { ch: 'Parte 3 · Ligar o robô', cap: 'Ligue o <b>envio automático</b>, escolha <b>no dia</b> ou <b>na véspera</b> e o horário. Salve.', dur: 7500, run: () => {
      show(S.auto(false, 0)); at(1400, () => tapOn('sw')); at(1900, () => show(S.auto(true, 0)));
      at(3300, () => tapOn('eve')); at(3800, () => show(S.auto(true, 1))); at(5300, () => tapOn('save')); at(5800, () => show(S.auto(true, 1, true)));
    } },
    { ch: 'Como o robô funciona', cap: 'No horário escolhido, o robô <b>manda a confirmação sozinho</b> para cada cliente, com data e horário.', dur: 7500, run: () => {
      show(S.chat('Maria Silva', 'MS')); at(800, () => typing(false)); at(2400, () => msg('out', CONFIRM_MSG, { bot: true }));
    } },
    { ch: 'Como o robô funciona', cap: 'A cliente responde <b>1</b> (ou “confirmo”, “sim”)… e o robô agradece na hora.', dur: 7500, run: () => {
      show(S.chat('Maria Silva', 'MS')); msg('out', CONFIRM_MSG, { bot: true });
      at(1300, () => typing()); at(2600, () => msg('in', '1', { time: '18:04' }));
      at(3800, () => typing(false)); at(5200, () => msg('out', 'Perfeito, Maria! Seu horário de 06/11/2026 (sexta-feira) às 14:00 está confirmado ✨ Até lá! 🤍', { bot: true, time: '18:04' }));
    } },
    { ch: 'Como o robô funciona', cap: '…e na agenda o atendimento vira <b>Confirmada</b>, sem você fazer nada.', dur: 5500, run: () => { show(S.agenda('none')); at(1800, () => show(S.agenda('conf'))); } },
    { ch: 'Como o robô funciona', cap: 'Se ela responder <b>2</b> ou “preciso remarcar”, o robô avisa que você vai chamar…', dur: 7000, run: () => {
      show(S.chat('Ana Paula Souza', 'AP')); msg('out', CONFIRM_MSG.replace('às 14:00', 'às 16:00'), { bot: true });
      at(1200, () => typing()); at(2500, () => msg('in', 'Preciso remarcar 😕', { time: '18:10' }));
      at(3700, () => typing(false)); at(5000, () => msg('out', 'Sem problemas, Ana! Já avisei aqui e logo te chamo para encontrarmos um novo horário 🤍', { bot: true, time: '18:10' }));
    } },
    { ch: 'Como o robô funciona', cap: '…e a agenda mostra <b>Pediu para remarcar</b>. O horário não é cancelado sozinho.', dur: 5000, run: () => { show(S.agenda('conf')); at(1500, () => show(S.agenda('rem').replace('--c:#c29a52', '--c:#6c8a68'))); } },
    { ch: 'Como o robô funciona', cap: 'Qualquer outra mensagem? O robô <b>fica em silêncio</b> — a conversa é sua.', dur: 6000, run: () => {
      show(S.chat('Ana Paula Souza', 'AP')); at(1000, () => typing()); at(2300, () => msg('in', 'Qual o endereço mesmo?', { time: '18:12' }));
    } },
    { ch: 'Fim', cap: '<b>Pronto!</b> Dúvidas? Veja o passo a passo com prints logo abaixo. ✨', dur: 5000, run: () => show(S.end()) },
  ];

  // ---------------------------------------------------------------- Player
  const total = scenes.reduce((s, x) => s + x.dur, 0);
  const starts = scenes.map((_, i) => scenes.slice(0, i).reduce((s, x) => s + x.dur, 0));
  let idx = 0, playing = false, sceneStart = 0, raf;
  const fill = $('#fill'), time = $('#time'), playBtn = $('#play');
  $('#marks').innerHTML = starts.slice(1).map((s) => `<i style="left:${(s / total) * 100}%"></i>`).join('');
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

  function go(i, autoplay = playing) {
    timers.forEach(clearTimeout); timers = [];
    idx = Math.max(0, Math.min(scenes.length - 1, i));
    const s = scenes[idx];
    chapter.textContent = `${s.ch} · ${idx + 1}/${scenes.length}`;
    caption.innerHTML = s.cap;
    tap.classList.remove('is-on');
    s.run();
    sceneStart = performance.now();
    if (autoplay) at(s.dur, () => (idx < scenes.length - 1 ? go(idx + 1, true) : stop(true)));
    else { timers.forEach(clearTimeout); timers = []; staticRender(s); }
    tick();
  }
  // pausado: mostra o estado final da cena
  function staticRender(s) {
    const saveSpeed = speed;
    speed = 1e6; s.run(); speed = saveSpeed;
  }
  function tick() {
    cancelAnimationFrame(raf);
    const elapsed = playing ? Math.min(scenes[idx].dur, (performance.now() - sceneStart) * speed) : 0;
    const t = starts[idx] + elapsed;
    fill.style.width = `${(t / total) * 100}%`;
    time.textContent = fmt(t);
    if (playing) raf = requestAnimationFrame(tick);
  }
  function play() { playing = true; playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', 'Pausar'); go(idx >= scenes.length - 1 && fill.style.width === '100%' ? 0 : idx, true); }
  function stop(ended = false) {
    playing = false; playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', 'Reproduzir');
    timers.forEach(clearTimeout); timers = [];
    if (ended) { fill.style.width = '100%'; time.textContent = fmt(total); window.__done = true; } else tick();
  }
  playBtn.onclick = () => (playing ? stop() : play());
  $('#prev').onclick = () => go(idx - 1);
  $('#next').onclick = () => go(idx + 1);
  $('#speed').onclick = (e) => { speed = speed === 1 ? 1.5 : speed === 1.5 ? 0.75 : 1; e.currentTarget.textContent = `${speed}x`; if (playing) go(idx, true); };
  $('#bar').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * total;
    let i = starts.findIndex((s, k) => t >= s && t < s + scenes[k].dur);
    go(i < 0 ? scenes.length - 1 : i);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
    if (e.key === 'ArrowRight') go(idx + 1);
    if (e.key === 'ArrowLeft') go(idx - 1);
  });

  // telas ilustrativas fixas do passo a passo
  const mini = { notif: () => S.notif(true), settings: () => S.settings(0), camera: () => S.camera(), code: () => S.enter(CODE.replace('-', '').slice(0, 5)) };
  document.querySelectorAll('[data-mini]').forEach((el) => { el.innerHTML = mini[el.dataset.mini](); el.querySelector('[data-t="linked"], [data-t="phone"]')?.classList.add('hl'); });

  go(0, false);
  // modo gravação (?rec): tela cheia vertical, quem grava chama window.__start()
  if (new URLSearchParams(location.search).has('rec')) {
    document.body.classList.add('rec');
    window.__start = () => play();
  } else if ('IntersectionObserver' in window) {
    // começa sozinho quando o player aparece na tela
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting && !playing && idx === 0) { play(); io.disconnect(); } }, { threshold: 0.6 });
    io.observe($('.player'));
  }
})();
