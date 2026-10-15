'use strict';
/* Cinese di Mia — allenamento HSK 2 / HSK 3 / HSKK (standard HSK 2.0).
   Tutto gira nel browser; i progressi restano sul dispositivo (localStorage). */

const EXAM_ISO = '2026-11-07';
const LS_KEY = 'hskmia.v1';
const INTERVALS = [1, 1, 2, 4, 7, 12]; // giorni di attesa per casella 0..5
const MAX_BOX = 5;
const SOLID = 4;            // da questa casella la parola è «consolidata»
const FAST_MS = 5000;       // risposta giusta entro 5 s = richiamo veloce
const NEW_END = { 3: 4, 12: 10 }; // parole nuove finite N giorni prima dell'esame (HSK 3 / HSK 1-2)
const NEW_CAP = { 3: 20, 12: 25 };
const SESSION = { srs: 44, write: 3, sent: 2, dialog: 1, tf: 1, reorder: 1, hskkRepeat: 2, hskkQ: 1 };

let W = [], WBY = {}, C = null, MI = {}, S = null;
let view = 'home';
let SESS = null;

/* ---------- utilità ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = () => $('#app');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const zh = (s, cls = '') => `<span lang="zh-CN" class="${cls}">${esc(s)}</span>`;
const plainZh = s => s.replace(/ /g, '');
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sample(a, n) { return shuffle(a).slice(0, n); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const toneless = py => py.normalize('NFD').replace(/[̀-ͯ']/g, '').toLowerCase();

/* ---------- date ---------- */
function dayNum(d = new Date()) { return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }
function dayFromISO(s) { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); }
function isoFromDay(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
const EXAM = dayFromISO(EXAM_ISO);
const today = () => dayNum();
function fmtDay(n) { return new Date(n * 864e5).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }

/* ---------- stato ---------- */
function freshState() { return { v: 1, srs: {}, wr: {}, pool: {}, log: {}, pages: {}, settings: { travel: [], speed: 1, page: 1 } }; }
function load() {
  try { S = JSON.parse(localStorage.getItem(LS_KEY)) || freshState(); } catch { S = freshState(); }
  const f = freshState();
  for (const k of Object.keys(f)) if (S[k] === undefined) S[k] = f[k];
  for (const k of Object.keys(f.settings)) if (S.settings[k] === undefined) S.settings[k] = f.settings[k];
}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { toast('Attenzione: non riesco a salvare i progressi'); } }
function logToday() { const k = isoFromDay(today()); return S.log[k] || (S.log[k] = { n: 0, ok: 0, nw: { 3: 0, 12: 0 }, sec: 0 }); }

/* ---------- multimedia ---------- */
const mediaUrl = p => MI[p] ? `${p}?v=${MI[p]}` : p;
const hasMedia = p => !!MI[p];
const player = new Audio();
const mine = new Audio();
let playToken = 0;
function play(path, token = ++playToken) {
  if (path === '__gap') return sleep(1200).then(() => true); // pausa tra i due ascolti
  return new Promise(res => {
    if (!hasMedia(path) || token !== playToken) return res(false);
    mine.pause();
    player.src = mediaUrl(path);
    const rate = S.settings.speed || 1;
    player.defaultPlaybackRate = rate; player.playbackRate = rate;
    player.onended = () => res(true);
    player.onerror = () => res(false);
    player.play().catch(() => res(false));
  });
}
async function playSeq(paths, gap = 450) {
  const token = ++playToken;
  for (const p of paths) {
    if (token !== playToken) return false;
    await play(p, token);
    await sleep(gap);
  }
  return token === playToken;
}
function stopAudio() { playToken++; player.pause(); mine.pause(); }

