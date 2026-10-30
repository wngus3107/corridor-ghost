'use strict';
/* =========================================================
   복도 끝의 그녀 — 쯔꾸르풍 추격 미연시 (vanilla JS)
   ========================================================= */
(function () {

/* ---------------- 상수 & 맵 ---------------- */
const TILE = 32, COLS = 30, ROWS = 17, W = COLS * TILE, H = ROWS * TILE;

const MAP_SRC = [
  "##############################",
  "#.....#..........#...........#",
  "#.....#..........#........D..#",
  "#.....#..........#...........#",
  "#S....#..........#...........#",
  "#.....#####..#####...........#",
  "#........................B...#",
  "#.....#####..#####....###.#..#",
  "#.....#..........#....#......#",
  "#.....#..........#....#....L.#",
  "#.....#####..#####....###.#..#",
  "#.............B..............#",
  "#.....#####..#####....###.#..#",
  "#..B..#..........#....#......#",
  "#.....#....G.....#....#......#",
  "#.....#..........#....#.....E#",
  "##############################"
];

const FRAG_SPOTS = [
  [20,2],[9,3],[25,1],[15,8],[9,9],[8,13],[3,15],[20,6],
  [26,11],[25,9],[15,4],[27,14],[4,6],[20,13],[12,1],[2,8]
];

const grid = MAP_SRC.map(r => r.split(''));
const startPos = { x: 0, y: 0 };
const ghostPos = { x: 0, y: 0 };
const braziers = [];
let dollPos = null, letterPos = null, exitPos = null;

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const ch = grid[r][c];
    const px = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
    if (ch === 'S') startPos.x = px.x, startPos.y = px.y;
    else if (ch === 'G') ghostPos.x = px.x, ghostPos.y = px.y;
    else if (ch === 'D') dollPos = px;
    else if (ch === 'L') letterPos = px;
    else if (ch === 'E') exitPos = px;
    else if (ch === 'B') braziers.push(px);
  }
}

function isSolid(c, r) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
  return grid[r][c] === '#';
}
function solidPx(x, y) { return isSolid(Math.floor(x / TILE), Math.floor(y / TILE)); }

/* ---------------- DOM ---------------- */
const $ = s => document.querySelector(s);
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const el = {
  stage: $('#stage'), scaler: $('#scaler'),
  hud: $('#hud'), roundTag: $('#roundTag'), objective: $('#objectiveText'),
  condDoll: $('#condDoll'), condCandle: $('#condCandle'),
  fuel: $('#fuelBar'), stamina: $('#staminaBar'), aff: $('#affBar'), affNum: $('#affNum'),
  fragNum: $('#fragNum'), toast: $('#toast'), mute: $('#muteBtn'),
  dlg: $('#dialogue'), dlgName: $('#dlgName'), dlgText: $('#dlgText'),
  dlgNext: $('#dlgNext'), dlgAff: $('#dlgAff'), choices: $('#choices'),
  portrait: $('#portrait'), pbox: $('.dlg-portrait'), affFloat: $('#affFloat'),
  title: $('#titleScreen'), dead: $('#deadScreen'), deadReason: $('#deadReason'),
  ending: $('#endingScreen'), endTag: $('#endTag'), endTitle: $('#endTitle'),
  endDesc: $('#endDesc'), endStats: $('#endStats'), flash: $('#flash')
};

/* ---------------- 사운드 ---------------- */
const Snd = (() => {
  let ac = null, muted = false;
  function ensure() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, f2, dur, type, vol, delay) {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(1, f), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f2 === undefined ? f : f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  return {
    unlock() { ensure(); },
    get muted() { return muted; },
    toggle() { muted = !muted; return muted; },
    tick() { tone(1500, 1100, 0.018, 'square', 0.008); },
    pick() { tone(740, 740, 0.1, 'triangle', 0.05); tone(1108, 1108, 0.14, 'triangle', 0.04, 0.07); },
    good() { tone(523, 523, 0.12, 'sine', 0.05); tone(784, 784, 0.18, 'sine', 0.045, 0.09); },
    bad() { tone(220, 130, 0.25, 'sawtooth', 0.045); },
    sting() { tone(200, 38, 0.9, 'sawtooth', 0.085); tone(90, 30, 1.1, 'square', 0.05); },
    thump() { tone(74, 46, 0.16, 'sine', 0.09); },
    select() { tone(880, 1320, 0.06, 'triangle', 0.035); },
    door() { tone(300, 620, 0.7, 'sine', 0.05); }
  };
})();

/* ---------------- 유틸 ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function hash2(c, r) {
  let h = c * 374761393 + r * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

/* ---------------- 상태 ---------------- */
const G = {
  mode: 'title',      // title | play | dialogue | cutscene | dead | ending | finale
  time: 0,
  round: 1,
  aff: 0,
  memory: 0,
  hasDoll: false,
  hasLetter: false,
  fuel: 100,
  stamina: 100,
  exitOpen: false,
  ending: null,
  deaths: 0,
  keys: new Set(),
  shake: 0,
  fade: 1,
  flash: 0,
  dawn: 0,
  hitStop: 0,
  beatT: 0,
  toastT: 0,
  outWarned: false,
  relightToast: false,
  player: { x: startPos.x, y: startPos.y, dir: 1, walk: 0, run: false, tired: 0 },
  ghost: { x: ghostPos.x, y: ghostPos.y, speed: 80, mode: 'idle', idle: 2, path: [], pathT: 0, bob: 0, alpha: 1, anger: 0 },
  items: []
};

/* ---------------- 배경 프리렌더 ---------------- */
const mapCv = document.createElement('canvas');
mapCv.width = W; mapCv.height = H;

function renderMap() {
  const g = mapCv.getContext('2d');
  g.fillStyle = '#04050a';
  g.fillRect(0, 0, W, H);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE, y = r * TILE;
      const h = hash2(c, r);
      if (isSolid(c, r)) {
        // 벽
        const shade = 44 + Math.floor(h * 12);
        g.fillStyle = `rgb(${shade + 4},${shade + 9},${shade + 20})`;
        g.fillRect(x, y, TILE, TILE);
        // 벽돌 결
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.lineWidth = 1;
        const off = (r % 2) * 16;
        g.beginPath();
        g.moveTo(x, y + 16); g.lineTo(x + TILE, y + 16);
        g.moveTo(x + off, y); g.lineTo(x + off, y + 16);
        g.moveTo(x + 16 - off, y + 16); g.lineTo(x + 16 - off, y + TILE);
        g.stroke();
        // 상단 하이라이트
        if (!isSolid(c, r - 1)) {
          g.fillStyle = 'rgba(120,140,190,0.16)';
          g.fillRect(x, y, TILE, 2);
          g.fillStyle = 'rgba(90,110,160,0.06)';
          g.fillRect(x, y + 2, TILE, 5);
        }
        // 그림자
        if (!isSolid(c, r + 1)) {
          const sg = g.createLinearGradient(0, y + TILE - 10, 0, y + TILE);
          sg.addColorStop(0, 'rgba(0,0,0,0)');
          sg.addColorStop(1, 'rgba(0,0,0,0.75)');
          g.fillStyle = sg;
          g.fillRect(x, y + TILE - 10, TILE, 10);
        }
      } else {
        // 바닥
        const base = 26 + Math.floor(h * 9);
        g.fillStyle = `rgb(${base},${base + 3},${base + 11})`;
        g.fillRect(x, y, TILE, TILE);
        // 타일 이음새
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(x, y, TILE, 1);
        g.fillRect(x, y, 1, TILE);
        g.fillStyle = 'rgba(255,255,255,0.018)';
        g.fillRect(x + 1, y + 1, TILE - 1, 1);
        // 얼룩
        if (h > 0.82) {
          g.fillStyle = `rgba(0,0,0,${0.25 + h * 0.2})`;
          g.beginPath();
          g.ellipse(x + TILE * 0.5, y + TILE * 0.5, TILE * 0.42, TILE * 0.3, h * 6, 0, 7);
          g.fill();
        }
        if (h < 0.06) {
          g.fillStyle = 'rgba(90,40,50,0.12)';
          g.beginPath();
          g.ellipse(x + TILE * 0.45, y + TILE * 0.6, TILE * 0.3, TILE * 0.18, 0, 0, 7);
          g.fill();
        }
      }
    }
  }
  // 벽 밑 어둠
  const vg = g.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, 'rgba(0,0,0,0.25)');
  vg.addColorStop(0.5, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}

/* ---------------- 조명 캔버스 ---------------- */
const lightCv = document.createElement('canvas');
lightCv.width = W; lightCv.height = H;
const lctx = lightCv.getContext('2d');

const noiseCv = document.createElement('canvas');
noiseCv.width = 128; noiseCv.height = 128;
(function makeNoise() {
  const n = noiseCv.getContext('2d');
  const img = n.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 135;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 26;
  }
  n.putImageData(img, 0, 0);
})();
const noisePat = ctx.createPattern(noiseCv, 'repeat');

