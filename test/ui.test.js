// Testes das funções de formatação da interface (pt-BR, R$, datas) — RNF09
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ambiente mínimo de navegador para importar o módulo
globalThis.document = { addEventListener() {}, getElementById() { return null; } };
globalThis.window = { dispatchEvent() {} };
const ui = await import('../public/js/ui.js');

const nb = (s) => s.replace(/ /g, ' ');

test('valores em Real (R$)', () => {
  assert.equal(nb(ui.money(17000)), 'R$ 170,00');
  assert.equal(nb(ui.money(123456)), 'R$ 1.234,56');
  assert.equal(nb(ui.money(-29050)), '-R$ 290,50');
  assert.equal(ui.moneyShort(425000), 'R$ 4.250');
  assert.equal(ui.centsToInput(17050), '170,50');
  assert.equal(ui.centsToInput(null), '');
});

test('leitura de valores digitados', () => {
  assert.equal(ui.parseMoney('170,50'), 17050);
  assert.equal(ui.parseMoney('R$ 1.234,56'), 123456);
  assert.equal(ui.parseMoney('45'), 4500);
  assert.equal(ui.parseMoney('45.5'), 4550);
  assert.ok(Number.isNaN(ui.parseMoney('')));
  assert.ok(Number.isNaN(ui.parseMoney('abc')));
});

test('datas no formato dd/mm/aaaa e por extenso', () => {
  assert.equal(ui.fmtDate('2026-11-05'), '05/11/2026');
  assert.equal(ui.fmtDayLong('2026-11-05'), 'Quinta, 5 de novembro');
  assert.equal(ui.fmtDayShort('2026-12-20'), '20 dez');
  assert.equal(ui.fmtMonth('2026-03'), 'Março 2026');
});

test('aritmética de datas (virada de mês, ano e bissexto)', () => {
  assert.equal(ui.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(ui.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(ui.addMonths('2026-01-31', 1), '2026-02-01');
  assert.equal(ui.addMonths('2026-01-15', -1), '2025-12-01');
  assert.equal(ui.startOfWeek('2026-11-05'), '2026-11-01');
  assert.equal(ui.daysInMonth(2028, 2), 29);
  assert.equal(ui.dow('2026-11-05'), 4);
});

test('durações e horários', () => {
  assert.equal(ui.fmtDuration(150), '2h30');
  assert.equal(ui.fmtDuration(120), '2h');
  assert.equal(ui.fmtDuration(45), '45 min');
  assert.equal(ui.toMin('13:45'), 825);
  assert.equal(ui.fromMin(825), '13:45');
});

test('máscara de telefone e link de WhatsApp', () => {
  assert.equal(ui.maskPhone('11999990000'), '(11) 99999-0000');
  assert.equal(ui.maskPhone('1133334444'), '(11) 3333-4444');
  assert.equal(ui.maskPhone('11'), '(11');
  assert.equal(ui.waLink('(11) 99999-0000'), 'https://wa.me/5511999990000');
  assert.equal(ui.waLink('+55 11 99999-0000'), 'https://wa.me/5511999990000');
});

test('escape de HTML evita injeção de código (XSS)', () => {
  assert.equal(ui.esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(ui.esc(null), '');
  assert.equal(ui.initials('ana paula souza'), 'AP');
});

test('status com nome em texto (não só cor) — RSIS06', () => {
  for (const s of ['agendada', 'confirmada', 'concluida', 'cancelada', 'faltou']) {
    const html = ui.statusBadge(s);
    assert.match(html, new RegExp(`st-${s}`));
    assert.match(html, />[A-ZÁ-Ú][^<]+<\/span>$/);
  }
});

test('rotas do app (hash)', () => {
  globalThis.location = { hash: '#/agenda?v=dia&d=2026-11-05' };
  assert.deepEqual(ui.parseHash(), { parts: ['agenda'], query: { v: 'dia', d: '2026-11-05' } });
  globalThis.location = { hash: '' };
  assert.deepEqual(ui.parseHash().parts, ['agenda']);
  assert.equal(ui.qs({ m: '2026-11', tipo: '', cat: null }), '?m=2026-11');
});

test('WhatsApp: mensagem pronta com data, horário e nome', () => {
  const a = { client_name: 'Ana Paula Souza', date: '2026-11-05', start: '11:00', end: '13:00', total_cents: 17000, procedures: [{ name: 'Extensão de cílios' }] };
  const msg = ui.waMessage('Oi [nome]! Dia [data], às [horário] ([HORARIO]) — [procedimento], [valor]. [outro]', a);
  assert.equal(nb(msg), 'Oi Ana! Dia 05/11/2026 (quinta-feira), às 11:00 (11:00) — Extensão de cílios, R$ 170,00. [outro]');
  assert.match(ui.waMessage('[data]', { ...a, date: '2026-11-07' }), /\(sábado\)/);
  assert.match(ui.waMessage('[data]', { ...a, date: '2026-11-08' }), /\(domingo\)/);
  assert.equal(ui.waMessage('', a), '');
});

test('WhatsApp: link gratuito wa.me com o texto codificado (emojis e quebras de linha)', () => {
  const url = ui.waLink('(11) 99999-0000', 'Olá! 🤍\n*Studio*');
  assert.ok(url.startsWith('https://wa.me/5511999990000?text='));
  assert.equal(decodeURIComponent(url.split('?text=')[1]), 'Olá! 🤍\n*Studio*');
  assert.equal(ui.waLink('(11) 99999-0000'), 'https://wa.me/5511999990000');
});