const Rec = {
  stream: null, mr: null, chunks: [], url: null,
  supported() { return !!(navigator.mediaDevices && window.MediaRecorder); },
  async start() {
    if (!this.stream) this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const type = ['audio/mp4', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    this.mr = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.mr.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.mr.start();
  },
  stop() {
    return new Promise(res => {
      if (!this.mr || this.mr.state === 'inactive') return res(this.url);
      this.mr.onstop = () => {
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = URL.createObjectURL(new Blob(this.chunks, { type: this.mr.mimeType || 'audio/mp4' }));
        res(this.url);
      };
      this.mr.stop();
    });
  },
  release() { if (this.mr && this.mr.state !== 'inactive') this.mr.stop(); if (this.stream) this.stream.getTracks().forEach(t => t.stop()); this.stream = null; },
};
function playMine(url) { stopAudio(); if (url) { mine.src = url; mine.play().catch(() => {}); } }

/* ---------- ripetizione spaziata ---------- */
const group = w => w.lv === 3 ? 3 : 12;
function interval(box) { return Math.max(1, Math.min(INTERVALS[box], EXAM - 1 - today())); }
// Tipo di esercizio in base alla casella: la parola deve superare prove diverse per salire.
function srsKind(w) {
  const st = S.srs[w.id], b = st ? st.b : -1;
  if (w.lv === 3) {
    if (b < 1) return 'read';
    return ['read', 'tone', 'listen', 'mean', 'tone', 'listen'][b];
  }
  if (b < 1) return 'read';
  return ['read', 'listen', 'read', 'listen', 'mean', 'listen'][b];
}
function gradeSrs(w, ok, ms, retry) {
  const t = today();
  const lg = logToday();
  lg.n++; if (ok) lg.ok++;
  if (retry) return;
  let st = S.srs[w.id];
  const isNew = !st;
  if (isNew) { st = S.srs[w.id] = { b: 0, d: t, n: 0, l: 0, f: t }; lg.nw[group(w)]++; }
  st.n++;
  const fast = ms < FAST_MS;
  if (!ok) { st.l++; st.b = st.b >= 3 ? 1 : 0; st.d = t + 1; }
  else {
    if (isNew && fast) st.b = 2;            // già nota: salta i primi passaggi
    else if (fast || st.b < 2) st.b = Math.min(MAX_BOX, st.b + 1);
    st.d = t + interval(st.b);              // se lenta resta nella stessa casella
  }
  st.ms = ms;
  save();
}
function gradeWrite(w, mistakes) {
  const t = today();
  const lg = logToday(); lg.n++;
  let st = S.wr[w.id] || (S.wr[w.id] = { b: 0, d: t, n: 0, l: 0 });
  st.n++;
  if (mistakes <= 1) { lg.ok++; st.b = Math.min(MAX_BOX, st.b + 1); }
  else if (mistakes <= 4) { lg.ok++; st.b = Math.max(1, st.b); }
  else { st.l++; st.b = 0; }
  st.d = t + (mistakes > 4 ? 1 : interval(st.b));
  save();
}
function gradePool(id, ok) {
  const p = S.pool[id] || (S.pool[id] = { n: 0, ok: 0 });
  p.n++; if (ok) p.ok++;
  const lg = logToday(); lg.n++; if (ok) lg.ok++;
  save();
}
// Sceglie dal gruppo gli elementi meno visti, poi quelli sbagliati più spesso.
function pickPool(items, idOf, n) {
  return shuffle(items).map(x => {
    const p = S.pool[idOf(x)] || { n: 0, ok: 0 };
    return { x, score: p.n * 2 - (p.n - p.ok) * 3 + Math.random() };
  }).sort((a, b) => a.score - b.score).slice(0, n).map(o => o.x);
}

function travelWeight(d) {
  for (const t of S.settings.travel) {
    if (t.from && t.to && d >= dayFromISO(t.from) && d <= dayFromISO(t.to)) return 0.5;
  }
  return 1;
}
// Quante parole nuove oggi, per arrivare alla fine entro la scadenza (giorni di viaggio contano metà).
function newPlan(g) {
  const t = today(), end = EXAM - NEW_END[g];
  const lg = logToday();
  const pool = W.filter(w => group(w) === g);
  const unseen = pool.filter(w => !S.srs[w.id]).length;
  const startUnseen = unseen + (lg.nw[g] || 0);
  let wsum = 0;
  for (let d = t; d <= end; d++) wsum += travelWeight(d);
  let quota = wsum > 0 ? Math.ceil(startUnseen * travelWeight(t) / wsum) : startUnseen;
  quota = Math.min(quota, NEW_CAP[g]);
  return { quota, done: lg.nw[g] || 0, left: Math.max(0, Math.min(quota - (lg.nw[g] || 0), unseen)), unseen, end };
}
function stats(g) {
  const ws = W.filter(w => g === 'all' || group(w) === g);
  let solid = 0, learn = 0;
  for (const w of ws) { const st = S.srs[w.id]; if (!st) continue; if (st.b >= SOLID) solid++; else learn++; }
  return { total: ws.length, solid, learn, fresh: ws.length - solid - learn };
}
function dueWords() {
  const t = today();
  return W.filter(w => S.srs[w.id] && S.srs[w.id].d <= t)
    .sort((a, b) => (S.srs[a.id].d - S.srs[b.id].d) || (S.srs[a.id].b - S.srs[b.id].b));
}
// Ordine fisso ma mescolato per le parole nuove (non alfabetico).
function unseenWords(g) {
  return W.filter(w => group(w) === g && !S.srs[w.id]).sort((a, b) => hashStr(a.id + 'mia') - hashStr(b.id + 'mia'));
}
const writable = w => w.lv === 3 && [...w.hz].length === 1 && !!C.sent[w.id] && hasMedia(`strokes/${w.hz}.json`);
function dueWrites(limit) {
  const t = today();
  const due = W.filter(w => S.wr[w.id] && S.wr[w.id].d <= t).sort((a, b) => S.wr[a.id].d - S.wr[b.id].d);
  const fresh = W.filter(w => writable(w) && !S.wr[w.id] && S.srs[w.id]);
  return [...due, ...fresh].slice(0, limit);
}

/* ---------- distrattori ---------- */
function defOptions(w) {
  const len = [...w.hz].length;
  const pool = W.filter(x => x.id !== w.id && x.def !== w.def && x.hz !== w.hz);
  const same = shuffle(pool.filter(x => x.lv === w.lv && [...x.hz].length === len));
  const others = shuffle(pool);
  const picked = [];
  for (const x of [...same, ...others]) { if (picked.length === 3) break; if (!picked.some(p => p.def === x.def)) picked.push(x); }
  return shuffle([w, ...picked]);
}
function hzOptions(w) {
  const len = [...w.hz].length, tl = toneless(w.py);
  const ok = x => x.id !== w.id && x.hz !== w.hz && toneless(x.py) !== tl;
  const share = shuffle(W.filter(x => ok(x) && [...x.hz].length === len && [...x.hz].some(c => w.hz.includes(c))));
  const same = shuffle(W.filter(x => ok(x) && [...x.hz].length === len));
  const picked = [];
  for (const x of [...share.slice(0, 2), ...same]) { if (picked.length === 3) break; if (!picked.some(p => p.hz === x.hz)) picked.push(x); }
  return shuffle([w, ...picked]);
}

/* ---------- navigazione ---------- */
function go(v) {
  if (SESS) endSession(false);
  view = v;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  window.scrollTo(0, 0);
  ({ home: renderHome, train: renderTrain, progress: renderProgress, settings: renderSettings, page: () => renderPage(S.settings.page) })[v]();
}

/* ---------- OGGI ---------- */
function renderHome() {
  const t = today(), left = EXAM - t;
  const p3 = newPlan(3), p12 = newPlan(12);
  const due = dueWords().length;
  const wr = dueWrites(SESSION.write).length;
  const s3 = stats(3), s12 = stats(12);
  const lg = logToday();
  const doneToday = lg.n > 0;
  const minutes = Math.max(10, Math.min(15, Math.round((Math.min(due, SESSION.srs) + p3.left + p12.left) * 6 / 60 + 6)));
  app().innerHTML = `
    <section class="card">
      <div class="countdown"><b>${Math.max(0, left)}</b><div>
        <div><strong>${left > 0 ? 'giorni all’esame' : left === 0 ? 'oggi è il giorno dell’esame' : 'esame passato'}</strong></div>
        <div class="muted small">sabato 7 novembre · HSK 2 alle 9:00 · HSK 3 alle 13:30 · HSKK alle 15:40</div></div>
      </div>
    </section>
    ${pageCard()}
    <section class="card">
      <h2>Sessione di oggi <span class="muted small">· circa ${minutes} minuti</span></h2>
      <ul class="plan">
        <li><span>Parole nuove HSK 3</span><b>${p3.left}</b></li>
        <li><span>Parole HSK 1–2 da verificare</span><b>${p12.left}</b></li>
        <li><span>Ripassi in scadenza</span><b>${Math.min(due, SESSION.srs)}${due > SESSION.srs ? ` <span class="muted small">(+${due - SESSION.srs})</span>` : ''}</b></li>
        <li><span>Scrittura caratteri</span><b>${wr}</b></li>
        <li><span>Ascolto, riordino, orale HSKK</span><b>${SESSION.sent + SESSION.dialog + SESSION.tf + SESSION.reorder + SESSION.hskkRepeat + SESSION.hskkQ}</b></li>
      </ul>
      <button class="btn primary big" id="start">${doneToday ? 'Fai un’altra sessione' : 'Inizia la sessione di oggi'}</button>
      ${doneToday ? `<p class="muted small" style="margin:10px 0 0">Oggi: ${lg.n} esercizi, ${lg.n ? Math.round(lg.ok / lg.n * 100) : 0}% giusti, ${Math.round(lg.sec / 60)} min.</p>` : ''}
    </section>
    <section class="card">
      <h2>A che punto sei</h2>
      ${barBlock('HSK 3', s3)}
      <div style="height:12px"></div>
      ${barBlock('HSK 1–2', s12)}
      <p class="muted small" style="margin:10px 0 0">${paceLine(p3, p12)}</p>
    </section>
    <div id="offline"></div>`;
  $('#start').onclick = () => startSession(buildDaily());
  bindPageCard();
  renderOfflineBar();
}
function barBlock(label, s) {
  const pc = n => (n / s.total * 100).toFixed(1);
  return `<div class="row" style="justify-content:space-between"><b>${label}</b><span class="muted small">${s.solid} consolidate · ${s.learn} in corso · ${s.fresh} da vedere</span></div>
    <div class="bar" style="margin-top:6px"><i class="solid" style="width:${pc(s.solid)}%"></i><i class="learn" style="width:${pc(s.learn)}%"></i></div>`;
}
function paceLine(p3, p12) {
  const parts = [];
  if (p3.unseen) parts.push(`HSK 3: ${p3.quota} parole nuove al giorno bastano per finirle entro ${fmtDay(p3.end)}`);
  else parts.push('HSK 3: tutte le parole sono già state introdotte');
  if (p12.unseen) parts.push(`HSK 1–2: ${p12.quota} al giorno, finite entro ${fmtDay(p12.end)}`);
  return parts.join('. ') + '. Gli ultimi giorni sono solo ripasso.';
}

/* ---------- ALLENAMENTO LIBERO ---------- */
function renderTrain() {
  const tiles = [
    ['Vocaboli', [
      ['fc3', 'Flashcard HSK 3', 'Senza pinyin, come all’esame'],
      ['fc12', 'Flashcard HSK 1–2', 'Ripasso della base, senza pinyin'],
      ['hard', 'Parole difficili', 'Quelle sbagliate più spesso'],
    ]],
    ['Ascolto · 听力', [
      ['sent', 'Frasi', 'Ascolta e scegli il significato'],
      ['dlg3', 'Dialoghi HSK 3', 'Domanda con 3 risposte'],
      ['tf3', 'Vero o falso HSK 3', 'Ascolta e giudica la frase ★'],
      ['dlg2', 'Dialoghi HSK 2', 'Più semplici, con pinyin'],
    ]],
    ['Scrittura · 书写', [
      ['write', 'Scrivi il carattere', 'Pinyin dato, carattere da tracciare'],
      ['reorder', 'Riordina la frase', 'Come la parte 1 di 书写'],
      ['strokes', 'Ordine dei tratti', 'Guarda e ricalca qualsiasi carattere'],
    ]],
    ['Orale · HSKK', [
      ['k1', 'Ascolta e ripeti', 'Parte 1 · 听后重复'],
      ['k2', 'Ascolta e rispondi', 'Parte 2 · 听后回答'],
      ['k3', 'Domande aperte', 'Parte 3 · 回答问题'],
      ['ksim', 'Simulazione HSKK', 'Le 3 parti di fila, come all’esame'],
    ]],
  ];
  app().innerHTML = `<div class="section-title">Pagine del PDF HSK 3 · una al giorno</div>
    <div class="grid3">${pageNums().map(p => { const st = pageStats(p); return `<button class="tile" data-page="${p}">
      <b>Pagina ${p} ${S.pages[p] && S.pages[p].quiz ? '<span class="pill ok">✓</span>' : ''}</b>
      <span lang="zh-CN">${esc(pageWords(p)[0].hz)} … ${esc(pageWords(p).slice(-1)[0].hz)}</span><br><span>${st.solid}/${st.total} consolidate</span></button>`; }).join('')}</div>` + tiles.map(([title, ts]) => `
    <div class="section-title">${title}</div>
    <div class="grid3">${ts.map(([id, b, s]) => `<button class="tile" data-mode="${id}"><b>${b}</b><span>${s}</span></button>`).join('')}</div>`).join('') +
    `<p class="muted small" style="margin-top:18px">L’allenamento libero aggiorna gli stessi progressi della sessione di oggi.</p>`;
  $$('[data-mode]').forEach(b => b.onclick = () => startMode(b.dataset.mode));
  $$('[data-page]').forEach(b => b.onclick = () => renderPage(+b.dataset.page));
}
function startMode(m) {
  const L = C.listen, K = C.hskk;
  const srsItems = (pred, n) => {
    const due = dueWords().filter(pred);
    const fresh = W.filter(w => pred(w) && !S.srs[w.id]).sort((a, b) => hashStr(a.id + 'mia') - hashStr(b.id + 'mia'));
    const seen = shuffle(W.filter(w => pred(w) && S.srs[w.id] && S.srs[w.id].d > today()));
    return [...due, ...fresh, ...seen].slice(0, n).map(w => ({ t: 'srs', w, kind: srsKind(w) }));
  };
  let items = [];
  if (m === 'fc3') items = srsItems(w => w.lv === 3, 20);
  if (m === 'fc12') items = srsItems(w => w.lv < 3, 20);
  if (m === 'hard') {
    const hard = W.filter(w => S.srs[w.id] && S.srs[w.id].l > 0).sort((a, b) => S.srs[b.id].l - S.srs[a.id].l).slice(0, 20);
    if (!hard.length) return toast('Ancora nessuna parola sbagliata: ottimo!');
    items = shuffle(hard).map(w => ({ t: 'srs', w, kind: srsKind(w) }));
  }
  if (m === 'sent') items = sentItems(10);
  if (m === 'dlg3') items = pickPool(L.filter(d => d.type === 'dialog' && d.lv === 3), d => d.id, 8).map(d => ({ t: 'dlg', d }));
  if (m === 'dlg2') items = pickPool(L.filter(d => d.type === 'dialog' && d.lv === 2), d => d.id, 8).map(d => ({ t: 'dlg', d }));
  if (m === 'tf3') items = pickPool(L.filter(d => d.type === 'tf'), d => d.id, 10).map(d => ({ t: 'tf', d }));
  if (m === 'write') {
    items = dueWrites(8).map(w => ({ t: 'wr', w }));
    if (items.length < 8) items.push(...sample(W.filter(w => writable(w) && !items.some(i => i.w.id === w.id)), 8 - items.length).map(w => ({ t: 'wr', w })));
  }
  if (m === 'reorder') items = reorderItems(8);
  if (m === 'strokes') return renderStrokePicker();
  if (m === 'k1') items = pickPool(K.filter(k => k.part === 1), k => k.id, 8).map(k => ({ t: 'kr', k }));
  if (m === 'k2') items = pickPool(K.filter(k => k.part === 2), k => k.id, 6).map(k => ({ t: 'kq', k }));
  if (m === 'k3') items = pickPool(K.filter(k => k.part === 3), k => k.id, 1).map(k => ({ t: 'ko', k }));
  if (m === 'ksim') {
    const r = K.filter(k => k.part === 1).sort((a, b) => a.zh.length - b.zh.length);
    const p1 = [0, 1, 2, 3, 4].map(i => sample(r.slice(i * 9, i * 9 + 9), 3)).flat();
    items = [{ t: 'info', title: 'Simulazione HSKK elementare', text: 'Parte 1: 15 frasi da ripetere. Parte 2: 10 domande a cui rispondere. Parte 3: 2 domande aperte, circa 1 minuto e mezzo ciascuna. Registra ogni risposta e poi riascoltati.' },
      ...p1.map(k => ({ t: 'kr', k })),
      ...sample(K.filter(k => k.part === 2), 10).map(k => ({ t: 'kq', k })),
      ...sample(K.filter(k => k.part === 3), 2).map(k => ({ t: 'ko', k }))];
  }
  if (!items.length) return toast('Niente da fare qui per ora');
  startSession(items);
}
function sentItems(n) {
  const seen = W.filter(w => C.sent[w.id] && S.srs[w.id] && hasMedia(`audio/s/${w.id}.mp3`));
  const base = seen.length >= n ? seen : W.filter(w => C.sent[w.id] && hasMedia(`audio/s/${w.id}.mp3`));
  return pickPool(base, w => 's:' + w.id, n).map(w => ({ t: 'sl', w }));
}
function reorderItems(n) {
  const ok = w => { const s = C.sent[w.id]; return s && s.zh.split(' ').filter(x => !/^[，。？！]$/.test(x)).length >= 4; };
  const seen = W.filter(w => w.lv >= 2 && ok(w) && S.srs[w.id]);
  const base = seen.length >= n ? seen : W.filter(w => w.lv >= 2 && ok(w));
  return pickPool(base, w => 'r:' + w.id, n).map(w => ({ t: 'ro', w }));
}

/* ---------- costruzione della sessione di oggi ---------- */
function buildDaily() {
  const core = [];
  for (const w of dueWords().slice(0, SESSION.srs)) core.push({ t: 'srs', w, kind: srsKind(w) });
  const n3 = newPlan(3).left, n12 = newPlan(12).left;
  const fresh = [...unseenWords(3).slice(0, n3), ...unseenWords(12).slice(0, n12)];
  // Le nuove si alternano ai ripassi.
  const mixed = [];
  const a = shuffle(core), b = shuffle(fresh);
  while (a.length || b.length) {
    if (b.length) mixed.push({ t: 'srs', w: b.shift(), kind: 'read' });
    if (a.length) mixed.push(a.shift());
    if (a.length && b.length < a.length) mixed.push(a.shift());
  }
  const extras = [
    ...dueWrites(SESSION.write).map(w => ({ t: 'wr', w })),
    ...sentItems(SESSION.sent),
    ...pickPool(C.listen.filter(d => d.type === 'dialog' && (d.lv === 3 || Math.random() < .3)), d => d.id, SESSION.dialog).map(d => ({ t: 'dlg', d })),
    ...pickPool(C.listen.filter(d => d.type === 'tf'), d => d.id, SESSION.tf).map(d => ({ t: 'tf', d })),
    ...reorderItems(SESSION.reorder),
    ...pickPool(C.hskk.filter(k => k.part === 1), k => k.id, SESSION.hskkRepeat).map(k => ({ t: 'kr', k })),
    ...pickPool(C.hskk.filter(k => k.part === 2), k => k.id, SESSION.hskkQ).map(k => ({ t: 'kq', k })),
  ];
  if (today() % 3 === 0) extras.push(...pickPool(C.hskk.filter(k => k.part === 3), k => k.id, 1).map(k => ({ t: 'ko', k })));
  // Inserisce gli esercizi lunghi a intervalli regolari tra le flashcard.
  const ex = shuffle(extras);
  const out = [];
  const step = Math.max(3, Math.floor(mixed.length / (ex.length + 1)));
  mixed.forEach((it, i) => { out.push(it); if ((i + 1) % step === 0 && ex.length) out.push(ex.shift()); });
  out.push(...ex);
  return out;
}

/* ---------- motore della sessione ---------- */
function startSession(items, opts = {}) {
  if (!items.length) return toast('Per oggi è tutto fatto!');
  SESS = { items, i: 0, n: 0, ok: 0, t0: Date.now(), retried: new Set(), ...opts };
  document.body.classList.add('in-session');
  nextItem();
}
function endSession(showSummary = true) {
  if (!SESS) return;
  stopAudio(); Rec.release();
  const sec = Math.round((Date.now() - SESS.t0) / 1000);
  logToday().sec += sec; save();
  const s = SESS; SESS = null;
  document.body.classList.remove('in-session');
  if (s.onEnd) s.onEnd(s);
  if (!showSummary) return;
  if (s.page) return renderPage(s.page, s.n - s.ok ? `Fatto! ${s.n - s.ok} errori, tutti ripassati finché non erano giusti.` : `Fatto! ${s.n} risposte, nessun errore.`);
  const p3 = newPlan(3);
  app().innerHTML = `<section class="card" style="text-align:center">
    <div class="hz-mid" lang="zh-CN">做得好！</div>
    <h1>Sessione finita</h1>
    <p>${s.n} esercizi · ${s.n ? Math.round(s.ok / s.n * 100) : 0}% giusti · ${Math.max(1, Math.round(sec / 60))} min</p>
    <p class="muted">${stats(3).solid} parole HSK 3 consolidate su 300. ${p3.unseen ? `Ne restano ${p3.unseen} da introdurre.` : ''}</p>
    <div class="next-row"><button class="btn" id="home">Torna a Oggi</button><button class="btn primary" id="more">Altri 10 minuti</button></div>
  </section>`;
  $('#home').onclick = () => go('home');
  $('#more').onclick = () => { const it = buildDaily(); it.length ? startSession(it) : (toast('Ripassi finiti: prova l’allenamento libero'), go('train')); };
}
function nextItem() {
  stopAudio();
  if (SESS.i >= SESS.items.length) return endSession(true);
  const it = SESS.items[SESS.i];
  const pc = SESS.i / SESS.items.length * 100;
  app().innerHTML = `<div class="sess-head"><button class="x" id="quit" aria-label="Esci">×</button>
    <div class="bar"><i style="width:${pc}%"></i></div><span class="muted small">${SESS.i + 1}/${SESS.items.length}</span></div>
    <section class="card" id="ex"></section>`;
  $('#quit').onclick = () => { const p = SESS.page; endSession(false); p ? renderPage(p) : go('home'); };
  window.scrollTo(0, 0);
  RENDER[it.t](it, $('#ex'));
}
// Chiude un esercizio: aggiorna il conteggio e mostra il pulsante per andare avanti.
function finish(it, ok, box, extraBtn) {
  SESS.n++; if (ok) SESS.ok++;
  if (!ok && it.loop) SESS.items.push({ ...it, retry: true }); // pagina: torna finché non è giusta
  else if (!ok && it.t === 'srs' && !it.retry && !SESS.retried.has(it.w.id)) {
    SESS.retried.add(it.w.id);
    const pos = Math.min(SESS.items.length, SESS.i + 4);
    SESS.items.splice(pos, 0, { t: 'srs', w: it.w, kind: 'read', retry: true });
  }
  const row = document.createElement('div');
  row.className = 'next-row';
  row.innerHTML = `${extraBtn || ''}<button class="btn primary" id="next">Continua</button>`;
  box.appendChild(row);
  $('#next').onclick = () => { SESS.i++; nextItem(); };
  $('#next').focus({ preventScroll: true });
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- blocchi comuni ---------- */
function wordCard(w, { showPy = true } = {}) {
  const s = C.sent[w.id];
  const wa = `audio/w/${w.id}.mp3`, sa = `audio/s/${w.id}.mp3`;
  return `<div class="row"><span class="hz-mid" lang="zh-CN">${esc(w.hz)}</span>
      ${hasMedia(wa) ? `<button class="speak sm" data-play="${wa}" aria-label="Ascolta">▶</button>` : ''}
      <div class="grow"><div><b>${esc(w.py)}</b> <span class="muted small">HSK ${w.lv}</span></div><div>${esc(w.def)}</div></div></div>
    ${s ? `<div class="example"><div class="zh-line" lang="zh-CN">${esc(plainZh(s.zh))}
      ${hasMedia(sa) ? `<button class="speak sm" data-play="${sa}" aria-label="Ascolta la frase">▶</button>` : ''}</div>
      ${showPy ? `<div class="py">${esc(s.py)}</div>` : ''}<div class="muted">${esc(s.en)}</div></div>` : ''}`;
}
function bindPlays(root) { $$('[data-play]', root).forEach(b => b.onclick = () => play(b.dataset.play)); }
function feedback(box, ok, html, label) {
  const f = document.createElement('div');
  f.className = `feedback ${ok ? 'ok' : 'bad'}`;
  f.innerHTML = `<div class="verdict">${label || (ok ? 'Giusto!' : 'Non proprio')}</div>${html}`;
  box.appendChild(f);
  bindPlays(f);
  return f;
}
// Domanda a scelta multipla: segna giusta/sbagliata e misura il tempo.
function choice(box, opts, correctIdx, onAnswer, { cls = '', startAt } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'opts' + (opts.length === 3 || opts.length === 2 ? ' one' : '');
  wrap.innerHTML = opts.map((o, i) => `<button class="opt ${cls}" data-i="${i}">${o}</button>`).join('');
  box.appendChild(wrap);
  const t0 = { v: startAt || Date.now() };
  const btns = $$('.opt', wrap);
  btns.forEach(b => b.onclick = () => {
    const i = +b.dataset.i, ok = i === correctIdx;
    btns.forEach(x => x.disabled = true);
    btns[correctIdx].classList.add('right');
    if (!ok) b.classList.add('wrong');
    onAnswer(ok, Date.now() - t0.v);
  });
  return { restart() { t0.v = Date.now(); } };
}

/* ---------- esercizi ---------- */
const KIND_LABEL = { read: 'Che cosa significa?', tone: 'Come si legge?', listen: 'Ascolta: quale parola è?', mean: 'Quale carattere significa…' };
const RENDER = {
  info(it, box) {
    box.innerHTML = `<h2>${esc(it.title)}</h2><p>${esc(it.text)}</p>`;
    finish(it, true, box);
    SESS.n--; SESS.ok--;
  },

  srs(it, box) {
    const w = it.w, kind = it.kind;
    const isNew = !S.srs[w.id];
    const tag = isNew ? '<span class="pill">nuova</span> ' : it.retry ? '<span class="pill">di nuovo</span> ' : '';
    const done = (ok, ms) => {
      gradeSrs(w, ok, ms, it.retry);
      if (hasMedia(`audio/w/${w.id}.mp3`)) play(`audio/w/${w.id}.mp3`);
      const slow = ok && ms >= FAST_MS && !it.retry;
      feedback(box, ok, wordCard(w), ok ? (slow ? 'Giusto, ma lento: la ripeterai presto' : isNew ? 'Giusto! La conoscevi già' : 'Giusto!') : 'Non proprio: eccola');
      finish(it, ok, box);
    };
    if (kind === 'read') {
      box.innerHTML = `<div class="kind">${tag}${KIND_LABEL.read}</div>
        <div class="prompt"><div class="hz-big" lang="zh-CN">${esc(w.hz)}</div></div>`;
      const opts = defOptions(w);
      choice(box, opts.map(o => esc(o.def)), opts.indexOf(w), done);
    } else if (kind === 'tone') {
      box.innerHTML = `<div class="kind">${tag}${KIND_LABEL.tone}</div>
        <div class="prompt"><div class="hz-big" lang="zh-CN">${esc(w.hz)}</div></div>`;
      const opts = shuffle([w.py, ...w.pyAlt.slice(0, 3)]);
      choice(box, opts.map(esc), opts.indexOf(w.py), done);
    } else if (kind === 'listen' && hasMedia(`audio/w/${w.id}.mp3`)) {
      box.innerHTML = `<div class="kind">${tag}${KIND_LABEL.listen}</div>
        <div class="prompt"><button class="speak" id="rep" aria-label="Riascolta">▶</button></div>`;
      const opts = hzOptions(w);
      const c = choice(box, opts.map(o => zh(o.hz)), opts.indexOf(w), done, { cls: 'zh' });
      const a = `audio/w/${w.id}.mp3`;
      play(a).then(() => c.restart());
      $('#rep').onclick = () => play(a);
    } else {
      box.innerHTML = `<div class="kind">${tag}${KIND_LABEL.mean}</div>
        <div class="prompt"><div class="en-big">${esc(w.def)}</div></div>`;
      const opts = hzOptions(w);
      choice(box, opts.map(o => zh(o.hz)), opts.indexOf(w), done, { cls: 'zh' });
    }
  },

  sl(it, box) {
    const w = it.w, s = C.sent[w.id], a = `audio/s/${w.id}.mp3`;
    box.innerHTML = `<div class="kind">Ascolto · che cosa dice?</div>
      <div class="prompt"><button class="speak" id="rep" aria-label="Riascolta">▶</button>
      <p class="muted small">Puoi riascoltare, ma prova a capire al primo ascolto.</p></div>`;
    const others = sample(W.filter(x => x.id !== w.id && C.sent[x.id] && C.sent[x.id].en !== s.en && Math.abs(x.lv - w.lv) <= 1), 3).map(x => C.sent[x.id].en);
    const opts = shuffle([s.en, ...others]);
    const c = choice(box, opts.map(esc), opts.indexOf(s.en), ok => {
      gradePool('s:' + w.id, ok);
      feedback(box, ok, `<div class="sentence" style="text-align:left;line-height:1.5">${zh(plainZh(s.zh))}</div><div class="py">${esc(s.py)}</div><div class="muted">${esc(s.en)}</div>`);
      finish(it, ok, box);
    }, { cls: 'small' });
    play(a).then(() => c.restart());
    $('#rep').onclick = () => play(a);
  },

  dlg(it, box) { listenItem(it, box, false); },
  tf(it, box) { listenItem(it, box, true); },

  ro(it, box) {
    const w = it.w, s = C.sent[w.id];
    const toks = s.zh.split(' ');
    const punct = /^[，。？！]$/.test(toks[toks.length - 1]) ? toks.pop() : '';
    const chunks = chunk(toks, w.id);
    const target = chunks.join('');
    let order = shuffle(chunks.map((c, i) => i));
    if (order.every((v, i) => v === i)) order.reverse();
    const placed = [];
    box.innerHTML = `<div class="kind">书写 · riordina le parole per formare una frase</div>
      <div class="answer-line"><div class="chips" id="ans"></div></div>
      <div class="chips" id="pool"></div>
      <div class="next-row"><button class="btn" id="undo">Annulla</button><button class="btn primary" id="check" disabled>Controlla</button></div>`;
    const draw = () => {
      $('#ans').innerHTML = placed.map(i => `<button class="chip placed" data-i="${i}" lang="zh-CN">${esc(chunks[i])}</button>`).join('') + (placed.length === chunks.length ? `<span class="chip" style="border:0" lang="zh-CN">${punct}</span>` : '');
      $('#pool').innerHTML = order.filter(i => !placed.includes(i)).map(i => `<button class="chip" data-i="${i}" lang="zh-CN">${esc(chunks[i])}</button>`).join('');
      $$('#pool .chip').forEach(b => b.onclick = () => { placed.push(+b.dataset.i); draw(); });
      $$('#ans .chip[data-i]').forEach(b => b.onclick = () => { placed.splice(placed.indexOf(+b.dataset.i), 1); draw(); });
      $('#check').disabled = placed.length !== chunks.length;
    };
    draw();
    $('#undo').onclick = () => { placed.pop(); draw(); };
    $('#check').onclick = () => {
      const built = placed.map(i => chunks[i]).join('');
      const ok = built === target;
      $$('.chip', box).forEach(b => b.disabled = true);
      $('#check').parentElement.remove();
      gradePool('r:' + w.id, ok);
      feedback(box, ok, `<div class="zh-line" lang="zh-CN" style="font-size:22px">${esc(target + punct)}
        ${hasMedia(`audio/s/${w.id}.mp3`) ? `<button class="speak sm" data-play="audio/s/${w.id}.mp3">▶</button>` : ''}</div>
        <div class="py">${esc(s.py)}</div><div class="muted">${esc(s.en)}</div>
        ${ok ? '' : '<p class="small muted">A volte anche un altro ordine è corretto: confrontalo con questa frase.</p>'}`);
      finish(it, ok, box);
    };
  },

  wr(it, box) {
    const w = it.w, s = C.sent[w.id];
    const st = S.wr[w.id], first = !st;
    const toks = s.zh.split(' ');
    const sentHtml = toks.map(t => t === w.hz ? `<span class="blank"><span class="over">${esc(w.py)}</span>&nbsp;&nbsp;</span>` : esc(t)).join('');
    box.innerHTML = `<div class="kind">书写 · scrivi il carattere ${first ? '<span class="pill">prima volta: guarda i tratti</span>' : ''}</div>
      <div class="sentence" lang="zh-CN">${sentHtml}</div>
      <p class="muted small" style="text-align:center;margin:0">Scrivi il carattere che manca: il pinyin è sopra lo spazio, come all’esame.</p>
      <div class="writer-box"><div class="writer" id="hw"></div></div>
      <div class="next-row"><button class="btn" id="giveup">Non lo so: mostrami</button></div>`;
    let gaveUp = false;
    const end = mistakes => {
      $('#giveup')?.parentElement.remove();
      gradeWrite(w, gaveUp ? 99 : mistakes);
      const ok = !gaveUp && mistakes <= 4;
      if (hasMedia(`audio/s/${w.id}.mp3`)) play(`audio/s/${w.id}.mp3`);
      feedback(box, ok, `<p>${gaveUp ? 'Lo rivedrai domani.' : `Errori di tratto: ${mistakes}.`}</p>${wordCard(w)}`,
        gaveUp ? 'Ecco come si scrive' : mistakes <= 1 ? 'Perfetto!' : ok ? 'Giusto, con qualche incertezza' : 'Da rifare');
      finish(it, ok, box, `<button class="btn" id="again">Rivedi i tratti</button>`);
      $('#again').onclick = () => hw.animateCharacter();
    };
    const hw = makeWriter($('#hw'), w.hz, { outline: first });
    const quiz = () => hw.quiz({ showHintAfterMisses: first ? 1 : 3, highlightOnComplete: true, onComplete: r => end(r.totalMistakes) });
    if (first) hw.animateCharacter({ onComplete: () => setTimeout(quiz, 500) }); else quiz();
    $('#giveup').onclick = () => { gaveUp = true; hw.cancelQuiz(); hw.showCharacter(); hw.animateCharacter(); end(99); };
  },

  kr(it, box) {
    const k = it.k, a = `audio/k/${k.id}.mp3`;
    box.innerHTML = `<div class="kind">HSKK parte 1 · 听后重复 · ascolta e ripeti</div>
      <div class="prompt"><button class="speak" id="rep">▶</button><p class="muted small">Ascolta, poi premi Registra e ripeti la frase.</p></div>
      <div id="rec"></div><div id="after"></div>`;
    $('#rep').onclick = () => play(a);
    play(a);
    recorder($('#rec'), { onDone: url => {
      $('#after').innerHTML = `<div class="card" style="margin-top:12px">
        <div class="zh-line" lang="zh-CN" style="font-size:24px">${esc(plainZh(k.zh))}</div><div class="py">${esc(k.py)}</div><div class="muted">${esc(k.en)}</div>
        <div class="rec-panel"><button class="btn" id="m">▶ Modello</button><button class="btn" id="y">▶ La mia voce</button><button class="btn" id="both">Confronta</button></div></div>`;
      $('#m').onclick = () => play(a);
      $('#y').onclick = () => playMine(url);
      $('#both').onclick = async () => { await play(a); await sleep(300); playMine(url); };
      selfRate(box, it, 'k:' + k.id);
    } });
  },

  kq(it, box) {
    const k = it.k, a = `audio/k/${k.id}.mp3`;
    box.innerHTML = `<div class="kind">HSKK parte 2 · 听后回答 · ascolta la domanda e rispondi</div>
      <div class="prompt"><button class="speak" id="rep">▶</button><p class="muted small">Il testo della domanda compare dopo la risposta. Rispondi con una frase completa.</p></div>
      <div id="rec"></div><div id="after"></div>`;
    $('#rep').onclick = () => playSeq([a, a], 900);
    playSeq([a, a], 900);
    recorder($('#rec'), { onDone: url => {
      $('#after').innerHTML = `<div class="card" style="margin-top:12px">
        <div class="zh-line" lang="zh-CN" style="font-size:22px">${esc(plainZh(k.zh))}</div><div class="py">${esc(k.py)}</div><div class="muted">${esc(k.en)}</div>
        <h3 style="margin-top:12px">Risposte possibili</h3>
        ${k.answers.map((x, n) => `<div class="example"><span class="zh-line" lang="zh-CN">${esc(plainZh(x.zh))}</span>
          ${hasMedia(`audio/k/${k.id}-a${n}.mp3`) ? `<button class="speak sm" data-play="audio/k/${k.id}-a${n}.mp3">▶</button>` : ''}
          <div class="py">${esc(x.py)}</div><div class="muted small">${esc(x.en)}</div></div>`).join('')}
        <div class="rec-panel"><button class="btn" id="y">▶ La mia voce</button></div></div>`;
      bindPlays($('#after'));
      $('#y').onclick = () => playMine(url);
      selfRate(box, it, 'k:' + k.id);
    } });
  },

  ko(it, box) {
    const k = it.k;
    box.innerHTML = `<div class="kind">HSKK parte 3 · 回答问题 · domanda aperta</div>
      <div class="prompt"><div class="hz-mid" lang="zh-CN">${esc(plainZh(k.zh))}</div><div class="py">${esc(k.py)}</div><div class="muted">${esc(k.en)}</div></div>
      <details class="card" style="margin:10px 0"><summary><b>Frasi utili</b> (guardale prima di registrare)</summary>
        <ul class="frames">${k.frames.map(f => `<li>${zh(plainZh(f.zh))} <span class="muted small">${esc(f.py)} · ${esc(f.en)}</span></li>`).join('')}</ul></details>
      <p class="muted small" style="text-align:center">All’esame hai circa 1 minuto e mezzo: cerca di parlare per tutto il tempo, con frasi semplici.</p>
      <div id="rec"></div><div id="after"></div>`;
    recorder($('#rec'), { timer: 90, onDone: url => {
      const m = k.model;
      $('#after').innerHTML = `<div class="card" style="margin-top:12px">
        <div class="rec-panel"><button class="btn" id="y">▶ La mia risposta</button>
        ${hasMedia(`audio/k/${k.id}-m.mp3`) ? `<button class="btn" data-play="audio/k/${k.id}-m.mp3">▶ Risposta modello</button>` : ''}</div>
        <h3>Risposta modello</h3><div class="zh-line" lang="zh-CN" style="font-size:20px;line-height:1.7">${esc(plainZh(m.zh))}</div>
        <div class="py">${esc(m.py)}</div><div class="muted">${esc(m.en)}</div></div>`;
      bindPlays($('#after'));
      $('#y').onclick = () => playMine(url);
      selfRate(box, it, 'k:' + k.id);
    } });
  },
};

function listenItem(it, box, isTF) {
  const d = it.d;
  const files = d.lines.map((_, n) => `audio/d/${d.id}-${n}.mp3`);
  const seq = isTF ? files : [...files, `audio/d/${d.id}-q.mp3`];
  const lv3 = d.lv === 3;
  box.innerHTML = `<div class="kind">听力 · ${isTF ? 'vero o falso?' : 'dialogo'} · HSK ${d.lv}</div>
    <div class="prompt"><button class="speak" id="rep">▶</button>
    <p class="muted small">Come all’esame, la registrazione si sente due volte.</p></div>
    ${isTF ? `<div class="stmt" lang="zh-CN">${esc(plainZh(d.stmt))}</div>` : ''}`;
  const playTwice = () => playSeq([...seq, '__gap', ...seq], 450);
  let opts, correct;
  if (isTF) { opts = ['✓ Vero', '✗ Falso']; correct = d.ans ? 0 : 1; }
  else {
    opts = d.opts.map((o, i) => lv3 ? zh(plainZh(o)) : `${zh(plainZh(o))}<small>${esc(d.optsPy[i])}</small>`);
    correct = d.ans;
  }
  choice(box, opts, correct, ok => {
    stopAudio();
    gradePool(d.id, ok);
    feedback(box, ok, `<div class="lines">${d.lines.map(l => `<p><b>${l.s === 'F' ? '女' : '男'}：</b>${zh(plainZh(l.zh))}<small>${esc(l.py)}</small></p>`).join('')}
      ${d.q ? `<p><b>问：</b>${zh(plainZh(d.q))}<small>${esc(d.qpy)}</small></p>` : ''}</div><div class="muted small">${esc(d.en)}</div>`);
    finish(it, ok, box, `<button class="btn" id="again">▶ Riascolta</button>`);
    $('#again').onclick = () => playSeq(seq);
  }, { cls: isTF ? '' : 'zh-s' });
  playTwice();
  $('#rep').onclick = () => playSeq(seq);
}

// Divide la frase in 4-5 blocchi come nella parte 1 di 书写 (stessa divisione ogni volta).
function chunk(toks, seed) {
  const words = toks.slice();
  let target = Math.min(5, words.length);
  if (words.length > 6) target = 5; else if (words.length >= 5) target = 4;
  let h = hashStr(seed);
  while (words.length > target) {
    // unisce la coppia adiacente più corta (le virgole restano attaccate alla parola prima)
    let best = -1, bestLen = 1e9;
    for (let i = 0; i < words.length - 1; i++) {
      const forced = words[i + 1] === '，';
      const len = (words[i] + words[i + 1]).length - (forced ? 10 : 0) + ((h >> (i % 16)) & 1);
      if (len < bestLen) { bestLen = len; best = i; }
    }
    words.splice(best, 2, words[best] + words[best + 1]);
    h = Math.imul(h ^ best, 16777619) >>> 0;
  }
  return words;
}

function makeWriter(el, ch, { outline }) {
  const size = el.clientWidth || 280;
  const css = getComputedStyle(document.documentElement);
  return HanziWriter.create(el, ch, {
    width: size, height: size, padding: 14,
    showCharacter: false, showOutline: outline,
    strokeColor: css.getPropertyValue('--ink').trim(),
    outlineColor: css.getPropertyValue('--grid').trim(),
    drawingColor: css.getPropertyValue('--accent').trim(),
    highlightColor: css.getPropertyValue('--ok').trim(),
    drawingWidth: 22, strokeAnimationSpeed: 1.2, delayBetweenStrokes: 180,
    charDataLoader: (c, onLoad, onErr) => fetch(mediaUrl(`strokes/${c}.json`)).then(r => r.json()).then(onLoad).catch(onErr),
  });
}

function recorder(el, { onDone, timer }) {
  if (!Rec.supported()) {
    el.innerHTML = `<p class="muted" style="text-align:center">Registrazione non disponibile qui: ripeti ad alta voce e poi continua.</p>
      <div class="rec-panel"><button class="btn primary" id="skip">Fatto</button></div>`;
    $('#skip', el).onclick = () => onDone(null);
    return;
  }
  el.innerHTML = `${timer ? `<div class="timer" id="tm">${fmtT(timer)}</div>` : ''}<div class="rec-panel"><button class="btn primary" id="rb">● Registra</button></div>`;
  const rb = $('#rb', el);
  let on = false, iv = null, left = timer;
  const stop = async () => {
    clearInterval(iv); on = false;
    rb.disabled = true;
    const url = await Rec.stop();
    rb.textContent = '● Registra di nuovo'; rb.classList.remove('rec'); rb.disabled = false;
    onDone(url);
  };
  rb.onclick = async () => {
    if (on) return stop();
    try { stopAudio(); await Rec.start(); } catch { toast('Serve il permesso per il microfono'); return; }
    on = true; rb.textContent = '■ Stop'; rb.classList.add('rec');
    if (timer) { left = timer; $('#tm', el).textContent = fmtT(left); iv = setInterval(() => { left--; $('#tm', el).textContent = fmtT(Math.max(0, left)); if (left <= 0) stop(); }, 1000); }
  };
}
const fmtT = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function selfRate(box, it, id) {
  if ($('#rate', box)) return;
  const r = document.createElement('div');
  r.id = 'rate';
  r.innerHTML = `<p class="muted small" style="text-align:center;margin:14px 0 6px">Come ti è sembrata? (toni, parole, fluidità)</p>
    <div class="rec-panel"><button class="btn" data-r="0">Da rifare</button><button class="btn" data-r="1">Così così</button><button class="btn" data-r="2">Bene</button></div>`;
  box.appendChild(r);
  $$('[data-r]', r).forEach(b => b.onclick = () => {
    const ok = b.dataset.r !== '0';
    gradePool(id, ok);
    r.remove();
    finish(it, ok, box);
  });
}

/* ---------- pagine del PDF HSK 3 (una al giorno) ---------- */
const pageWords = p => W.filter(w => w.pg === p);
const pageNums = () => [...new Set(W.filter(w => w.pg).map(w => w.pg))].sort((a, b) => a - b);
function pageStats(p) {
  const ws = pageWords(p);
  return { total: ws.length, solid: ws.filter(w => S.srs[w.id] && S.srs[w.id].b >= SOLID).length, seen: ws.filter(w => S.srs[w.id]).length };
}
function setPage(p) { S.settings.page = Math.max(1, Math.min(pageNums().length, p)); save(); }
function pageCard() {
  const p = S.settings.page, ws = pageWords(p), st = pageStats(p), done = S.pages[p] && S.pages[p].quiz;
  return `<section class="card">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">Pagina del giorno</h2>
      <div class="row" style="gap:6px"><button class="btn ghost" id="pgPrev" aria-label="Pagina precedente">‹</button>
      <b>Pagina ${p} / ${pageNums().length}</b><button class="btn ghost" id="pgNext" aria-label="Pagina successiva">›</button></div></div>
    <p lang="zh-CN" style="font-size:20px;margin:10px 0 4px">${ws.slice(0, 8).map(w => esc(w.hz)).join('　')} …</p>
    <p class="muted small" style="margin:0 0 12px">${ws.length} parole del PDF · ${st.solid} consolidate ${done ? `· <span class="pill ok">quiz fatto ${fmtDay(dayFromISO(done))}</span>` : ''}</p>
    <div class="grid2"><button class="btn primary" id="pgOpen">Apri la pagina</button><button class="btn" id="pgFlash">Flashcard</button></div>
  </section>`;
}
function bindPageCard() {
  $('#pgPrev').onclick = () => { setPage(S.settings.page - 1); renderHome(); };
  $('#pgNext').onclick = () => { setPage(S.settings.page + 1); renderHome(); };
  $('#pgOpen').onclick = () => renderPage(S.settings.page);
  $('#pgFlash').onclick = () => startPageFlash(S.settings.page, 'hz');
}
function renderPage(p, note) {
  if (SESS) endSession(false);
  setPage(p);
  p = S.settings.page;
  view = 'page';
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === 'train'));
  const ws = pageWords(p), st = pageStats(p), last = pageNums().length;
  const dot = w => { const x = S.srs[w.id]; return !x ? '<span class="muted">·</span>' : x.b >= SOLID ? '<span style="color:var(--ok)">●</span>' : '<span style="color:var(--warn)">●</span>'; };
  app().innerHTML = `
    <div class="sess-head"><button class="x" id="back" aria-label="Indietro">×</button>
      <h2 style="margin:0;flex:1">Pagina ${p} del PDF</h2>
      <button class="btn ghost" id="prev" ${p <= 1 ? 'disabled' : ''}>‹</button><button class="btn ghost" id="next" ${p >= last ? 'disabled' : ''}>›</button></div>
    ${note ? `<section class="card feedback ok" style="margin-top:0">${esc(note)}</section>` : ''}
    <section class="card">
      <p class="muted small" style="margin-top:0">${ws.length} parole · ${st.solid} consolidate · ${st.seen} già viste. Le stesse parole, nello stesso ordine, della pagina ${p} del PDF.</p>
      <div class="grid2">
        <button class="tile" id="mFlash"><b>Flashcard</b><span>Carattere davanti: pensa, gira la carta, dì se la sapevi</span></button>
        <button class="tile" id="mFlashR"><b>Flashcard al contrario</b><span>Significato davanti: ricorda il carattere</span></button>
        <button class="tile" id="mQuiz"><b>Quiz della pagina</b><span>Significato, tono e ascolto, senza pinyin. Le sbagliate tornano finché non sono giuste</span></button>
        <button class="tile" id="mWrite"><b>Scrittura della pagina</b><span>Scrivi ogni parola: l’app controlla i tratti</span></button>
        <button class="tile" id="mPad"><b>Foglio libero</b><span>Spazio per scrivere a mano, senza correzione</span></button>
        <button class="tile" id="mWriteG"><b>Scrittura con guida</b><span>Prima volta: ricalca i caratteri sul modello</span></button>
      </div>
    </section>
    <section class="card"><table>
      <tr><th></th><th>Parola</th><th>Pinyin</th><th>Significato</th><th></th></tr>
      ${ws.map(w => `<tr><td>${dot(w)}</td><td>${zh(w.hz)}</td><td>${esc(w.py)}</td><td>${esc(w.def)}</td>
        <td>${hasMedia(`audio/w/${w.id}.mp3`) ? `<button class="speak sm" data-play="audio/w/${w.id}.mp3" aria-label="Ascolta">▶</button>` : ''}</td></tr>`).join('')}
    </table>
    <div class="legend"><span><i style="background:var(--ok)"></i>consolidata</span><span><i style="background:var(--warn)"></i>in corso</span><span>· non ancora vista</span></div></section>`;
  bindPlays(app());
  $('#back').onclick = () => go('train');
  $('#prev').onclick = () => renderPage(p - 1);
  $('#next').onclick = () => renderPage(p + 1);
  $('#mFlash').onclick = () => startPageFlash(p, 'hz');
  $('#mFlashR').onclick = () => startPageFlash(p, 'def');
  $('#mQuiz').onclick = () => startPageQuiz(p);
  $('#mWrite').onclick = () => startPageWrite(p, false);
  $('#mWriteG').onclick = () => startPageWrite(p, true);
  $('#mPad').onclick = () => renderPad(p, 0);
  window.scrollTo(0, 0);
}
function startPageFlash(p, dir) {
  startSession(shuffle(pageWords(p)).map(w => ({ t: 'fc', w, dir })), { page: p });
}
function startPageQuiz(p) {
  const ws = pageWords(p);
  // Giro 1: significato per tutte (conta per la ripetizione spaziata). Giro 2: tono o ascolto.
  const r1 = shuffle(ws).map(w => ({ t: 'srs', w, kind: 'read', loop: true }));
  const r2 = shuffle(ws).map((w, i) => ({ t: 'srs', w, kind: i % 2 && hasMedia(`audio/w/${w.id}.mp3`) ? 'listen' : 'tone', loop: true, retry: true }));
  startSession([...r1, ...r2], {
    page: p,
    onEnd: s => { if (s.i >= s.items.length) { S.pages[p] = { ...(S.pages[p] || {}), quiz: isoFromDay(today()) }; save(); } },
  });
}
function startPageWrite(p, guide) {
  startSession(pageWords(p).map(w => ({ t: 'pw', w, guide, loop: !guide })), { page: p });
}
function logAnswer(ok) { const lg = logToday(); lg.n++; if (ok) lg.ok++; save(); }