/* ---------------- 라운드 셋업 ---------------- */
const ROUND_TITLE = ['', '첫 조우', '다시, 복도', '기억의 조각', '복도 끝'];
const ROUND_OBJECTIVE = [
  '',
  '복도 어딘가의 인형을 찾아라. 그녀에게 보여줄 것이 필요하다.',
  '기억의 파편을 모아라. 그리고 다시, 그녀에게 잡혀라.',
  '편지를 찾아라. 돌려주지 못한 것이 있다.',
  '복도 끝의 문으로. …그 전에, 그녀에게 답을 하자.'
];

function respawn(kind) {
  const p = G.player;
  p.x = startPos.x; p.y = startPos.y; p.walk = 0; p.tired = 0;
  G.ghost.x = ghostPos.x; G.ghost.y = ghostPos.y;
  G.ghost.mode = 'idle'; G.ghost.idle = 2.0; G.ghost.path = [];
  G.fuel = 100; G.stamina = 100;
  if (kind !== 'keep') { G.fade = 1; }
}

function startRound(n) {
  G.round = n;
  G.exitOpen = false;
  G.ending = null;
  G.dawn = 0;
  respawn('keep');
  G.ghost.speed = 82 + (n - 1) * 16;
  G.fade = 1;
  spawnFragments(3);
  updateObjective();
  toast(`ROUND ${n}\n${ROUND_TITLE[n]}`, 2600);
  G.mode = 'play';
}

function spawnFragments(count) {
  const pool = FRAG_SPOTS.slice();
  G.items = G.items.filter(it => it.type !== 'frag');
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const [c, r] = pool.splice(idx, 1)[0];
    G.items.push({ type: 'frag', x: c * TILE + 16, y: r * TILE + 16, t: Math.random() * 6 });
  }
  if (dollPos && !G.hasDoll && !G.items.some(i => i.type === 'doll'))
    G.items.push({ type: 'doll', x: dollPos.x, y: dollPos.y, t: 0 });
  if (letterPos && !G.hasLetter && !G.items.some(i => i.type === 'letter'))
    G.items.push({ type: 'letter', x: letterPos.x, y: letterPos.y, t: 2 });
}

function updateObjective() {
  el.roundTag.textContent = 'ROUND ' + G.round;
  refreshObjective();
}

/* ---------------- 입력 ---------------- */
const MOVE_KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0]
};

window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  const k = e.key;

  if (k === 'm' || k === 'M') { toggleMute(); return; }

  if (G.mode === 'dialogue' || G.mode === 'cutscene') {
    if (k === ' ' || k === 'Enter' || k === 'ArrowDown') { advanceDialogue(); }
    else if (/^[1-9]$/.test(k)) { pickChoice(Number(k) - 1); }
    else if (k === 'ArrowUp') { advanceDialogue(); }
    return;
  }
  if (k === ' ' && G.mode === 'title') { startGame(); return; }
  if (k === ' ' && G.mode === 'dead') { retry(); return; }
  if (G.mode === 'play' || G.mode === 'finale') {
    G.keys.add(k);
    if (k === 'Shift') G.player.run = true;
  }
});

window.addEventListener('keyup', e => {
  G.keys.delete(e.key);
  if (e.key === 'Shift') G.player.run = false;
});

window.addEventListener('blur', () => { G.keys.clear(); G.player.run = false; });

function moveAxis() {
  let dx = 0, dy = 0;
  for (const k of G.keys) {
    const m = MOVE_KEYS[k];
    if (m) { dx += m[0]; dy += m[1]; }
  }
  return [clamp(dx, -1, 1), clamp(dy, -1, 1)];
}

/* ---------------- 플레이어 ---------------- */
const HALF = 7;

function collides(x, y) {
  return solidPx(x - HALF, y - HALF) || solidPx(x + HALF, y - HALF) ||
         solidPx(x - HALF, y + HALF) || solidPx(x + HALF, y + HALF);
}

// 벽에 살짝 걸렸을 때 자동으로 통로 중앙으로 밀어준다 (조작감 보정)
function slideMove(p, axis, amt) {
  if (!amt) return;
  if (!collides(axis === 'x' ? p.x + amt : p.x, axis === 'y' ? p.y + amt : p.y)) {
    if (axis === 'x') p.x += amt; else p.y += amt;
    return;
  }
  for (const off of [-3, 3, -6, 6]) {
    if (axis === 'x') {
      if (!collides(p.x + amt, p.y + off) && !collides(p.x, p.y + off)) { p.x += amt; p.y += off; return; }
    } else {
      if (!collides(p.x + off, p.y + amt) && !collides(p.x + off, p.y)) { p.y += amt; p.x += off; return; }
    }
  }
}

function updatePlayer(dt) {
  const p = G.player;
  const [dx, dy] = moveAxis();
  const moving = dx !== 0 || dy !== 0;

  const wantRun = p.run && G.stamina > 1 && moving;
  let speed = wantRun ? 198 : 134;
  if (G.fuel <= 0) speed *= 0.94;

  if (wantRun) {
    G.stamina = clamp(G.stamina - 32 * dt, 0, 100);
    p.tired = 0.6;
  } else {
    p.tired -= dt;
    if (p.tired <= 0) G.stamina = clamp(G.stamina + 22 * dt, 0, 100);
  }

  let len = Math.hypot(dx, dy) || 1;
  const vx = dx / len * speed * dt;
  const vy = dy / len * speed * dt;

  if (vx) slideMove(p, 'x', vx);
  if (vy) slideMove(p, 'y', vy);

  if (dx !== 0) p.dir = dx;
  if (moving) {
    p.walk += dt * (wantRun ? 15 : 9);
    if (wantRun) G.fuel = clamp(G.fuel - 0.9 * dt, 0, 100);
  } else {
    p.walk += dt * 1.2;
  }

  // 촛불 연료
  G.fuel = clamp(G.fuel - 1.15 * dt, 0, 100);

  if (G.fuel <= 0 && !G.outWarned) {
    G.outWarned = true;
    Snd.bad();
    toast('촛불이 꺼졌다.\n복도의 촛대에서 다시 밝힐 수 있다.', 2600);
  }
  if (G.fuel > 40) G.outWarned = false;

  // 촛대
  for (const b of braziers) {
    if (dist2(p.x, p.y, b.x, b.y) < 46) {
      if (G.fuel < 99.5) {
        const wasDark = G.fuel < 6;
        G.fuel = clamp(G.fuel + 46 * dt, 0, 100);
        if (wasDark && G.fuel > 30 && !G.relightToast) {
          G.relightToast = true;
          Snd.good();
          toast('촛불을 다시 밝혔다.', 1600);
          setTimeout(() => { G.relightToast = false; }, 4000);
        }
      }
    }
  }

  // 아이템
  for (let i = G.items.length - 1; i >= 0; i--) {
    const it = G.items[i];
    if (dist2(p.x, p.y, it.x, it.y) < 22) {
      G.items.splice(i, 1);
      onPickup(it);
    }
  }
}

function onPickup(it) {
  if (it.type === 'frag') {
    G.memory++;
    addAff(3, true);
    Snd.pick();
    toast('기억의 파편을 주웠다.\n호감도 +3', 1500);
  } else if (it.type === 'doll') {
    G.hasDoll = true;
    Snd.pick();
    toast('소울 인형을 얻었다.\n— 촛불을 밝힌 채 잡히면, 그녀가 말을 건다.', 2800);
    refreshObjective();
  } else if (it.type === 'letter') {
    G.hasLetter = true;
    Snd.pick();
    toast('부치지 못한 편지를 얻었다.\n— 이름이 지워져 있다.', 2400);
  }
}

function refreshObjective() {
  if (G.exitOpen) { el.objective.textContent = '복도 끝의 문으로. 그녀와 함께.'; return; }
  if (G.round === 1 && G.hasDoll) { el.objective.textContent = '촛불을 밝힌 채로, 그녀에게 잡혀라.'; return; }
  el.objective.textContent = ROUND_OBJECTIVE[G.round] || '';
}

/* ---------------- 귀신 ---------------- */
function bfs(sr, sc, tr, tc) {
  if (isSolid(tr, tc)) return [];
  const prev = new Int32Array(COLS * ROWS).fill(-2);
  const start = sr * COLS + sc;
  if (isSolid(sr, sc)) return [];
  prev[start] = -1;
  const q = [start];
  let head = 0, found = false;
  while (head < q.length) {
    const cur = q[head++];
    const r = (cur / COLS) | 0, c = cur % COLS;
    if (r === tr && c === tc) { found = true; break; }
    const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (let n = 0; n < 4; n++) {
      const nr = nb[n][0], nc = nb[n][1];
      if (isSolid(nr, nc)) continue;
      const k = nr * COLS + nc;
      if (prev[k] !== -2) continue;
      prev[k] = cur;
      q.push(k);
    }
  }
  if (!found) return [];
  const out = [];
  let k = tr * COLS + tc;
  while (k !== -1) { out.push({ r: (k / COLS) | 0, c: k % COLS }); k = prev[k]; }
  return out.reverse();
}

