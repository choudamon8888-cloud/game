(() => {
'use strict';
const W = 800, H = 450, GROUND = 370, S = 34, PLAYER_X = 200;
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);

// ---- scaling for crisp canvas ----
function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth;
  cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr * H / W);
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
}
addEventListener('resize', fit); fit();

// ---- levels ----
const LEVELS = [
  { name: 'Warm Up',   speed: 300, seq: ['c', 6], color: '#22d3ee' },
  { name: 'Wing It',   speed: 325, seq: ['c', 4, 'f', 5, 'c', 3], color: '#a3e635' },
  { name: 'Switch Up', speed: 350, seq: ['c', 5, 'f', 6, 'c', 5, 'f', 6], color: '#fbbf24' },
  { name: 'Sky High',  speed: 385, seq: ['c', 6, 'f', 8, 'c', 6, 'f', 8], color: '#f472b6' },
  { name: 'Mayhem',    speed: 425, seq: ['c', 8, 'f', 10, 'c', 8, 'f', 10, 'c', 6], color: '#f87171' },
];

function rngFor(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const JUMP_V = 780, GRAV = 2400, AIR = 2 * JUMP_V / GRAV; // cube jump, air time ~0.65s
const FLAP_V = 430, FLAP_G = 1500;

function build(idx) {
  const L = LEVELS[idx], rnd = rngFor(idx * 977 + 13);
  const spikes = [], blocks = [], pipes = [], portals = [];
  const air = AIR * L.speed;
  let x = 900;
  for (let i = 0; i < L.seq.length; i += 2) {
    const mode = L.seq[i], n = L.seq[i + 1];
    if (mode === 'f') { portals.push({ x, mode: 'f' }); x += 480; }
    else if (i > 0)   { portals.push({ x, mode: 'c' }); x += 520; }
    if (mode === 'c') {
      for (let k = 0; k < n; k++) {
        const r = rnd(), maxS = idx === 0 ? 2 : 3;
        if (r < 0.28 && idx > 0) { blocks.push({ x, y: GROUND - S }); x += S; }
        else { const c = 1 + Math.floor(rnd() * maxS); for (let j = 0; j < c; j++) spikes.push({ x: x + j * S }); x += c * S; }
        x += air + 110 + rnd() * 110;
      }
    } else {
      let gy = 200;
      for (let k = 0; k < n; k++) {
        gy = Math.max(120, Math.min(270, gy + (rnd() - 0.5) * 180));
        pipes.push({ x, gap: gy, w: 62, h: 150 }); x += 270;
      }
      x += 200;
    }
  }
  return { spikes, blocks, pipes, portals, length: x + 150, ...L };
}

// ---- state ----
let lvl = 0, level, state = 'menu', attempts = 1;
let p, particles = [], shake = 0, flash = 0, time = 0, stars = [];
let unlocked = +localStorage.getItem('fd_unlocked') || 1;
const best = JSON.parse(localStorage.getItem('fd_best') || '{}');
for (let i = 0; i < 60; i++) stars.push({ x: Math.random() * W, y: Math.random() * GROUND, s: 0.5 + Math.random() * 2 });

function save() { try { localStorage.setItem('fd_unlocked', unlocked); localStorage.setItem('fd_best', JSON.stringify(best)); } catch (e) {} }

function reset() {
  level = build(lvl);
  p = { x: 0, y: GROUND - S, vy: 0, mode: 'c', rot: 0, grounded: true, coyote: 0, buffer: 0, held: false, cut: false, dead: false };
  particles = []; time = 0;
}

// ---- audio ----
let ac;
function beep(f, d = 0.08, type = 'square', vol = 0.05, slide = 0) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), ac.currentTime + d);
    g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
  } catch (e) {}
}

// ---- input ----
function press() {
  if (state !== 'play') return;
  p.held = true; p.buffer = 0.12; p.cut = false;
  if (p.mode === 'f') flap();
}
function release() {
  p.held = false;
  if (p && p.mode === 'c' && !p.grounded && p.vy < -300 && !p.cut) { p.vy *= 0.5; p.cut = true; } // variable jump height
}
function flap() { p.vy = -FLAP_V; p.buffer = 0; beep(520, 0.09, 'triangle', 0.06, 200); puff(3, '#fff'); }
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); if (!e.repeat) { if (state === 'play') press(); else if (state === 'over' && !$('over').classList.contains('hidden')) retry(); } }
});
addEventListener('keyup', e => { if (['Space', 'ArrowUp', 'KeyW'].includes(e.code) && state === 'play') release(); });
cv.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
addEventListener('pointerup', () => { if (state === 'play') release(); });