RENDER.fc = (it, box) => {
  const w = it.w, a = `audio/w/${w.id}.mp3`;
  const front = it.dir === 'def'
    ? `<div class="en-big">${esc(w.def)}</div><p class="muted small">Che parola è? Prova a scriverla con il dito prima di girare.</p>`
    : `<div class="hz-big" lang="zh-CN">${esc(w.hz)}</div><p class="muted small">Come si legge e che cosa significa?</p>`;
  box.innerHTML = `<div class="kind">Flashcard · pagina ${w.pg} ${it.retry ? '<span class="pill">di nuovo</span>' : ''}</div>
    <div class="prompt">${front}</div>
    <div class="next-row" id="fl"><button class="btn primary big" id="flip">Gira la carta</button></div>`;
  $('#flip').onclick = () => {
    $('#fl').remove();
    if (hasMedia(a)) play(a);
    const back = document.createElement('div');
    back.className = 'feedback';
    back.style.background = 'var(--accent-soft)';
    back.innerHTML = wordCard(w);
    box.appendChild(back);
    bindPlays(back);
    const row = document.createElement('div');
    row.className = 'next-row';
    row.innerHTML = `<button class="btn" id="no">✗ Non la sapevo</button><button class="btn primary" id="yes">✓ La sapevo</button>`;
    box.appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const answer = ok => {
      logAnswer(ok);
      SESS.n++; if (ok) SESS.ok++;
      if (!ok) SESS.items.push({ ...it, retry: true }); // torna in fondo al mazzo
      SESS.i++; nextItem();
    };
    $('#no').onclick = () => answer(false);
    $('#yes').onclick = () => answer(true);
  };
};