function updateGhost(dt) {
  const gh = G.ghost;
  gh.bob += dt;

  if (G.mode === 'finale') { followPlayer(dt); return; }

  if (gh.mode === 'idle') {
    gh.idle -= dt;
    if (gh.idle <= 0) gh.mode = 'chase';
    return;
  }
  if (G.mode !== 'play') return;

  const p = G.player;
  gh.pathT -= dt;
  const pc = { c: Math.floor(p.x / TILE), r: Math.floor(p.y / TILE) };
  const gc = { c: Math.floor(gh.x / TILE), r: Math.floor(gh.y / TILE) };

  if (gh.pathT <= 0 || gh.path.length === 0) {
    const path = bfs(gc.r, gc.c, pc.r, pc.c);
    if (path.length > 1) { path.shift(); gh.path = path; }
    else gh.path = [];
    gh.pathT = 0.24;
  }

  if (gh.path.length) {
    const t = gh.path[0];
    const tx = t.c * TILE + 16, ty = t.r * TILE + 16;
    const ddx = tx - gh.x, ddy = ty - gh.y;
    const d = Math.hypot(ddx, ddy);
    if (d < 2.5) {
      gh.path.shift();
    } else {
      const step = Math.min(d, gh.speed * dt);
      gh.x += ddx / d * step;
      gh.y += ddy / d * step;
    }
  }

  // 잡힘
  if (dist2(gh.x, gh.y, p.x, p.y) < 23) onCapture();
}

function followPlayer(dt) {
  const gh = G.ghost, p = G.player;
  const d = dist2(gh.x, gh.y, p.x, p.y);
  const target = 52;
  if (d > target + 4) {
    const sp = Math.min(190, 55 + (d - target) * 2.0);
    gh.x += (p.x - gh.x) / d * sp * dt;
    gh.y += (p.y - gh.y) / d * sp * dt;
    gh.dir = (p.x - gh.x) < 0 ? -1 : 1;
  }
}

/* ---------------- 잡힘 / 사망 ---------------- */
function onCapture() {
  const lit = G.fuel > 0.1;
  if (G.hasDoll && lit) {
    Snd.sting();
    G.shake = 1;
    G.flash = 0.5;
    G.hitStop = 0.42;
    G.ghost.mode = 'idle';
    G.ghost.idle = 99;
    G.mode = 'hitstop';
    return;
  }
  let reason;
  if (!G.hasDoll && !lit) reason = '인형도 없이, 불빛도 없이 그녀를 마주했다.\n그녀의 손이 너를 알아보지 못했다.';
  else if (!G.hasDoll) reason = '불빛은 있었다. 하지만 그녀를 알아볼 인형이 없었다.\n불빛은, 그저 너를 비출 뿐이었다.';
  else reason = '인형은 있었다. 하지만 촛불이 꺼져 있었다.\n어둠 속에서 그녀는 너를 사람으로 보지 않았다.';
  die(reason);
}

function die(reason) {
  G.mode = 'dead';
  G.deaths++;
  G.shake = 1.4;
  G.flash = 0.25;
  Snd.sting();
  el.deadReason.textContent = reason;
  el.dead.classList.remove('hidden');
  el.hud.classList.add('dim');
}

function retry() {
  el.dead.classList.add('hidden');
  el.hud.classList.remove('dim');
  respawn('keep');
  G.ghost.mode = 'idle';
  G.ghost.idle = 2.2;
  G.fade = 1;
  G.mode = 'play';
  spawnFragments(Math.max(2, 3 - G.round));
}

/* ---------------- 렌더 ---------------- */
function drawPlayer(c) {
  const p = G.player;
  const x = p.x, y = p.y;
  const bob = Math.sin(p.walk) * 1.4;

  c.save();
  // 그림자
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.beginPath(); c.ellipse(x, y + 9, 11, 5, 0, 0, 7); c.fill();

  // 몸
  c.fillStyle = '#222a3b';
  c.beginPath();
  c.ellipse(x, y + bob - 1, 7.5, 9.5, 0, 0, 7);
  c.fill();
  c.fillStyle = '#2d3a52';
  c.beginPath();
  c.ellipse(x, y + bob - 3, 6.5, 7, 0, 0, 7);
  c.fill();

  // 머리
  c.fillStyle = '#e4d8cf';
  c.beginPath(); c.arc(x, y + bob - 13, 5.8, 0, 7); c.fill();
  // 머리카락
  c.fillStyle = '#1a1620';
  c.beginPath();
  c.arc(x, y + bob - 14.5, 6, Math.PI, Math.PI * 2);
  c.fill();
  c.fillRect(x - 6, y + bob - 14.5, 12, 2.5);

  // 촛불
  const lit = G.fuel > 0;
  const cx = x + (p.dir > 0 ? 8 : -8), cy = y + bob - 2;
  c.fillStyle = '#d9cbb4';
  c.fillRect(cx - 1.5, cy - 7, 3, 8);
  if (lit) {
    const fl = 1 + Math.sin(G.time * 17) * 0.18 + Math.sin(G.time * 31) * 0.1;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const gg = c.createRadialGradient(cx, cy - 9, 0, cx, cy - 9, 16);
    gg.addColorStop(0, 'rgba(255,214,140,0.85)');
    gg.addColorStop(0.4, 'rgba(255,150,60,0.3)');
    gg.addColorStop(1, 'rgba(255,120,40,0)');
    c.fillStyle = gg;
    c.beginPath(); c.arc(cx, cy - 9, 16 * fl, 0, 7); c.fill();
    c.restore();

    c.fillStyle = '#ffcf85';
    c.beginPath();
    c.ellipse(cx, cy - 10, 2.2, 4.2 * fl, 0, 0, 7);
    c.fill();
    c.fillStyle = '#fff6e0';
    c.beginPath();
    c.ellipse(cx, cy - 10.5, 1.1, 2.2 * fl, 0, 0, 7);
    c.fill();
  }
  c.restore();
}

function drawGhostWorld(c, alphaOverride) {
  const gh = G.ghost;
  const p = G.player;
  const d = dist2(gh.x, gh.y, p.x, p.y);
  const friendly = G.mode === 'finale' || G.exitOpen;
  const hostile = !friendly && d < 150;
  const bob = Math.sin(gh.bob * 1.7) * 3.2;
  const x = gh.x, y = gh.y + bob - 4;
  const alpha = (alphaOverride === undefined ? 1 : alphaOverride) * gh.alpha;

  c.save();
  c.globalAlpha = alpha;

  // 그림자
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath(); c.ellipse(x, gh.y + 14, 13, 4, 0, 0, 7); c.fill();

  // 오라
  c.save();
  c.globalCompositeOperation = 'lighter';
  const aura = c.createRadialGradient(x, y - 12, 4, x, y - 12, 46);
  aura.addColorStop(0, friendly ? 'rgba(255,200,140,0.20)' : (hostile ? 'rgba(255,60,90,0.16)' : 'rgba(150,180,255,0.12)'));
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = aura;
  c.beginPath(); c.arc(x, y - 12, 46, 0, 7); c.fill();
  c.restore();

  // 드레스
  const dg = c.createLinearGradient(0, y - 30, 0, y + 20);
  dg.addColorStop(0, friendly ? '#fff4e6' : '#f2f0ff');
  dg.addColorStop(0.55, friendly ? '#e8d6c8' : '#cfd3ec');
  dg.addColorStop(1, 'rgba(170,180,215,0)');
  c.fillStyle = dg;
  c.beginPath();
  c.moveTo(x - 7, y - 26);
  c.bezierCurveTo(x - 15, y - 12, x - 17, y + 2, x - 14, y + 16);
  c.quadraticCurveTo(x - 7, y + 11, x, y + 18);
  c.quadraticCurveTo(x + 7, y + 11, x + 14, y + 16);
  c.bezierCurveTo(x + 17, y + 2, x + 15, y - 12, x + 7, y - 26);
  c.closePath();
  c.fill();

  // 어깨 / 목
  c.fillStyle = friendly ? '#f7e8d8' : '#e6e4f5';
  c.fillRect(x - 3, y - 30, 6, 6);

  // 머리카락 뒤
  c.fillStyle = '#0b0810';
  c.beginPath();
  c.ellipse(x, y - 37, 13, 15, 0, 0, 7);
  c.fill();
  // 긴 머리
  c.beginPath();
  c.moveTo(x - 12, y - 38);
  c.bezierCurveTo(x - 19, y - 20, x - 16, y - 4, x - 13, y + 4);
  c.lineTo(x - 7, y + 2);
  c.bezierCurveTo(x - 10, y - 12, x - 10, y - 26, x - 6, y - 36);
  c.closePath();
  c.fill();
  c.beginPath();
  c.moveTo(x + 12, y - 38);
  c.bezierCurveTo(x + 19, y - 20, x + 16, y - 4, x + 13, y + 4);
  c.lineTo(x + 7, y + 2);
  c.bezierCurveTo(x + 10, y - 12, x + 10, y - 26, x + 6, y - 36);
  c.closePath();
  c.fill();

  // 얼굴
  c.fillStyle = friendly ? '#f8ecdf' : '#efedf8';
  c.beginPath();
  c.ellipse(x, y - 36, 9.5, 11, 0, 0, 7);
  c.fill();

  // 눈
  const eyeGlow = hostile || G.mode === 'finale' ? (friendly ? '#5a2a20' : '#ff3355') : '#1a1220';
  for (const s of [-1, 1]) {
    c.fillStyle = eyeGlow;
    c.beginPath();
    c.ellipse(x + s * 4, y - 36, 1.7, 2.4, 0, 0, 7);
    c.fill();
  }
  if (friendly) {
    // 웃는 눈
    c.strokeStyle = '#3a2018';
    c.lineWidth = 1.2;
    c.beginPath();
    c.arc(x - 4, y - 35, 2, Math.PI * 1.15, Math.PI * 1.85);
    c.arc(x + 4, y - 35, 2, Math.PI * 1.15, Math.PI * 1.85);
    c.stroke();
  }
  // 입
  c.fillStyle = friendly ? 'rgba(150,80,70,0.7)' : 'rgba(80,50,70,0.65)';
  c.beginPath();
  c.ellipse(x, y - 31, 1.6, friendly ? 1.2 : 0.8, 0, 0, 7);
  c.fill();

  // 앞머리
  c.fillStyle = '#0b0810';
  c.beginPath();
  c.moveTo(x - 10, y - 41);
  c.quadraticCurveTo(x - 2, y - 48, x + 10, y - 41);
  c.quadraticCurveTo(x + 7, y - 40, x + 4, y - 43);
  c.quadraticCurveTo(x - 1, y - 38, x - 6, y - 42);
  c.closePath();
  c.fill();

  c.restore();
}

