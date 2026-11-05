// Converte MP4 fragmentado (gravado pelo navegador) em MP4 comum, com duração e busca
// funcionando no iPhone, WhatsApp e players em geral. Suporta uma trilha de vídeo.
const u32 = (b, o) => b.readUInt32BE(o);
const type = (b, o) => b.toString('latin1', o + 4, o + 8);

function boxes(buf, start = 0, end = buf.length) {
  const out = [];
  for (let o = start; o + 8 <= end;) {
    let size = u32(buf, o), hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(o + 8)); hdr = 16; }
    else if (size === 0) size = end - o;
    out.push({ type: type(buf, o), start: o, end: o + size, body: o + hdr });
    o += size;
  }
  return out;
}
const child = (buf, box, name) => boxes(buf, box.body, box.end).find((b) => b.type === name);
const raw = (buf, box) => buf.subarray(box.start, box.end);

function box(name, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const h = Buffer.alloc(8);
  h.writeUInt32BE(body.length + 8, 0);
  h.write(name, 4, 'latin1');
  return Buffer.concat([h, body]);
}
const full = (name, version, flags, body) => { const h = Buffer.alloc(4); h.writeUInt32BE((version << 24) | flags, 0); return box(name, h, body); };
const ints = (arr) => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeInt32BE(v | 0, i * 4)); return b; };

/** Atualiza o campo de duração de mvhd / tkhd / mdhd (versões 0 e 1) */
function withDuration(buf, b, duration, kind) {
  const copy = Buffer.from(raw(buf, b));
  const v = copy[8];
  const off = kind === 'tkhd' ? (v ? 8 + 4 + 8 + 8 + 4 + 4 : 8 + 4 + 4 + 4 + 4 + 4) : v ? 8 + 4 + 8 + 8 + 4 : 8 + 4 + 4 + 4 + 4;
  if (v) copy.writeBigUInt64BE(BigInt(duration), off); else copy.writeUInt32BE(duration >>> 0, off);
  return copy;
}