RENDER.pw = (it, box) => {
  const w = it.w, chars = [...w.hz], a = `audio/w/${w.id}.mp3`;
  box.innerHTML = `<div class="kind">Scrittura · pagina ${w.pg} ${it.guide ? '<span class="pill">con guida</span>' : ''} ${it.retry ? '<span class="pill">di nuovo</span>' : ''}</div>
    <div class="prompt"><div class="en-big">${esc(w.def)}</div>
      <div class="py" style="font-size:22px">${esc(w.py)} ${hasMedia(a) ? `<button class="speak sm" data-play="${a}" aria-label="Ascolta">▶</button>` : ''}</div></div>
    <div class="writer-row">${chars.map((c, i) => `<div class="writer" id="hw${i}"></div>`).join('')}</div>
    <div class="next-row"><button class="btn" id="giveup">Non lo so: mostrami</button></div>`;
  bindPlays(box);
  const writers = chars.map((c, i) => makeWriter($('#hw' + i), c, { outline: it.guide }));
  let i = 0, total = 0, gave = false;
  const end = () => {
    $('#giveup')?.parentElement.remove();
    const ok = !gave && total <= 3 * chars.length;
    if (writable(w)) gradeWrite(w, gave ? 99 : total); else logAnswer(ok);
    feedback(box, ok, `<p>${gave ? 'Tornerà alla fine del giro.' : `Errori di tratto: ${total}.`}</p>${wordCard(w)}`,
      gave ? 'Ecco come si scrive' : total <= chars.length ? 'Perfetto!' : ok ? 'Giusto, con qualche incertezza' : 'Da rifare');
    finish(it, ok, box, `<button class="btn" id="again">Rivedi i tratti</button>`);
    $('#again').onclick = async () => { for (const hw of writers) await new Promise(r => hw.animateCharacter({ onComplete: r })); };
  };
  const step = () => {
    if (i >= chars.length) return end();
    writers[i].quiz({ showHintAfterMisses: it.guide ? 1 : 3, highlightOnComplete: true, onComplete: r => { total += r.totalMistakes; i++; step(); } });
  };
  step();
  $('#giveup').onclick = () => {
    gave = true;
    writers.forEach(hw => { hw.cancelQuiz(); hw.showCharacter(); });
    end();
  };
};