function drawItems(c) {
  for (const it of G.items) {
    const t = G.time + it.t;
    const fl = Math.sin(t * 2.2) * 0.5 + 0.5;
    const y = it.y + Math.sin(t * 1.8) * 2.5;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const col = it.type === 'doll' ? '255,190,220' : it.type === 'letter' ? '255,235,180' : '150,210,255';
    const g = c.createRadialGradient(it.x, y, 0, it.x, y, 26 + fl * 8);
    g.addColorStop(0, `rgba(${col},${0.32 + fl * 0.14})`);
    g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    c.beginPath(); c.arc(it.x, y, 26 + fl * 8, 0, 7); c.fill();
    c.restore();

    c.save();
    c.translate(it.x, y);
    if (it.type === 'frag') {
      c.rotate(t * 0.6);
      c.fillStyle = '#cfe8ff';
      c.beginPath();
      c.moveTo(0, -7); c.lineTo(4.5, 0); c.lineTo(0, 7); c.lineTo(-4.5, 0);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.beginPath(); c.moveTo(0, -7); c.lineTo(2, -1); c.lineTo(0, 1); c.closePath(); c.fill();
    } else if (it.type === 'doll') {
      c.rotate(Math.sin(t) * 0.12);
      c.fillStyle = '#f3dfe8';
      c.beginPath(); c.arc(0, -5, 4.5, 0, 7); c.fill();
      c.beginPath(); c.ellipse(0, 1, 4, 5.5, 0, 0, 7); c.fill();
      c.fillStyle = '#33222c';
      c.beginPath(); c.arc(-1.6, -5.5, 0.9, 0, 7); c.arc(1.6, -5.5, 0.9, 0, 7); c.fill();
      c.fillStyle = '#c98aa6';
      c.beginPath(); c.arc(0, 0.5, 3, 0, 7); c.fill();
    } else if (it.type === 'letter') {
      c.rotate(Math.sin(t * 1.2) * 0.08);
      c.fillStyle = '#efe4c8';
      c.fillRect(-7, -5, 14, 10);
      c.strokeStyle = 'rgba(120,100,70,0.7)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(-7, -5); c.lineTo(0, 1); c.lineTo(7, -5); c.stroke();
    }
    c.restore();
  }
}