export function remux(buf) {
  const top = boxes(buf);
  const ftyp = top.find((b) => b.type === 'ftyp');
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('MP4 sem moov');
  if (!top.some((b) => b.type === 'moof')) return buf; // já é comum

  const mvhd = child(buf, moov, 'mvhd');
  const movieScale = u32(buf, mvhd.body + (buf[mvhd.body] ? 20 : 12));
  const trak = child(buf, moov, 'trak');
  const tkhd = child(buf, trak, 'tkhd');
  const mdia = child(buf, trak, 'mdia');
  const mdhd = child(buf, mdia, 'mdhd');
  const mediaScale = u32(buf, mdhd.body + (buf[mdhd.body] ? 20 : 12));
  const hdlr = child(buf, mdia, 'hdlr');
  const minf = child(buf, mdia, 'minf');
  const stbl = child(buf, minf, 'stbl');
  const stsd = child(buf, stbl, 'stsd');
  const mvex = child(buf, moov, 'mvex');
  const trex = mvex && child(buf, mvex, 'trex');
  const tx = trex ? { dur: u32(buf, trex.body + 12), size: u32(buf, trex.body + 16), flags: u32(buf, trex.body + 20) } : { dur: 0, size: 0, flags: 0 };

  // lê todas as amostras dos fragmentos
  const samples = [];
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of boxes(buf, moof.body, moof.end).filter((b) => b.type === 'traf')) {
      const tfhd = child(buf, traf, 'tfhd');
      const tf = u32(buf, tfhd.body) & 0xffffff;
      let p = tfhd.body + 8;
      let base = moof.start;
      if (tf & 0x1) { base = Number(buf.readBigUInt64BE(p)); p += 8; }
      if (tf & 0x2) p += 4;
      const dDur = tf & 0x8 ? u32(buf, (p += 4) - 4) : tx.dur;
      const dSize = tf & 0x10 ? u32(buf, (p += 4) - 4) : tx.size;
      const dFlags = tf & 0x20 ? u32(buf, (p += 4) - 4) : tx.flags;
      for (const trun of boxes(buf, traf.body, traf.end).filter((b) => b.type === 'trun')) {
        const v = buf[trun.body], f = u32(buf, trun.body) & 0xffffff;
        const count = u32(buf, trun.body + 4);
        let q = trun.body + 8;
        let dataOff = base;
        if (f & 0x1) { dataOff = base + buf.readInt32BE(q); q += 4; }
        let firstFlags = null;
        if (f & 0x4) { firstFlags = u32(buf, q); q += 4; }
        let at = dataOff;
        for (let i = 0; i < count; i++) {
          const dur = f & 0x100 ? u32(buf, (q += 4) - 4) : dDur;
          const size = f & 0x200 ? u32(buf, (q += 4) - 4) : dSize;
          let flags = f & 0x400 ? u32(buf, (q += 4) - 4) : i === 0 && firstFlags != null ? firstFlags : dFlags;
          const cto = f & 0x800 ? (v ? buf.readInt32BE((q += 4) - 4) : u32(buf, (q += 4) - 4)) : 0;
          samples.push({ dur, size, sync: !(flags & 0x10000), cto, data: buf.subarray(at, at + size) });
          at += size;
        }
      }
    }
  }
  if (!samples.length) throw new Error('nenhuma amostra encontrada');
  // última amostra às vezes vem com duração 0
  const avg = Math.round(samples.reduce((s, x) => s + x.dur, 0) / Math.max(1, samples.filter((x) => x.dur).length));
  samples.forEach((s) => { if (!s.dur) s.dur = avg; });
  const mediaDur = samples.reduce((s, x) => s + x.dur, 0);
  const movieDur = Math.round((mediaDur * movieScale) / mediaScale);

  // tabelas
  const stts = []; for (const s of samples) { const l = stts[stts.length - 1]; if (l && l[1] === s.dur) l[0]++; else stts.push([1, s.dur]); }
  const hasCtts = samples.some((s) => s.cto);
  const ctts = []; for (const s of samples) { const l = ctts[ctts.length - 1]; if (l && l[1] === s.cto) l[0]++; else ctts.push([1, s.cto]); }
  const sync = samples.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean);

  const build = (chunkOffset) => {
    const stblNew = box('stbl',
      raw(buf, stsd),
      full('stts', 0, 0, Buffer.concat([ints([stts.length]), ints(stts.flat())])),
      hasCtts ? full('ctts', 1, 0, Buffer.concat([ints([ctts.length]), ints(ctts.flat())])) : Buffer.alloc(0),
      sync.length < samples.length ? full('stss', 0, 0, Buffer.concat([ints([sync.length]), ints(sync)])) : Buffer.alloc(0),
      full('stsc', 0, 0, ints([1, 1, samples.length, 1])),
      full('stsz', 0, 0, Buffer.concat([ints([0, samples.length]), ints(samples.map((s) => s.size))])),
      full('stco', 0, 0, ints([1, chunkOffset])),
    );
    const minfNew = box('minf', ...boxes(buf, minf.body, minf.end).filter((b) => b.type !== 'stbl').map((b) => raw(buf, b)), stblNew);
    const mdiaNew = box('mdia', withDuration(buf, mdhd, mediaDur, 'mdhd'), raw(buf, hdlr), minfNew);
    const trakNew = box('trak', withDuration(buf, tkhd, movieDur, 'tkhd'), ...boxes(buf, trak.body, trak.end).filter((b) => !['tkhd', 'mdia', 'edts'].includes(b.type)).map((b) => raw(buf, b)), mdiaNew);
    return box('moov', withDuration(buf, mvhd, movieDur, 'mvhd'), trakNew);
  };
  const head = ftyp ? raw(buf, ftyp) : box('ftyp', 'isom', Buffer.alloc(4), 'isomavc1');
  // moov antes do mdat ("faststart"): começa a tocar antes de baixar tudo
  let moovBuf = build(0);
  const mdatHeader = 8;
  moovBuf = build(head.length + moovBuf.length + mdatHeader);
  const mdat = box('mdat', ...samples.map((s) => s.data));
  return { buffer: Buffer.concat([head, moovBuf, mdat]), seconds: mediaDur / mediaScale, samples: samples.length };
}

// uso direto: node scripts/mp4-remux.js entrada.mp4 [saida.mp4]
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const fs = await import('node:fs');
  const [inp, out = inp] = process.argv.slice(2);
  const r = remux(fs.readFileSync(inp));
  fs.writeFileSync(out, r.buffer);
  console.log(`✓ ${out}: ${r.seconds.toFixed(1)} s, ${r.samples} quadros`);
}