/* Foglio libero: si scrive a mano sulla griglia, senza correzione; il modello si può mostrare in trasparenza. */
function renderPad(p, idx) {
  if (SESS) endSession(false);
  const ws = pageWords(p), w = ws[idx], chars = [...w.hz], a = `audio/w/${w.id}.mp3`;
  view = 'page';
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === 'train'));
  app().innerHTML = `
    <div class="sess-head"><button class="x" id="back" aria-label="Torna alla pagina">×</button>
      <h2 style="margin:0;flex:1">Foglio libero · pagina ${p}</h2><span class="muted small">${idx + 1}/${ws.length}</span></div>
    <section class="card">
      <div class="prompt" style="padding-top:4px"><div class="en-big">${esc(w.def)}</div>
        <div class="py" style="font-size:22px">${esc(w.py)} ${hasMedia(a) ? `<button class="speak sm" data-play="${a}" aria-label="Ascolta">▶</button>` : ''}</div></div>
      <div class="writer-row">${chars.map(c => `<div class="writer pad"><span class="ghost-hz" lang="zh-CN">${esc(c)}</span></div>`).join('')}</div>
      <div class="next-row"><button class="btn" id="model">Mostra il modello</button><button class="btn" id="clear">Cancella</button></div>
      <div class="next-row"><button class="btn" id="prev" ${idx <= 0 ? 'disabled' : ''}>‹ Precedente</button><button class="btn primary" id="next">${idx < ws.length - 1 ? 'Successiva ›' : 'Fine'}</button></div>
      <p class="muted small" style="text-align:center">Scrivi senza guardare, poi premi «Mostra il modello» per confrontare o ricalcare. Con la Apple Pencil il palmo appoggiato viene ignorato.</p>
    </section>`;
  bindPlays(app());
  const pads = $$('.pad').map(makePad);
  let shown = false;
  $('#model').onclick = () => {
    shown = !shown;
    $$('.ghost-hz').forEach(g => g.classList.toggle('on', shown));
    $('#model').textContent = shown ? 'Nascondi il modello' : 'Mostra il modello';
  };
  $('#clear').onclick = () => pads.forEach(pd => pd.clear());
  $('#prev').onclick = () => renderPad(p, idx - 1);
  $('#next').onclick = () => idx < ws.length - 1 ? renderPad(p, idx + 1) : renderPage(p, 'Foglio libero finito: hai scritto tutte le parole della pagina.');
  $('#back').onclick = () => renderPage(p);
  window.scrollTo(0, 0);
}
function makePad(el) {
  const cv = document.createElement('canvas');
  el.appendChild(cv);
  const ctx = cv.getContext('2d');
  const size = el.clientWidth, dpr = window.devicePixelRatio || 1;
  cv.width = size * dpr; cv.height = size * dpr;
  cv.style.width = cv.style.height = size + 'px';
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  let last = null, penSeen = false;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const width = e => size / 34 * (e.pointerType === 'pen' ? 0.55 + (e.pressure || 0.5) * 0.9 : 1);
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') penSeen = true;
    if (penSeen && e.pointerType === 'touch') return; // palmo appoggiato mentre si usa la Pencil
    cv.setPointerCapture(e.pointerId);
    last = pos(e);
    ctx.beginPath(); ctx.arc(last.x, last.y, width(e) / 2, 0, Math.PI * 2); ctx.fill();
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!last || !cv.hasPointerCapture(e.pointerId)) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const pt = pos(ev);
      ctx.lineWidth = width(ev);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
      last = pt;
    }
    e.preventDefault();
  });
  const up = () => { last = null; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  return { clear() { ctx.clearRect(0, 0, size, size); } };
}