function drawBraziers(c) {
  for (const b of braziers) {
    const fl = 0.6 + Math.sin(G.time * 7 + b.x) * 0.2 + Math.sin(G.time * 13 + b.y) * 0.1;
    // 기둥
    c.fillStyle = '#2a2630';
    c.fillRect(b.x - 2.5, b.y - 4, 5, 16);
    c.fillStyle = '#3a3440';
    c.fillRect(b.x - 6, b.y - 8, 12, 5);
    // 불
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(b.x, b.y - 14, 0, b.x, b.y - 14, 34 * fl);
    g.addColorStop(0, 'rgba(255,220,160,0.55)');
    g.addColorStop(0.4, 'rgba(255,160,70,0.22)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(b.x, b.y - 14, 34 * fl, 0, 7); c.fill();
    c.restore();
    c.fillStyle = '#ffd18a';
    c.beginPath(); c.ellipse(b.x, b.y - 13, 3, 6 * fl, 0, 0, 7); c.fill();
    c.fillStyle = '#fff7e6';
    c.beginPath(); c.ellipse(b.x, b.y - 14, 1.4, 3 * fl, 0, 0, 7); c.fill();
  }
}

function drawExit(c) {
  const e = exitPos;
  const open = G.exitOpen;
  c.save();
  // 문
  c.fillStyle = '#0a0b12';
  c.beginPath();
  c.moveTo(e.x - 13, e.y + 14);
  c.lineTo(e.x - 13, e.y - 12);
  c.quadraticCurveTo(e.x, e.y - 24, e.x + 13, e.y - 12);
  c.lineTo(e.x + 13, e.y + 14);
  c.closePath();
  c.fill();

  if (open) {
    const t = G.time;
    const pulse = 0.5 + Math.sin(t * 2.4) * 0.2;
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(e.x, e.y - 4, 0, e.x, e.y - 4, 60);
    g.addColorStop(0, `rgba(255,240,210,${0.5 + pulse * 0.3})`);
    g.addColorStop(0.4, 'rgba(255,200,140,0.18)');
    g.addColorStop(1, 'rgba(255,180,110,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(e.x, e.y - 4, 60, 0, 7); c.fill();
    c.globalCompositeOperation = 'source-over';

    c.fillStyle = `rgba(255,248,230,${0.75 + pulse * 0.2})`;
    c.beginPath();
    c.moveTo(e.x - 10, e.y + 12);
    c.lineTo(e.x - 10, e.y - 10);
    c.quadraticCurveTo(e.x, e.y - 20, e.x + 10, e.y - 10);
    c.lineTo(e.x + 10, e.y + 12);
    c.closePath();
    c.fill();
  } else {
    c.strokeStyle = 'rgba(150,170,210,0.25)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(e.x - 9, e.y + 12);
    c.lineTo(e.x - 9, e.y - 10);
    c.quadraticCurveTo(e.x, e.y - 19, e.x + 9, e.y - 10);
    c.lineTo(e.x + 9, e.y + 12);
    c.stroke();
    // 자물쇠
    c.fillStyle = 'rgba(180,190,220,0.45)';
    c.fillRect(e.x - 2.5, e.y + 1, 5, 5);
  }
  c.restore();
}

function punch(x, y, r, a) {
  const g = lctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(0.42, `rgba(0,0,0,${a * 0.93})`);
  g.addColorStop(0.7, `rgba(0,0,0,${a * 0.62})`);
  g.addColorStop(0.88, `rgba(0,0,0,${a * 0.24})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  lctx.fillStyle = g;
  lctx.beginPath(); lctx.arc(x, y, r, 0, 7); lctx.fill();
}

function drawLighting() {
  const p = G.player, gh = G.ghost;
  const dg = dist2(gh.x, gh.y, p.x, p.y);

  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, W, H);
  lctx.fillStyle = 'rgba(3,4,9,0.9)';
  lctx.fillRect(0, 0, W, H);

  lctx.globalCompositeOperation = 'destination-out';

  let rad;
  if (G.mode === 'finale') rad = 190 + Math.sin(G.time * 1.6) * 5;
  else if (G.fuel > 0) {
    rad = 158 + Math.sin(G.time * 8.5) * 5 + Math.sin(G.time * 21) * 2.5;
    if (dg < 150) rad *= 0.86 + 0.14 * Math.sin(G.time * 30) * 0.5 + 0.07;
  } else rad = 62 + Math.sin(G.time * 3) * 2;

  punch(p.x, p.y, rad, 1);
  for (const b of braziers) punch(b.x, b.y - 8, 104 + Math.sin(G.time * 6 + b.x) * 6, 0.8);
  for (const it of G.items) punch(it.x, it.y, 42, 0.6);
  if (G.exitOpen) punch(exitPos.x, exitPos.y, 130, 0.85);

  lctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(lightCv, 0, 0);

  // 따뜻한 빛 번짐
  if (G.fuel > 0 || G.mode === 'finale') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y - 6, 0, p.x, p.y - 6, rad * 0.95);
    g.addColorStop(0, G.mode === 'finale' ? 'rgba(255,215,160,0.16)' : 'rgba(255,180,100,0.13)');
    g.addColorStop(0.5, 'rgba(255,150,70,0.045)');
    g.addColorStop(1, 'rgba(255,120,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y - 6, rad * 0.95, 0, 7); ctx.fill();
    ctx.restore();
  }

  // 어둠 속의 눈 (가까울 때만)
  if (G.mode === 'play' && dg < 230 && dg > 40) {
    const a = clamp((230 - dg) / 190, 0, 1);
    const ghb = gh.y + Math.sin(gh.bob * 1.7) * 3.2 - 40;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of [-1, 1]) {
      const g = ctx.createRadialGradient(gh.x + s * 4, ghb, 0, gh.x + s * 4, ghb, 9);
      g.addColorStop(0, `rgba(255,70,100,${0.5 * a})`);
      g.addColorStop(1, 'rgba(255,0,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(gh.x + s * 4, ghb, 9, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // 심장 박동 붉은 비네트
  if ((G.mode === 'play' || G.mode === 'hitstop') && dg < 260) {
    const a = clamp((260 - dg) / 260, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 7.5);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, 'rgba(120,0,20,0)');
    g.addColorStop(1, `rgba(120,0,24,${0.34 * a * (0.45 + pulse * 0.55)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // 비네트
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.92);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // 그레인
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.translate(-Math.random() * 128, -Math.random() * 128);
  ctx.fillStyle = noisePat;
  ctx.fillRect(0, 0, W + 128, H + 128);
  ctx.restore();
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (G.shake > 0.01) {
    const s = G.shake * 9;
    ctx.translate(rnd(-s, s), rnd(-s, s));
  }
  ctx.drawImage(mapCv, 0, 0);
  drawExit(ctx);
  drawBraziers(ctx);
  drawItems(ctx);
  drawGhostWorld(ctx);
  drawPlayer(ctx);  ctx.restore();

  drawLighting();

  if (G.flash > 0.001) {
    ctx.fillStyle = `rgba(255,240,245,${G.flash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (G.dawn > 0.001) {
    const d = G.dawn;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(255,244,226,${d * 0.72})`);
    g.addColorStop(0.55, `rgba(255,232,205,${d * 0.55})`);
    g.addColorStop(1, `rgba(255,220,190,${d * 0.68})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (G.fade > 0.001) {
    ctx.fillStyle = `rgba(2,3,7,${G.fade})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/* ---------------- 대화 엔진 ---------------- */
const D = {
  steps: [], idx: -1, full: '', shown: 0, typing: false,
  pending: null, onEnd: null, cutscene: false, expr: 'neutral', poll: 0,
  choiceOpen: false
};

function setPortrait(expr, dim) {
  D.expr = expr || D.expr;
  el.pbox.classList.toggle('off', !!dim);
  drawPortrait(D.expr);
}

function advanceDialogue() {
  if (D.typing) {
    D.shown = D.full.length;
    finishTyping();
    return;
  }
  if (D.pending) return;
  if (D.choiceOpen) return;
  nextStep();
}

function finishTyping() {
  D.typing = false;
  el.dlgText.textContent = D.full;
  if (D.pending) {
    buildChoices(D.pending);
    D.pending = null;
  } else {
    el.dlgNext.classList.add('show');
  }
}

function nextStep() {
  D.idx++;
  D.choiceOpen = false;
  if (D.idx >= D.steps.length) { endDialogue(); return; }
  const s = D.steps[D.idx];
  el.dlgNext.classList.remove('show');
  el.choices.classList.add('hidden');

  if (s.choice) {
    D.pending = s;
    showLine({ who: s.who || 'narr', text: s.text || '', expr: s.expr }, true);
    return;
  }
  showLine(s, false);
}

function showLine(s, keepPending) {
  const who = s.who || 'narr';
  const isNarr = who === 'narr';
  const isMe = who === 'me';

  el.dlgName.textContent = isNarr ? '기록' : isMe ? '나' : '유하';
  el.dlgName.className = 'dlg-name' + (isNarr ? ' narr' : '');
  el.dlgText.className = 'dlg-text' + (isNarr ? ' narr' : isMe ? ' me' : '');

  if (isNarr) setPortrait(D.expr, true);
  else if (isMe) setPortrait(D.expr, true);
  else setPortrait(s.expr || 'neutral', false);

  D.full = s.text || '';
  D.shown = 0;
  D.typing = true;
  el.dlgText.textContent = '';
  if (!keepPending) D.pending = null;
  if (!D.full) { finishTyping(); }
}

function updateTyping(dt) {
  if (!D.typing) return;
  D.shown += dt * 34;
  if (D.shown >= D.full.length) {
    finishTyping();
  } else {
    const n = Math.floor(D.shown);
    el.dlgText.textContent = D.full.slice(0, n);
    if (n - D.poll >= 2) { D.poll = n; Snd.tick(); }
  }
}

function buildChoices(step) {
  el.choices.innerHTML = '';
  el.choices.classList.remove('hidden');
  D.choiceOpen = true;
  step.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.dataset.i = String(i + 1);
    const lock = lockReason(opt);
    let html = '';
    if (opt.mark) html += `<span class="mark">${opt.mark}</span>`;
    html += opt.label;
    if (lock) {
      b.classList.add('locked');
      html += `<span class="lock">🔒 ${lock}</span>`;
    }
    b.innerHTML = html;
    b.addEventListener('click', () => pickChoice(i));
    b.addEventListener('mouseenter', () => { if (!lock) Snd.tick(); });
    el.choices.appendChild(b);
    b.style.animationDelay = (i * 45) + 'ms';
  });
}

function lockReason(opt) {
  if (opt.need === 'letter' && !G.hasLetter) return '편지 없음';
  if (opt.need === 'doll' && !G.hasDoll) return '인형 없음';
  if (opt.need === 'aff' && G.aff < opt.affMin) return `호감도 ${opt.affMin} 필요`;
  return null;
}

function pickChoice(i) {
  if (!D.choiceOpen) return;
  const step = D.steps[D.idx];
  if (!step || !step.choice) return;
  const opt = step.options[i];
  if (!opt) return;
  const lock = lockReason(opt);
  if (lock) { Snd.bad(); return; }

  el.choices.classList.add('hidden');
  el.choices.innerHTML = '';
  D.choiceOpen = false;

  if (opt.aff) {
    G.aff = clamp(G.aff + opt.aff, 0, 100);
    showAffPop(opt.aff);
    if (opt.aff > 0) Snd.good(); else Snd.bad();
  }
  el.dlgAff.textContent = Math.round(G.aff);

  if (opt.ending) G.ending = opt.ending;

  const extra = [];
  if (!opt.silent) extra.push({ who: 'me', text: opt.label });
  if (opt.reply) extra.push(...opt.reply);
  if (extra.length) D.steps.splice(D.idx + 1, 0, ...extra);

  nextStep();
}

function showAffPop(v) {
  const s = document.createElement('div');
  s.className = 'aff-pop' + (v < 0 ? ' minus' : '');
  s.textContent = (v > 0 ? '+' : '') + v + ' ♥';
  el.affFloat.appendChild(s);
  setTimeout(() => s.remove(), 1200);
}

function openDialogue(steps, onEnd) {
  D.steps = steps.map(s => ({ ...s }));
  D.idx = -1;
  D.onEnd = onEnd;
  D.cutscene = false;
  D.poll = 0;
  D.choiceOpen = false;
  el.dlg.classList.remove('hidden');
  el.hud.classList.add('dim');
  el.dlgAff.textContent = Math.round(G.aff);
  el.choices.classList.add('hidden');
  G.keys.clear();
  nextStep();
}

function endDialogue() {
  el.dlg.classList.add('hidden');
  el.choices.classList.add('hidden');
  el.choices.innerHTML = '';
  el.hud.classList.remove('dim');
  const cb = D.onEnd;
  D.onEnd = null;
  D.steps = [];
  if (cb) cb();
}

/* ---------------- 초상화 ---------------- */
function drawPortrait(expr) {
  const c = el.portrait.getContext('2d');
  c.clearRect(0, 0, 170, 170);
  const cx = 85, cy = 88, s = 1.5;

  c.save();
  // 배경 후광
  const bg = c.createRadialGradient(cx, cy, 10, cx, cy, 84);
  bg.addColorStop(0, 'rgba(120,150,230,0.16)');
  bg.addColorStop(0.6, 'rgba(60,70,120,0.06)');
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = bg;
  c.fillRect(0, 0, 170, 170);

  // 어깨
  c.fillStyle = '#d9dcee';
  c.beginPath();
  c.ellipse(cx, 168, 58, 34, 0, Math.PI, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f3f0fa';
  c.beginPath();
  c.ellipse(cx, 168, 46, 28, 0, Math.PI, Math.PI * 2);
  c.fill();

  // 머리카락 뒤
  c.fillStyle = '#0a0810';
  c.beginPath();
  c.ellipse(cx, cy - 4, 43 * s * 0.72, 47 * s * 0.72, 0, 0, 7);
  c.fill();
  c.beginPath();
  c.moveTo(cx - 44, cy - 20);
  c.bezierCurveTo(cx - 56, cy + 20, cx - 48, cy + 52, cx - 40, cy + 62);
  c.lineTo(cx - 22, cy + 56);
  c.bezierCurveTo(cx - 32, cy + 30, cx - 30, cy + 4, cx - 26, cy - 16);
  c.closePath();
  c.fill();
  c.beginPath();
  c.moveTo(cx + 44, cy - 20);
  c.bezierCurveTo(cx + 56, cy + 20, cx + 48, cy + 52, cx + 40, cy + 62);
  c.lineTo(cx + 22, cy + 56);
  c.bezierCurveTo(cx + 32, cy + 30, cx + 30, cy + 4, cx + 26, cy - 16);
  c.closePath();
  c.fill();

  // 목
  c.fillStyle = '#d8d0e0';
  c.fillRect(cx - 8, cy + 26, 16, 18);

  // 얼굴
  const fg = c.createLinearGradient(cx, cy - 40, cx, cy + 40);
  fg.addColorStop(0, '#f6f1f7');
  fg.addColorStop(0.65, '#e6dff0');
  fg.addColorStop(1, '#b8b0c8');
  c.fillStyle = fg;
  c.beginPath();
  c.ellipse(cx, cy, 23 * s, 29 * s, 0, 0, 7);
  c.fill();

  // 얼굴 볼륨 음영
  c.save();
  c.beginPath();
  c.ellipse(cx, cy, 23 * s, 29 * s, 0, 0, 7);
  c.clip();
  const sh = c.createRadialGradient(cx - 8, cy - 2, 6, cx, cy + 4, 56);
  sh.addColorStop(0, 'rgba(255,255,255,0.12)');
  sh.addColorStop(0.55, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(72,62,108,0.32)');
  c.fillStyle = sh;
  c.fillRect(cx - 62, cy - 64, 124, 128);
  c.restore();

  // 볼 터치
  if (expr === 'smile' || expr === 'surprised') {
    c.fillStyle = 'rgba(220,140,170,0.28)';
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.ellipse(cx + sx * 24, cy + 12, 9, 5, 0, 0, 7);
      c.fill();
    }
  }

  // 눈썹
  const browY = cy - 16;
  c.strokeStyle = '#2a2030';
  c.lineWidth = 2.6;
  c.lineCap = 'round';
  for (const sx of [-1, 1]) {
    c.beginPath();
    if (expr === 'sad') {
      c.moveTo(cx + sx * 9, browY - 3);
      c.lineTo(cx + sx * 25, browY + 1);
    } else if (expr === 'angry') {
      c.moveTo(cx + sx * 9, browY + 3);
      c.lineTo(cx + sx * 25, browY - 4);
    } else {
      c.moveTo(cx + sx * 10, browY);
      c.lineTo(cx + sx * 24, browY - 2);
    }
    c.stroke();
  }

  // 눈
  c.fillStyle = '#100c14';
  for (const sx of [-1, 1]) {
    const ex = cx + sx * 16, ey = cy + 2;
    if (expr === 'smile') {
      c.strokeStyle = '#1a1220';
      c.lineWidth = 3.4;
      c.beginPath();
      c.arc(ex, ey + 4, 8, Math.PI * 1.12, Math.PI * 1.88);
      c.stroke();
    } else {
      const wide = expr === 'surprised' ? 1.35 : expr === 'angry' ? 0.82 : 1;
      c.fillStyle = '#100c14';
      c.beginPath();
      c.ellipse(ex, ey, 7 * wide, 8.6 * wide, 0, 0, 7);
      c.fill();
      // 눈동자
      c.fillStyle = expr === 'angry' ? '#6a1024' : '#372844';
      c.beginPath();
      c.ellipse(ex, ey + 0.5, 4.6 * wide, 6 * wide, 0, 0, 7);
      c.fill();
      // 하이라이트
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.beginPath();
      c.arc(ex - 2.4, ey - 3.2, 2.2, 0, 7);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.beginPath();
      c.arc(ex + 2.2, ey + 3, 1.3, 0, 7);
      c.fill();
      // 속눈썹
      c.strokeStyle = '#100c14';
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(ex - 7.4, ey - 6);
      c.quadraticCurveTo(ex, ey - 10, ex + 7.4, ey - 6);
      c.stroke();
    }
  }

  // 입
  c.strokeStyle = '#8a5464';
  c.lineWidth = 2.2;
  c.beginPath();
  if (expr === 'smile') {
    c.arc(cx, cy + 22, 7, Math.PI * 0.18, Math.PI * 0.82);
  } else if (expr === 'sad') {
    c.arc(cx, cy + 27, 7, Math.PI * 1.18, Math.PI * 1.82);
  } else if (expr === 'surprised') {
    c.fillStyle = '#7a4454';
    c.ellipse(cx, cy + 23, 4, 5.5, 0, 0, 7);
    c.fill();
  } else if (expr === 'angry') {
    c.moveTo(cx - 6, cy + 22);
    c.quadraticCurveTo(cx, cy + 25, cx + 6, cy + 21);
  } else {
    c.moveTo(cx - 5, cy + 23);
    c.lineTo(cx + 5, cy + 23);
  }
  c.stroke();

  // 앞머리
  c.fillStyle = '#0a0810';
  c.beginPath();
  c.moveTo(cx - 40, cy - 22);
  c.quadraticCurveTo(cx - 30, cy - 62, cx, cy - 62);
  c.quadraticCurveTo(cx + 30, cy - 62, cx + 40, cy - 22);
  c.quadraticCurveTo(cx + 28, cy - 34, cx + 16, cy - 32);
  c.quadraticCurveTo(cx + 6, cy - 22, cx - 4, cy - 34);
  c.quadraticCurveTo(cx - 16, cy - 22, cx - 28, cy - 32);
  c.quadraticCurveTo(cx - 34, cy - 28, cx - 40, cy - 22);
  c.closePath();
  c.fill();

  // 머리카락 광택
  c.strokeStyle = 'rgba(150,165,225,0.30)';
  c.lineWidth = 3;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(cx - 33, cy - 34);
  c.quadraticCurveTo(cx - 34, cy - 60, cx - 4, cy - 66);
  c.stroke();
  c.strokeStyle = 'rgba(150,165,225,0.14)';
  c.beginPath();
  c.moveTo(cx + 14, cy - 62);
  c.quadraticCurveTo(cx + 30, cy - 52, cx + 32, cy - 34);
  c.stroke();

  // 앞머리 그림자
  c.save();
  c.beginPath();
  c.ellipse(cx, cy, 23 * s, 29 * s, 0, 0, 7);
  c.clip();
  const hs = c.createLinearGradient(0, cy - 44, 0, cy - 2);
  hs.addColorStop(0, 'rgba(10,6,18,0.5)');
  hs.addColorStop(1, 'rgba(10,6,18,0)');
  c.fillStyle = hs;
  c.fillRect(cx - 60, cy - 48, 120, 50);
  c.restore();

  // 차가운 림라이트
  c.strokeStyle = 'rgba(150,180,255,0.22)';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(cx, cy, 23 * s, 29 * s, 0, Math.PI * 0.86, Math.PI * 1.22);
  c.stroke();

  c.restore();
}

/* ---------------- 대화 데이터 ---------------- */
const DIALOGUES = {
  1: [
    { who: 'narr', text: '차가운 손이 목덜미를 붙잡았다.' },
    { who: 'narr', text: '심장이 멎는 줄 알았다. 그런데—' },
    { who: 'yuha', text: '……어라.', expr: 'surprised' },
    { who: 'yuha', text: '안 죽네.', expr: 'neutral' },
    { who: 'narr', text: '목을 누르던 손아귀가 스르르 풀린다. 어둠 속에서, 하얀 교복을 입은 여자애가 고개를 갸웃했다.' },
    { who: 'yuha', text: '너, 그 인형… 어디서 났어?', expr: 'sad' },
    {
      choice: true, text: '그녀의 시선이 네 품 안의 인형에 꽂혀 있다.',
      options: [
        {
          label: '돌려주려고 가져왔어. 네 거지?', aff: 18,
          reply: [
            { who: 'yuha', text: '……어.', expr: 'surprised' },
            { who: 'narr', text: '그녀의 형체가 한순간 또렷해진다. 손끝이 인형의 얼굴을 스치려다, 멈춘다.' }
          ]
        },
        {
          label: '바닥에 떨어져 있어서 주웠어.', aff: 10,
          reply: [
            { who: 'yuha', text: '그렇구나. …버려진 거였네.', expr: 'sad' }
          ]
        },
        {
          label: '왜, 이게 필요해?', aff: 4,
          reply: [
            { who: 'yuha', text: '글쎄. 나도 기억이 안 나.', expr: 'neutral' }
          ]
        },
        {
          label: '죽은 애가 인형은 무슨.', aff: -10,
          reply: [
            { who: 'narr', text: '복도가 삐걱였다. 그녀의 목이 이상한 각도로 기울어진다.' },
            { who: 'yuha', text: '…죽었으면, 만지면 안 돼?', expr: 'angry' }
          ]
        }
      ]
    },
    { who: 'yuha', text: '유하. 내 이름은 유하야.', expr: 'neutral' },
    { who: 'yuha', text: '오랜만에 들었다. 누가 불러주는 소리.', expr: 'smile' },
    { who: 'narr', text: '그녀의 형체가 흐릿하게 풀린다. 복도 끝, 어둠이 다시 짙어진다.' },
    { who: 'yuha', text: '가. 다음엔… 못 잡을 거야.', expr: 'smile' }
  ],

  2: [
    { who: 'narr', text: '다시, 복도. 시계는 여전히 새벽 두 시에 멈춰 있다.' },
    { who: 'yuha', text: '또 만났네.', expr: 'smile' },
    { who: 'yuha', text: '몇 번째야? 나는… 이제 못 세겠어.', expr: 'sad' },
    { who: 'narr', text: '그녀의 손바닥에서 인형의 팔 하나가 피어난다. 네 품 속 인형과 같은 색.' },
    {
      choice: true, text: '',
      options: [
        {
          label: '이번엔 도망칠 생각 없어.', aff: 20,
          reply: [{ who: 'yuha', text: '…그런 말, 처음 들어.', expr: 'surprised' }]
        },
        {
          label: '몇 번째든, 이번엔 다를 거야.', aff: 12,
          reply: [{ who: 'yuha', text: '다를까. 진짜로?', expr: 'sad' }]
        },
        {
          label: '여기서 나가려면 어떻게 해?', aff: 6,
          reply: [{ who: 'yuha', text: '문은 있어. 근데 나는 못 나가.', expr: 'neutral' }]
        },
        {
          label: '그냥 놔줘. 나 살고 싶어.', aff: -8,
          reply: [{ who: 'yuha', text: '…그래. 다들 그랬어.', expr: 'sad' }]
        }
      ]
    },
    { who: 'yuha', text: '하나만 물어볼게.', expr: 'neutral' },
    { who: 'yuha', text: '여기, 무서워?', expr: 'sad' },
    {
      choice: true, text: '그녀가 조용히 기다린다.',
      options: [
        {
          label: '무섭지 않다고 하면 거짓말이야.', aff: 14,
          reply: [{ who: 'yuha', text: '정직하네. 그런 애는 오랜만이야.', expr: 'smile' }]
        },
        {
          label: '네가 무서운 게 아니야. 이 밤이 무서운 거야.', aff: 18,
          reply: [
            { who: 'yuha', text: '…….', expr: 'surprised' },
            { who: 'narr', text: '그녀가 잠깐, 숨을 쉬는 것처럼 보였다. 숨을 쉬지 않는 애인데.' }
          ]
        },
        {
          label: '죽을 뻔했으니까 무섭지.', aff: 6,
          reply: [{ who: 'yuha', text: '미안. 그건… 내가 멈출 수가 없어서.', expr: 'sad' }]
        }
      ]
    },
    { who: 'narr', text: '복도 끝에서, 무언가가 부서지는 소리가 났다. 유하는 대답하지 않는다.' },
    { who: 'yuha', text: '다음엔… 조금 더 세게 갈게.', expr: 'sad' }
  ],

  3: [
    { who: 'narr', text: '복도 벽에 손자국이 늘어나 있다. 어제는 없던 것들이다.' },
    { who: 'yuha', text: '이 복도, 원래 좋아했어. 창밖으로 벚꽃이 보였거든.', expr: 'smile' },
    { who: 'yuha', text: '근데 그날, 나는 여기서 기다리기만 했어.', expr: 'sad' },
    { who: 'yuha', text: '아무도, 오지 않았어.', expr: 'sad' },
    { who: 'narr', text: '벽이 숨을 쉬듯 울렁인다. 그녀의 목소리가 여러 겹으로 갈라진다.' },
    {
      choice: true, text: '',
      options: [
        {
          label: '이 편지, 네 거지. 주인에게 돌려주려고.', aff: 26, need: 'letter', mark: '✉ ',
          reply: [
            { who: 'yuha', text: '…이 편지. 나, 부치지 못했어.', expr: 'surprised' },
            { who: 'yuha', text: '받는 사람 칸에, 내 이름밖에 못 썼어.', expr: 'sad' },
            { who: 'narr', text: '벽의 손자국이 하나, 둘, 지워진다.' }
          ]
        },
        {
          label: '네 잘못이 아니야.', aff: 16,
          reply: [{ who: 'yuha', text: '…그걸, 네가 어떻게 알아.', expr: 'sad' }]
        },
        {
          label: '내가 데리고 나갈게.', aff: 12,
          reply: [{ who: 'yuha', text: '그 말, 믿어도 돼?', expr: 'surprised' }]
        },
        {
          label: '그만해. 무서워.', aff: -14,
          reply: [
            { who: 'narr', text: '천장에서 먼지가 떨어진다. 그녀의 그림자가 길게 늘어진다.' },
            { who: 'yuha', text: '무서우면, 도망가야지.', expr: 'angry' }
          ]
        }
      ]
    },
    { who: 'yuha', text: '…이제 곧, 복도가 끝나.', expr: 'sad' },
    { who: 'yuha', text: '끝나면 나는 또 혼자가 되겠지.', expr: 'sad' }
  ],

  4: [
    { who: 'narr', text: '복도 끝. 문 하나가 희미하게 빛나고 있다.' },
    { who: 'yuha', text: '이번엔… 정말 마지막 같아.', expr: 'sad' },
    { who: 'yuha', text: '저 문은 너만 통과해. 나는 안 돼.', expr: 'sad' },
    { who: 'narr', text: '그녀의 손끝에서 인형이 온전한 모습을 갖춘다. 처음 봤을 때보다 조금 더 따뜻해 보인다.' },
    {
      choice: true, text: '문 너머에서 바람 소리가 들린다.',
      options: [
        {
          label: '같이 나가자.', aff: 20, need: 'aff', affMin: 55, ending: 'true',
          reply: [
            { who: 'yuha', text: '……응.', expr: 'surprised' },
            { who: 'narr', text: '복도가, 아주 조금 밝아졌다.' }
          ]
        },
        {
          label: '미안해. 나 혼자 갈게.', aff: -10, ending: 'lonely',
          reply: [
            { who: 'yuha', text: '…그래.', expr: 'sad' },
            { who: 'yuha', text: '가. 대신, 뒤돌아보지 마.', expr: 'smile' }
          ]
        },
        {
          label: '네가 나가. 나는 여기 남을게.', aff: 10, ending: 'sacrifice',
          reply: [
            { who: 'yuha', text: '…바보야.', expr: 'surprised' },
            { who: 'narr', text: '그녀가 웃었다. 처음으로, 아주 제대로.' }
          ]
        },
        {
          label: '아무 말도 하지 않는다.', aff: 0, ending: 'loop', silent: true,
          reply: [
            { who: 'narr', text: '침묵이 길어진다. 복도가, 천천히 너를 삼킨다.' },
            { who: 'yuha', text: '…그래. 이번에도, 여기까지구나.', expr: 'sad' }
          ]
        }
      ]
    }
  ]
};

const DEVOUR = [
  { who: 'narr', text: '그녀가 고개를 든다. 눈에, 사람의 모양이 없다.' },
  { who: 'yuha', text: '…너, 누구지?', expr: 'angry' },
  { who: 'narr', text: '이번에는, 대화가 되지 않았다.' }
];

/* ---------------- 대화 시작 ---------------- */
function startDialogue() {
  G.mode = 'dialogue';
  G.ghost.mode = 'idle';
  G.ghost.idle = 99;
  // 그녀를 플레이어 앞으로 살짝
  const p = G.player, gh = G.ghost;
  const ang = Math.atan2(gh.y - p.y, gh.x - p.x);
  gh.x = p.x + Math.cos(ang) * 26;
  gh.y = p.y + Math.sin(ang) * 26;
  gh.alpha = 1;

  if (G.round === 4 && G.aff < 15) {
    openDialogue(DEVOUR, () => {
      G.ending = 'devour';
      finishRun();
    });
    return;
  }

  const steps = DIALOGUES[G.round];
  openDialogue(steps, () => {
    if (G.ending === 'true') {
      startFinale();
      return;
    }
    if (G.ending) { finishRun(); return; }
    if (G.round >= 4) { G.ending = 'loop'; finishRun(); return; }
    // 다음 라운드
    startRound(G.round + 1);
  });
}

/* ---------------- 피날레 / 엔딩 ---------------- */
function startFinale() {
  G.mode = 'finale';
  G.exitOpen = true;
  G.ghost.mode = 'follow';
  el.objective.textContent = '복도 끝의 문으로. 그녀와 함께.';
  Snd.door();
  G.flash = 0.35;
  toast('문이 열렸다.\n그녀를 데리고 복도 끝으로 가라.', 3200);
}

const CUTSCENE_TRUE = [
  { who: 'narr', text: '문이 열린다.' },
  { who: 'narr', text: '새벽 공기가 복도로 밀려든다. 차갑고, 이상하게 달콤하다.' },
  { who: 'narr', text: '유하의 손을 잡는다. 잡힌다. 아주 잠깐, 온기가 느껴진다.' },
  { who: 'yuha', text: '…따뜻하다.', expr: 'smile' },
  { who: 'narr', text: '뒤에서 복도가 무너진다. 돌아보지 않는다.' },
  { who: 'narr', text: '— 그리고, 아침이 왔다.' }
];

function triggerTrueEnding() {
  if (G.mode !== 'finale') return;
  G.mode = 'cutscene';
  G.flash = 1;
  Snd.door();
  setTimeout(() => {
    el.hud.classList.add('dim');
    el.dlg.classList.remove('hidden');
    openDialogue(CUTSCENE_TRUE, () => {
      G.ending = 'true';
      finishRun();
    });
  }, 700);
}

const ENDINGS = {
  true: {
    tag: 'TRUE END', title: '빛의 복도',
    desc: '복도 끝에서, 너는 손을 놓지 않았다.\n그녀의 발소리는 나지 않았지만, 분명히 함께 걸었다.\n\n새벽 다섯 시, 학교 정문이 스스로 열렸다.\n돌아보니 복도는 없었다. 인형만, 네 가방 안에 남아 있었다.'
  },
  lonely: {
    tag: 'END 2', title: '혼자의 아침',
    desc: '문을 나선 뒤, 너는 뒤돌아보지 않았다.\n\n약속대로. 아주 잘 지켰다.\n\n그날 이후, 새벽 두 시가 되면\n가끔, 복도 끝에서 발소리를 듣는다.\n뒤돌아보지 않는다. 그게 약속이니까.'
  },
  sacrifice: {
    tag: 'END 3', title: '남겨진 자',
    desc: '그녀가 문을 통과했다. 아무 일도 일어나지 않았다.\n\n너는 복도에 남았다. 시계는 여전히 두 시.\n\n그런데 이상하지. 이제 이 복도가,\n그렇게 무섭지가 않다.\n\n— 언젠가, 누군가가 다시 와서\n너에게 말을 걸어줄지도 모르니까.'
  },
  loop: {
    tag: 'END 4', title: '다시, 복도',
    desc: '아무 말도 하지 않았다.\n그녀도, 아무 말도 하지 않았다.\n\n시계가 다시 두 시를 가리킨다.\n\n복도 끝에서, 발소리가 들린다.\n너는 숨을 죽이고, 도망친다.\n\n몇 번째일까. 이제는 세지 않는다.'
  },
  devour: {
    tag: 'BAD END', title: '사냥',
    desc: '그녀는 마지막까지, 네 이름을 묻지 않았다.\n\n복도에 손자국이 하나 늘었다.\n\n— 오늘도, 대화는 성립하지 않았다.'
  }
};

function finishRun() {
  G.mode = 'ending';
  const e = ENDINGS[G.ending] || ENDINGS.loop;
  el.endTag.textContent = e.tag;
  el.endTitle.textContent = e.title;
  el.endDesc.textContent = e.desc;
  el.endStats.innerHTML =
    `도달 라운드 <span>${G.round}</span> · 최종 호감도 <span>${Math.round(G.aff)}</span> · 기억의 파편 <span>${G.memory}</span> · 사망 <span>${G.deaths}</span>회`;
  setTimeout(() => {
    el.hud.classList.add('dim');
    el.ending.classList.remove('hidden');
    if (G.ending === 'true') { Snd.good(); } else { Snd.bad(); }
  }, G.ending === 'true' ? 500 : 300);
}

/* ---------------- HUD ---------------- */
let lastHud = {};
function updateHud() {
  const lit = G.fuel > 0.1;
  const dOk = G.hasDoll, cOk = lit;
  if (lastHud.d !== dOk) {
    el.condDoll.className = 'cond-row ' + (dOk ? 'ok' : 'bad');
    el.condDoll.innerHTML = `<b>${dOk ? '✓' : '✕'}</b> 소울 인형 소지`;
    lastHud.d = dOk;
  }
  if (lastHud.c !== cOk) {
    el.condCandle.className = 'cond-row ' + (cOk ? 'ok' : 'bad');
    el.condCandle.innerHTML = `<b>${cOk ? '✓' : '✕'}</b> 촛불 점등`;
    lastHud.c = cOk;
  }
  el.fuel.style.width = G.fuel.toFixed(1) + '%';
  el.stamina.style.width = G.stamina.toFixed(1) + '%';
  el.aff.style.width = G.aff + '%';
  el.affNum.textContent = Math.round(G.aff);
  el.fragNum.textContent = G.memory;
}

let toastTimer = null;
function toast(msg, ms) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms || 2000);
}

function addAff(v, quiet) {
  G.aff = clamp(G.aff + v, 0, 100);
  if (!quiet) showAffPop(v);
}

/* ---------------- 게임 루프 ---------------- */
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  updateHud();
  requestAnimationFrame(frame);
}

function update(dt) {
  G.time += dt;
  G.fade = Math.max(0, G.fade - dt * 1.8);
  G.flash = Math.max(0, G.flash - dt * 1.6);
  G.shake = Math.max(0, G.shake - dt * 2.2);

  if (G.mode === 'hitstop') {
    G.hitStop -= dt;
    G.ghost.bob += dt * 2;
    if (G.hitStop <= 0) startDialogue();
    return;
  }

  if (G.mode === 'play' || G.mode === 'finale') {
    updatePlayer(dt);
    updateGhost(dt);

    if (G.mode === 'play') {
      const d = dist2(G.player.x, G.player.y, G.ghost.x, G.ghost.y);
      if (d < 250) {
        G.beatT -= dt;
        if (G.beatT <= 0) {
          G.beatT = 0.42 + d / 500;
          Snd.thump();
          if (d < 150) setTimeout(() => Snd.thump(), 150);
        }
      } else G.beatT = 0;
      G.ghost.anger = clamp(1 - d / 260, 0, 1);
    }

    if (G.mode === 'finale' && exitPos) {
      if (dist2(G.player.x, G.player.y, exitPos.x, exitPos.y) < 24) triggerTrueEnding();
    }
  }

  if (G.mode === 'dialogue' || G.mode === 'cutscene') {
    updateTyping(dt);
    G.ghost.bob += dt * 1.1;
    if (G.mode === 'cutscene' && G.ending === 'true') {
      G.dawn = Math.min(1, G.dawn + dt * 0.15);
    }
  }

  if (G.mode === 'title') {
    G.ghost.bob += dt * 0.8;
  }
}

/* ---------------- 시작 / 리셋 ---------------- */
function startGame() {
  Snd.unlock();
  el.title.classList.add('hidden');
  el.dead.classList.add('hidden');
  el.ending.classList.add('hidden');
  el.dlg.classList.add('hidden');
  el.choices.classList.add('hidden');
  el.choices.innerHTML = '';
  el.hud.classList.remove('dim');
  D.steps = []; D.pending = null; D.choiceOpen = false; D.onEnd = null; D.typing = false;
  G.mode = 'play';
  G.round = 1; G.aff = 0; G.memory = 0;
  G.dawn = 0;
  G.hasDoll = false; G.hasLetter = false;
  G.deaths = 0; G.ending = null;
  G.items = [];
  G.exitOpen = false;
  startRound(1);
  setTimeout(() => toast('촛불을 들고 그녀를 피해라.\n인형과 불빛이 있으면, 잡혀도 죽지 않는다.', 4200), 1400);
}

function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  const st = el.stage;
  st.style.width = Math.floor(W * s) + 'px';
  st.style.height = Math.floor(H * s) + 'px';
  el.scaler.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);

function toggleMute() {
  const m = Snd.toggle();
  el.mute.classList.toggle('off', m);
  el.mute.textContent = '♪';
}

/* ---------------- 이벤트 바인딩 ---------------- */
$('#startBtn').addEventListener('click', startGame);
$('#retryBtn').addEventListener('click', retry);
$('#againBtn').addEventListener('click', () => {
  el.ending.classList.add('hidden');
  el.hud.classList.remove('dim');
  startGame();
});
el.mute.addEventListener('click', toggleMute);

canvas.addEventListener('click', () => {
  if (G.mode === 'dialogue' || G.mode === 'cutscene') advanceDialogue();
});
el.dlg.addEventListener('click', e => {
  if (e.target.closest('.choice')) return;
  if (G.mode === 'dialogue' || G.mode === 'cutscene') advanceDialogue();
});

/* ---------------- 초기화 ---------------- */
renderMap();
drawPortrait('neutral');
el.hud.classList.add('dim');
fit();
G.ghost.alpha = 1;
requestAnimationFrame(frame);

})();