// ---- helpers ----
function puff(n, color, spd = 120) {
  for (let i = 0; i < n; i++) particles.push({ x: p.x + S / 2, y: p.y + S / 2, vx: (Math.random() - 0.5) * spd - 60, vy: (Math.random() - 0.5) * spd,
    life: 0.4 + Math.random() * 0.3, max: 0.7, c: color, s: 2 + Math.random() * 3 });
}
function die() {
  if (p.dead) return;
  p.dead = true; state = 'dying'; shake = 0.35; flash = 0.25;
  for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, v = 100 + Math.random() * 350;
    particles.push({ x: p.x + S / 2, y: p.y + S / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.8, max: 0.8, c: i % 2 ? '#22d3ee' : '#f472b6', s: 3 + Math.random() * 5 }); }
  beep(180, 0.35, 'sawtooth', 0.08, -120);
  const pct = Math.min(100, Math.floor(p.x / level.length * 100));
  best[lvl] = Math.max(best[lvl] || 0, pct); save();
  setTimeout(() => { attempts++; reset(); state = 'play'; }, 650); // instant retry, GD style
}
function win() {
  state = 'over'; best[lvl] = 100;
  if (lvl + 1 >= unlocked && lvl + 1 < LEVELS.length) unlocked = lvl + 2;
  save(); beep(660, 0.15, 'triangle', 0.08, 400); setTimeout(() => beep(990, 0.25, 'triangle', 0.08), 140);
  const last = lvl === LEVELS.length - 1;
  $('overTitle').textContent = last ? 'You beat the game!' : 'Level Complete!';
  $('overText').textContent = `${LEVELS[lvl].name} cleared in ${attempts} attempt${attempts > 1 ? 's' : ''}.`;
  $('btnNext').style.display = last ? 'none' : '';
  $('over').classList.remove('hidden');
}

// ---- physics (fixed step) ----
function step(dt) {
  time += dt; p.x += level.speed * dt;
  p.buffer = Math.max(0, p.buffer - dt);

  // portals
  for (const pt of level.portals) if (!pt.done && p.x + S > pt.x) {
    pt.done = true; p.mode = pt.mode; beep(300, 0.2, 'sine', 0.07, 500);
    if (pt.mode === 'f') p.vy = -200; flash = 0.15;
  }

  if (p.mode === 'c') {
    const prevBottom = p.y + S;
    p.vy += GRAV * dt; p.y += p.vy * dt;
    const was = p.grounded; p.grounded = false;
    if (p.y + S >= GROUND) { p.y = GROUND - S; p.vy = 0; p.grounded = true; }
    for (const b of level.blocks) {
      if (p.x + S - 4 > b.x && p.x + 4 < b.x + S) {
        if (p.vy >= 0 && prevBottom <= b.y + 8 && p.y + S >= b.y) { p.y = b.y - S; p.vy = 0; p.grounded = true; }
        else if (p.y + S - 5 > b.y && p.y + 5 < b.y + S) return die();
      }
    }
    if (p.grounded) { p.coyote = 0.09; p.cut = false; } else p.coyote = Math.max(0, p.coyote - dt);
    if ((p.buffer > 0 || p.held) && p.coyote > 0 && p.vy >= 0) { // buffered jump, coyote time, hold to bunny-hop
      p.vy = -JUMP_V; p.grounded = false; p.coyote = 0; p.buffer = 0; p.cut = !p.held; beep(420, 0.1, 'square', 0.04, 260); puff(4, '#22d3ee', 80);
    }
    if (!p.grounded) p.rot += Math.PI / AIR * dt;
    else { const t = Math.round(p.rot / (Math.PI / 2)) * Math.PI / 2; p.rot += (t - p.rot) * Math.min(1, dt * 22); }
  } else {
    p.vy = Math.min(p.vy + FLAP_G * dt, 650); p.y += p.vy * dt;
    if (p.y < 0) { p.y = 0; p.vy = Math.max(p.vy, 0); }
    if (p.y + S >= GROUND) return die();
    const target = Math.max(-0.5, Math.min(1.0, p.vy / 600));
    p.rot += (target - p.rot) * Math.min(1, dt * 12);
  }

  // hazards
  const hx = p.x + 6, hy = p.y + 6, hw = S - 12, hh = S - 12;
  for (const s of level.spikes) {
    if (s.x > p.x + 200 || s.x < p.x - 60) continue;
    const sx = s.x + S * 0.3, sw = S * 0.4, sy = GROUND - S * 0.62;
    if (hx < sx + sw && hx + hw > sx && hy < GROUND && hy + hh > sy) return die();
  }
  for (const pi of level.pipes) {
    if (hx < pi.x + pi.w && hx + hw > pi.x) {
      if (hy < pi.gap - pi.h / 2 || hy + hh > pi.gap + pi.h / 2) return die();
    }
  }
  if (p.mode === 'c' || true) {
    // trail
    if (Math.random() < 0.6) particles.push({ x: p.x + 2, y: p.y + S / 2 + (Math.random() - 0.5) * S, vx: -80, vy: 0, life: 0.3, max: 0.3, c: level.color, s: 3 });
  }
  if (p.x > level.length) win();
}