/* ---------- ordine dei tratti (libero) ---------- */
function renderStrokePicker() {
  const chars = [...new Set(W.filter(w => w.lv === 3).flatMap(w => [...w.hz]))];
  app().innerHTML = `<div class="sess-head"><button class="x" id="back">×</button><h2 style="margin:0">Ordine dei tratti</h2></div>
    <section class="card"><p class="muted small">Tocca un carattere dell’HSK 3 per vedere i tratti e ricalcarlo.</p>
    <div class="writer-box"><div class="writer" id="hw"></div></div>
    <div class="next-row"><button class="btn" id="anim">▶ Animazione</button><button class="btn primary" id="trace">Ricalca</button></div>
    <div class="chips" id="list" style="justify-content:flex-start;margin-top:14px">${chars.map(c => `<button class="chip" lang="zh-CN">${c}</button>`).join('')}</div></section>`;
  let hw = null;
  const pick = c => {
    $('#hw').innerHTML = '';
    hw = makeWriter($('#hw'), c, { outline: true });
    hw.showCharacter();
  };
  $$('#list .chip').forEach(b => b.onclick = () => { pick(b.textContent); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#anim').onclick = () => hw && hw.animateCharacter();
  $('#trace').onclick = () => { if (!hw) return; hw.hideCharacter(); hw.quiz({ showHintAfterMisses: 2, onComplete: r => toast(r.totalMistakes <= 1 ? 'Perfetto!' : `Fatto, con ${r.totalMistakes} errori`) }); };
  $('#back').onclick = () => go('train');
  pick(chars[0]);
}

/* ---------- PROGRESSI ---------- */
function renderProgress() {
  const t = today();
  const days = [];
  for (let d = t - 13; d <= t; d++) days.push({ d, l: S.log[isoFromDay(d)] });
  const maxN = Math.max(10, ...days.map(x => x.l ? x.l.n : 0));
  let streak = 0;
  for (let d = t; S.log[isoFromDay(d)] && S.log[isoFromDay(d)].n > 0; d--) streak++;
  const hard = W.filter(w => S.srs[w.id] && S.srs[w.id].l > 0).sort((a, b) => S.srs[b.id].l - S.srs[a.id].l).slice(0, 15);
  const wrDone = Object.values(S.wr).filter(x => x.b >= 2).length, wrTot = W.filter(writable).length;
  const pools = (pred) => { const v = Object.entries(S.pool).filter(([k]) => pred(k)).map(([, p]) => p); const n = v.reduce((s, p) => s + p.n, 0), ok = v.reduce((s, p) => s + p.ok, 0); return n ? `${Math.round(ok / n * 100)}% su ${n}` : '—'; };
  app().innerHTML = `
    <section class="card"><h2>Vocaboli</h2>${barBlock('HSK 3', stats(3))}<div style="height:12px"></div>${barBlock('HSK 1–2', stats(12))}
      <div class="legend"><span><i style="background:var(--ok)"></i>consolidate (riconosciute più volte, velocemente)</span><span><i style="background:var(--warn)"></i>in corso</span></div></section>
    <section class="card"><h2>Ultimi 14 giorni <span class="muted small">· ${streak} ${streak === 1 ? 'giorno' : 'giorni'} di fila</span></h2>
      <div class="hist">${days.map(x => `<div title="${x.l ? x.l.n : 0}" style="height:${(x.l ? x.l.n : 0) / maxN * 100}%"></div>`).join('')}</div>
      <div class="hist-labels">${days.map(x => `<span>${new Date(x.d * 864e5).getUTCDate()}</span>`).join('')}</div></section>
    <section class="card"><h2>Le altre abilità</h2><table>
      <tr><td>Scrittura caratteri HSK 3</td><td>${wrDone} / ${wrTot} sicuri</td></tr>
      <tr><td>Ascolto frasi</td><td>${pools(k => k.startsWith('s:'))}</td></tr>
      <tr><td>Dialoghi e vero/falso</td><td>${pools(k => /^[DT]\d/.test(k))}</td></tr>
      <tr><td>Riordino frasi</td><td>${pools(k => k.startsWith('r:'))}</td></tr>
      <tr><td>Orale HSKK (autovalutazione)</td><td>${pools(k => k.startsWith('k:'))}</td></tr></table></section>
    <section class="card"><h2>Parole più difficili</h2>${hard.length ? `<table><tr><th>Parola</th><th>Pinyin</th><th>Significato</th><th>Errori</th></tr>
      ${hard.map(w => `<tr><td>${zh(w.hz)}</td><td>${esc(w.py)}</td><td>${esc(w.def)}</td><td>${S.srs[w.id].l}</td></tr>`).join('')}</table>` : '<p class="muted">Ancora nessuna.</p>'}</section>`;
}

/* ---------- IMPOSTAZIONI ---------- */
function renderSettings() {
  const tr = S.settings.travel[0] || { from: '', to: '' };
  app().innerHTML = `
    <section class="card"><h2>Giorni di viaggio</h2>
      <p class="muted small">In questi giorni l’app chiede metà delle parole nuove e ridistribuisce il resto sugli altri giorni.</p>
      <div class="row"><label class="field">Dal<input type="date" id="tf" value="${tr.from}"></label><label class="field">Al<input type="date" id="tt" value="${tr.to}"></label>
      <button class="btn" id="tsave" style="align-self:flex-end">Salva</button></div></section>
    <section class="card"><h2>Audio</h2><label class="field">Velocità di riproduzione
      <select id="speed">${[[0.75, 'Lenta (0,75×)'], [0.9, 'Un po’ lenta (0,9×)'], [1, 'Normale, come all’esame']].map(([v, l]) => `<option value="${v}" ${S.settings.speed == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="muted small">Le voci sono sintetiche (voci neurali cinesi), non registrazioni di madrelingua.</p></section>
    <section class="card"><h2>Uso offline</h2><div id="offline-detail"></div></section>
    <section class="card"><h2>Copia dei progressi</h2>
      <p class="muted small">I progressi sono salvati solo su questo iPad. Puoi esportarli in un file per sicurezza.</p>
      <div class="row"><button class="btn" id="exp">Esporta</button><label class="btn" style="display:inline-flex;align-items:center">Importa<input type="file" id="imp" accept="application/json" hidden></label></div></section>
    <section class="card"><h2>Informazioni</h2><p class="small muted">Liste ufficiali HSK 2.0 (revisione 2012): HSK 1 (150), HSK 2 (150), HSK 3 (300), le stesse dell’esame del 7 novembre.
      Tratti dei caratteri: Hanzi Writer (MIT) e dati Arphic/Make Me a Hanzi.</p>
      <button class="btn ghost" id="reset" style="color:var(--bad)">Azzera tutti i progressi</button></section>`;
  $('#tsave').onclick = () => {
    const from = $('#tf').value, to = $('#tt').value;
    if (from && to && from > to) return toast('La data di fine è prima di quella di inizio');
    S.settings.travel = from && to ? [{ from, to }] : [];
    save(); toast('Salvato: il carico giornaliero è stato ricalcolato');
  };
  $('#speed').onchange = e => { S.settings.speed = +e.target.value; save(); };
  $('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `cinese-progressi-${isoFromDay(today())}.json`; a.click();
  };
  $('#imp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.srs || !data.log) throw new Error();
      if (!confirm('Sostituire i progressi attuali con quelli del file?')) return;
      localStorage.setItem(LS_KEY, JSON.stringify(data)); load(); toast('Progressi importati'); go('home');
    } catch { toast('File non valido'); }
  };
  $('#reset').onclick = () => { if (confirm('Cancellare davvero tutti i progressi? Non si può annullare.')) { S = freshState(); save(); go('home'); } };
  renderOfflineBar();
}

/* ---------- offline: scarica audio e tratti nella cache ---------- */
const MEDIA_CACHE = 'cinese-media-v1';
const OFF = { state: 'idle', done: 0, total: 0 };
async function syncMedia() {
  if (!('caches' in window) || OFF.state === 'run') return;
  OFF.state = 'run';
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const cache = await caches.open(MEDIA_CACHE);
    const want = new Set(Object.keys(MI).map(p => new URL(mediaUrl(p), location.href).href));
    const have = new Set((await cache.keys()).map(r => r.url));
    for (const url of have) if (!want.has(url)) await cache.delete(url);
    const missing = [...want].filter(u => !have.has(u));
    OFF.total = want.size; OFF.done = want.size - missing.length;
    renderOfflineBar();
    let failed = 0;
    const worker = async () => {
      while (missing.length) {
        const u = missing.pop();
        try { const r = await fetch(u); if (r.ok) await cache.put(u, r); else failed++; } catch { failed++; }
        OFF.done++;
        if (OFF.done % 25 === 0) renderOfflineBar();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    OFF.state = failed ? 'partial' : 'ok';
    OFF.failed = failed;
  } catch { OFF.state = 'partial'; }
  renderOfflineBar();
}
function renderOfflineBar() {
  const txt = OFF.state === 'ok' ? '✓ Pronta per l’uso offline: audio e tratti sono salvati sull’iPad.'
    : OFF.state === 'run' ? `Scarico audio e tratti per l’uso offline… ${OFF.total ? Math.round(OFF.done / OFF.total * 100) : 0}%`
    : OFF.state === 'partial' ? `Download incompleto (${OFF.failed || '?'} file mancanti). Riprova con una connessione.`
    : 'Preparazione dell’uso offline…';
  const el = $('#offline');
  if (el) el.innerHTML = OFF.state === 'ok' ? `<p class="muted small offline-bar">${txt}</p>` : `<section class="card offline-bar">${txt}</section>`;
  const d = $('#offline-detail');
  if (d) {
    d.innerHTML = `<p class="small">${txt}</p><button class="btn" id="resync">Controlla di nuovo</button>`;
    $('#resync').onclick = () => { OFF.state = 'idle'; syncMedia(); };
  }
}

/* ---------- avvio ---------- */
async function boot() {
  load();
  $$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.view));
  try {
    const [w, c, mi] = await Promise.all(['data/words.json', 'data/content.json', 'data/media_index.json'].map(u => fetch(u).then(r => r.json())));
    W = w; C = c; MI = mi;
    W.forEach(x => WBY[x.id] = x);
  } catch {
    app().innerHTML = '<section class="card"><h2>Non riesco a caricare i dati</h2><p>Apri l’app una volta con la connessione attiva.</p></section>';
    return;
  }
  go('home');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  syncMedia();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopAudio(); } else if (!SESS && view === 'home') renderHome(); });
boot();