// ---- drawing ----
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

function draw() {
  const camX = p.x - PLAYER_X;
  const c = level.color;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 30, (Math.random() - 0.5) * shake * 30);
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#0b0b2a'); g.addColorStop(1, '#2a1550');
  ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
  for (const s of stars) { const sx = ((s.x - camX * 0.05 * s.s) % W + W) % W; ctx.fillStyle = `rgba(255,255,255,${0.25 + s.s * 0.2})`; ctx.fillRect(sx, s.y, s.s, s.s); }
  // parallax hills
  ctx.fillStyle = '#1a1040';
  for (let i = -1; i < 6; i++) { const bx = i * 220 - ((camX * 0.25) % 220); ctx.beginPath(); ctx.moveTo(bx, GROUND); ctx.lineTo(bx + 110, GROUND - 90 - 30 * Math.sin(i * 2.1)); ctx.lineTo(bx + 220, GROUND); ctx.fill(); }
  // ground
  ctx.fillStyle = '#10102a'; ctx.fillRect(-20, GROUND, W + 40, H - GROUND + 20);
  ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.shadowColor = c; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(-20, GROUND); ctx.lineTo(W + 20, GROUND); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.strokeStyle = c + '44'; ctx.lineWidth = 1;
  for (let x = -(camX % 40); x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x - 20, H); ctx.stroke(); }

  ctx.save(); ctx.translate(-camX, 0);
  // portals
  for (const pt of level.portals) {
    if (pt.x < camX - 80 || pt.x > camX + W + 80) continue;
    const col = pt.mode === 'f' ? '#f472b6' : '#22d3ee';
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(pt.x + 10, GROUND / 2, 14, 120, 0, 0, 6.3); ctx.stroke();
    ctx.lineWidth = 2; ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 8);
    ctx.beginPath(); ctx.ellipse(pt.x + 10, GROUND / 2, 6, 100, 0, 0, 6.3); ctx.stroke(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  // blocks
  for (const b of level.blocks) {
    if (b.x < camX - 60 || b.x > camX + W + 60) continue;
    ctx.fillStyle = '#16163a'; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.shadowColor = c; ctx.shadowBlur = 8;
    rrect(b.x + 1.5, b.y + 1.5, S - 3, S - 3, 4); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.strokeStyle = c + '66'; ctx.strokeRect(b.x + 9, b.y + 9, S - 18, S - 18);
  }
  // spikes
  for (const s of level.spikes) {
    if (s.x < camX - 60 || s.x > camX + W + 60) continue;
    ctx.fillStyle = '#05050f'; ctx.strokeStyle = '#f87171'; ctx.lineWidth = 2.5; ctx.shadowColor = '#f87171'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(s.x + 1, GROUND); ctx.lineTo(s.x + S / 2, GROUND - S); ctx.lineTo(s.x + S - 1, GROUND); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  }
  // pipes
  for (const pi of level.pipes) {
    if (pi.x < camX - 100 || pi.x > camX + W + 100) continue;
    const top = pi.gap - pi.h / 2, bot = pi.gap + pi.h / 2;
    ctx.fillStyle = '#12302a'; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3; ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 8;
    ctx.fillRect(pi.x, -10, pi.w, top + 10); ctx.strokeRect(pi.x, -10, pi.w, top + 10);
    ctx.fillRect(pi.x, bot, pi.w, GROUND - bot); ctx.strokeRect(pi.x, bot, pi.w, GROUND - bot);
    ctx.fillRect(pi.x - 6, top - 22, pi.w + 12, 22); ctx.strokeRect(pi.x - 6, top - 22, pi.w + 12, 22);
    ctx.fillRect(pi.x - 6, bot, pi.w + 12, 22); ctx.strokeRect(pi.x - 6, bot, pi.w + 12, 22); ctx.shadowBlur = 0;
  }
  // particles
  for (const q of particles) { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.c; ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s); }
  ctx.globalAlpha = 1;
  // player
  if (!p.dead) {
    ctx.save(); ctx.translate(p.x + S / 2, p.y + S / 2); ctx.rotate(p.rot);
    ctx.shadowColor = p.mode === 'f' ? '#fbbf24' : c; ctx.shadowBlur = 14;
    if (p.mode === 'c') {
      ctx.fillStyle = c; rrect(-S / 2, -S / 2, S, S, 6); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#06222a'; ctx.fillRect(-9, -8, 7, 7); ctx.fillRect(4, -8, 7, 7); ctx.fillRect(-8, 6, 17, 4);
    } else {
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.ellipse(0, 0, S / 2 + 2, S / 2 - 2, 0, 0, 6.3); ctx.fill(); ctx.shadowBlur = 0;
      const wing = Math.sin(time * 22) * 6;
      ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.ellipse(-4, 3 + wing * 0.3, 9, 6 + Math.abs(wing) * 0.4, -0.3, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(8, -5, 6, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(10, -5, 2.6, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.moveTo(16, -1); ctx.lineTo(25, 2); ctx.lineTo(16, 5); ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore(); // camera
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
  ctx.restore(); // shake

  // HUD
  const pct = Math.min(1, p.x / level.length);
  ctx.fillStyle = '#ffffff22'; rrect(200, 14, 400, 10, 5); ctx.fill();
  ctx.fillStyle = c; rrect(200, 14, 400 * pct, 10, 5); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`${Math.floor(pct * 100)}%`, 400, 44);
  ctx.textAlign = 'left'; ctx.fillText(`Level ${lvl + 1}: ${level.name}`, 16, 28);
  ctx.textAlign = 'right'; ctx.fillText(`Attempt ${attempts}`, W - 16, 28);
  if (time < 1.6 && state === 'play') { ctx.textAlign = 'center'; ctx.globalAlpha = 1 - time / 1.6; ctx.font = 'bold 22px system-ui,sans-serif';
    ctx.fillText('Tap / Space to jump', 400, 110); ctx.globalAlpha = 1; }
}

// ---- loop ----
let last = performance.now(), acc = 0;
const DT = 1 / 120;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!level) return;
  if (state === 'play') { acc += dt; while (acc >= DT && state === 'play') { step(DT); acc -= DT; } }
  else acc = 0;
  for (const q of particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; if (state !== 'play' && q.vy !== 0) q.vy += 600 * dt; }
  particles = particles.filter(q => q.life > 0);
  shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt * 2);
  if (state !== 'menu') draw();
}

// ---- menu ----
function renderMenu() {
  const box = $('levels'); box.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button');
    b.disabled = i >= unlocked;
    b.innerHTML = `${i + 1}. ${L.name}<small>${i >= unlocked ? 'Locked' : 'Best ' + (best[i] || 0) + '%'}</small>`;
    b.onclick = () => start(i);
    box.appendChild(b);
  });
}
function start(i) {
  lvl = i; attempts = 1; reset(); state = 'play';
  $('menu').classList.add('hidden'); $('over').classList.add('hidden');
  last = performance.now();
}
function retry() { start(lvl); }
$('btnRetry').onclick = retry;
$('btnNext').onclick = () => start(Math.min(lvl + 1, LEVELS.length - 1));
$('btnMenu').onclick = () => { state = 'menu'; renderMenu(); $('over').classList.add('hidden'); $('menu').classList.remove('hidden'); };

renderMenu(); reset();
requestAnimationFrame(frame);
window.__fd = { start, get p() { return p; }, get state() { return state; }, LEVELS };
})();
