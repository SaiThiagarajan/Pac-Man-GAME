'use strict';
/* ==============================================================
   PAC-MAN ARCADE — script.js
   Organized into: Maze, Entity (base), Player, Ghost,
   SoundManager, InputManager, ScoreManager, Game (orchestrator)
================================================================= */

/* ----------------------------------------------------------------
   CONSTANTS
------------------------------------------------------------------- */
const TILE = 24;
const COLS = 19;
const ROWS = 21;
const CANVAS_W = COLS * TILE;
const CANVAS_H = ROWS * TILE;

const CELL = { WALL: 1, PELLET: 0, POWER: 2, EMPTY: 3 };

const DIR = {
  NONE: { x: 0, y: 0 },
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

function sameDir(a, b) { return a.x === b.x && a.y === b.y; }
function isOpposite(a, b) { return a.x === -b.x && a.y === -b.y && !(a.x === 0 && a.y === 0); }

const GHOST_HOUSE = { r0: 9, r1: 11, c0: 8, c1: 10, center: { row: 10, col: 9 } };

/* ----------------------------------------------------------------
   MAZE
   Grid generated procedurally: border walls + an evenly spaced
   pillar field (guarantees full connectivity by construction),
   with a handful of merged pillars for visual variety, a ghost
   house clearing in the centre, a tunnel row, and four power
   pellots near the corners. Verified fully connected via flood
   fill during development.
------------------------------------------------------------------- */
class Maze {
  constructor() {
    this.tunnelRow = 10;
    this.grid = this.generate();
    this.pelletsTotal = 0;
    this.pelletsRemaining = 0;
    this.countPellets();
  }

  inGhostHouse(r, c) {
    return r >= GHOST_HOUSE.r0 && r <= GHOST_HOUSE.r1 && c >= GHOST_HOUSE.c0 && c <= GHOST_HOUSE.c1;
  }

  generate() {
    const grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(CELL.PELLET));

    for (let c = 0; c < COLS; c++) { grid[0][c] = CELL.WALL; grid[ROWS - 1][c] = CELL.WALL; }
    for (let r = 0; r < ROWS; r++) { grid[r][0] = CELL.WALL; grid[r][COLS - 1] = CELL.WALL; }

    // tunnel opening
    grid[this.tunnelRow][0] = CELL.PELLET;
    grid[this.tunnelRow][COLS - 1] = CELL.PELLET;

    // pillar field
    for (let r = 2; r <= ROWS - 3; r += 2) {
      for (let c = 2; c <= COLS - 3; c += 2) {
        if (this.inGhostHouse(r, c)) continue;
        grid[r][c] = CELL.WALL;
      }
    }

    // merged segments for visual variety (pre-validated fully connected)
    const hMerge = [[2, 6], [2, 12], [6, 2], [6, 16], [14, 2], [14, 16], [18, 6], [18, 12]];
    hMerge.forEach(([r, c]) => {
      if (!this.inGhostHouse(r, c) && !this.inGhostHouse(r, c + 1)) {
        grid[r][c] = CELL.WALL; grid[r][c + 1] = CELL.WALL;
      }
    });
    const vMerge = [[8, 4], [8, 14], [12, 4], [12, 14]];
    vMerge.forEach(([r, c]) => {
      if (!this.inGhostHouse(r, c) && !this.inGhostHouse(r + 1, c)) {
        grid[r][c] = CELL.WALL; grid[r + 1][c] = CELL.WALL;
      }
    });

    // ghost house clearing
    for (let r = GHOST_HOUSE.r0; r <= GHOST_HOUSE.r1; r++) {
      for (let c = GHOST_HOUSE.c0; c <= GHOST_HOUSE.c1; c++) grid[r][c] = CELL.EMPTY;
    }

    // power pellets near corners
    [[1, 1], [1, COLS - 2], [ROWS - 2, 1], [ROWS - 2, COLS - 2]].forEach(([r, c]) => {
      grid[r][c] = CELL.POWER;
    });

    // player start cleared
    grid[17][9] = CELL.EMPTY;

    return grid;
  }

  countPellets() {
    let n = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (this.grid[r][c] === CELL.PELLET || this.grid[r][c] === CELL.POWER) n++;
    }
    this.pelletsTotal = n;
    this.pelletsRemaining = n;
  }

  wrapCol(c) { if (c < 0) return COLS - 1; if (c >= COLS) return 0; return c; }

  isWall(col, row) {
    const c = this.wrapCol(col);
    if (row < 0 || row >= ROWS) return true;
    return this.grid[row][c] === CELL.WALL;
  }

  canMove(col, row) { return !this.isWall(col, row); }

  /** Eats whatever is at (col,row). Returns 'pellet' | 'power' | null */
  eatAt(col, row) {
    const c = this.wrapCol(col);
    if (row < 0 || row >= ROWS) return null;
    const v = this.grid[row][c];
    if (v === CELL.PELLET) { this.grid[row][c] = CELL.EMPTY; this.pelletsRemaining--; return 'pellet'; }
    if (v === CELL.POWER) { this.grid[row][c] = CELL.EMPTY; this.pelletsRemaining--; return 'power'; }
    return null;
  }

  /** Count of open (non-reverse) directions from a tile — used for AI intersection logic */
  openDirections(col, row, excludeDir) {
    const dirs = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT];
    const open = [];
    for (const d of dirs) {
      if (excludeDir && isOpposite(d, excludeDir)) continue;
      if (this.canMove(col + d.x, row + d.y)) open.push(d);
    }
    return open;
  }

  draw(ctx) {
    ctx.save();
    // subtle scanline-free background
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // walls
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] !== CELL.WALL) continue;
        const x = c * TILE, y = r * TILE;
        const grad = ctx.createLinearGradient(x, y, x + TILE, y + TILE);
        grad.addColorStop(0, 'rgba(0,217,255,0.9)');
        grad.addColorStop(1, 'rgba(139,92,246,0.85)');
        ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(0,217,255,0.55)';
        ctx.shadowBlur = 6;
        roundRect(ctx, x + 1.5, y + 1.5, TILE - 3, TILE - 3, 5);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;

    // pellets
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = this.grid[r][c];
        if (v !== CELL.PELLET && v !== CELL.POWER) continue;
        const cx = c * TILE + TILE / 2;
        const cy = r * TILE + TILE / 2;
        if (v === CELL.PELLET) {
          ctx.fillStyle = '#FFE99A';
          ctx.shadowColor = '#FFD60A';
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const pulse = 4.5 + Math.sin(performance.now() / 150) * 1.6;
          ctx.fillStyle = '#FF2D95';
          ctx.shadowColor = '#FF2D95';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ----------------------------------------------------------------
   ENTITY — shared grid movement for Player & Ghost
------------------------------------------------------------------- */
class Entity {
  constructor(col, row, speed) {
    this.startCol = col; this.startRow = row;
    this.x = col * TILE; this.y = row * TILE;
    this.speed = speed; // px/sec
    this.dir = { ...DIR.NONE };
    this.nextDir = { ...DIR.NONE };
  }

  get col() { return Math.round(this.x / TILE); }
  get row() { return Math.round(this.y / TILE); }
  get centerX() { return this.x + TILE / 2; }
  get centerY() { return this.y + TILE / 2; }

  resetToStart() {
    this.x = this.startCol * TILE; this.y = this.startRow * TILE;
    this.dir = { ...DIR.NONE }; this.nextDir = { ...DIR.NONE };
  }

  isAligned() {
    const eps = 0.6;
    const nx = Math.abs(this.x - Math.round(this.x / TILE) * TILE);
    const ny = Math.abs(this.y - Math.round(this.y / TILE) * TILE);
    return nx < eps && ny < eps;
  }

  snap() {
    this.x = Math.round(this.x / TILE) * TILE;
    this.y = Math.round(this.y / TILE) * TILE;
  }

  /**
   * Called every time the entity's position lands exactly on a tile-center
   * boundary. Subclasses decide/adjust this.dir here (Player: honor queued
   * nextDir; Ghost: run AI). Default behaviour used by Player.
   */
  onReachTileCenter(maze) {
    const col = this.col, row = this.row;
    if (!sameDir(this.nextDir, DIR.NONE) && maze.canMove(col + this.nextDir.x, row + this.nextDir.y)) {
      this.dir = this.nextDir;
    }
    if (!maze.canMove(col + this.dir.x, row + this.dir.y)) {
      this.dir = { ...DIR.NONE };
    }
  }

  /**
   * Boundary-exact movement. Rather than moving the full per-frame distance
   * blindly and only checking collisions when a fuzzy "am I near a grid
   * line" test happens to pass, this walks the entity forward in segments,
   * stopping EXACTLY at each tile boundary to re-validate direction/walls —
   * so a slow frame (large dt) can never carry the entity past an
   * unvalidated wall, no matter how many tiles that frame's distance would
   * otherwise cover. This is what guarantees the entity can never clip
   * through the maze border.
   */
  step(dt, maze) {
    let remaining = this.speed * dt;
    let guard = 0; // safety cap on iterations per frame

    while (remaining > 1e-6 && guard < 12) {
      guard++;

      if (sameDir(this.dir, DIR.NONE)) {
        if (this.isAligned()) {
          this.snap();
          this.onReachTileCenter(maze);
        }
        if (sameDir(this.dir, DIR.NONE)) break; // still not moving — stop
        continue;
      }

      let distToBoundary;
      if (this.dir.x !== 0) {
        const base = this.x / TILE;
        const nextMultiple = this.dir.x > 0
          ? Math.ceil(base + 1e-6) * TILE
          : Math.floor(base - 1e-6) * TILE;
        distToBoundary = Math.abs(nextMultiple - this.x);
      } else {
        const base = this.y / TILE;
        const nextMultiple = this.dir.y > 0
          ? Math.ceil(base + 1e-6) * TILE
          : Math.floor(base - 1e-6) * TILE;
        distToBoundary = Math.abs(nextMultiple - this.y);
      }
      if (distToBoundary < 1e-6) distToBoundary = TILE;

      if (remaining < distToBoundary - 1e-6) {
        // Doesn't reach the next boundary this frame — just move.
        this.x += this.dir.x * remaining;
        this.y += this.dir.y * remaining;
        remaining = 0;
      } else {
        // Reaches (or exactly hits) the boundary — snap to it precisely,
        // then re-validate before continuing any leftover distance.
        this.x += this.dir.x * distToBoundary;
        this.y += this.dir.y * distToBoundary;
        remaining -= distToBoundary;
        this.snap();

        // tunnel wrap — only ever triggers exactly at a snapped boundary
        if (this.x < 0) this.x = (COLS - 1) * TILE;
        else if (this.x > (COLS - 1) * TILE) this.x = 0;

        this.onReachTileCenter(maze);
      }
    }

    // Last-resort safety net: if anything ever produced a NaN or a wildly
    // out-of-range position, recover instead of leaving the entity stranded.
    const maxX = (COLS + 1) * TILE, maxY = (ROWS + 1) * TILE;
    if (Number.isNaN(this.x) || Number.isNaN(this.y) || this.x < -TILE * 2 || this.x > maxX || this.y < -TILE * 2 || this.y > maxY) {
      this.x = clampNum(this.x, 0, (COLS - 1) * TILE);
      this.y = clampNum(this.y, 0, (ROWS - 1) * TILE);
      this.snap();
      this.dir = { ...DIR.NONE };
      this.nextDir = { ...DIR.NONE };
    }
  }
}

function clampNum(v, min, max) {
  if (Number.isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

/* ----------------------------------------------------------------
   PLAYER
------------------------------------------------------------------- */
class Player extends Entity {
  constructor(col, row, speed) {
    super(col, row, speed);
    this.mouthPhase = 0;
    this.facing = { ...DIR.LEFT };
  }

  update(dt, maze) {
    this.step(dt, maze);
    if (!sameDir(this.dir, DIR.NONE)) {
      this.facing = this.dir;
      this.mouthPhase += dt * 10;
    }
  }

  draw(ctx) {
    const cx = this.centerX, cy = this.centerY;
    const radius = TILE / 2 - 2;
    const mouthOpen = Math.abs(Math.sin(this.mouthPhase)) * 0.28 + 0.04; // radians fraction of PI

    let angleOffset = 0;
    if (sameDir(this.facing, DIR.RIGHT)) angleOffset = 0;
    else if (sameDir(this.facing, DIR.DOWN)) angleOffset = Math.PI / 2;
    else if (sameDir(this.facing, DIR.LEFT)) angleOffset = Math.PI;
    else if (sameDir(this.facing, DIR.UP)) angleOffset = -Math.PI / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleOffset);
    ctx.fillStyle = '#FFD60A';
    ctx.shadowColor = 'rgba(255,214,10,0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, radius, mouthOpen * Math.PI, (2 - mouthOpen) * Math.PI);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/* ----------------------------------------------------------------
   GHOST
   personality: 'chase' | 'ambush' | 'random' | 'clyde'
   state:       'normal' | 'frightened' | 'eaten'
------------------------------------------------------------------- */
const GHOST_COLORS = {
  red: '#FF3B30',
  pink: '#FF2D95',
  cyan: '#00D9FF',
  orange: '#FF7A00',
};

class Ghost extends Entity {
  constructor(col, row, speed, personality, color) {
    super(col, row, speed);
    this.baseSpeed = speed;
    this.personality = personality;
    this.color = color;
    this.state = 'normal';
    this.frightenedTimer = 0;
    this.eatenReturning = false;
    this.dir = { ...DIR.LEFT };
  }

  resetToStart() {
    super.resetToStart();
    this.state = 'normal';
    this.frightenedTimer = 0;
    this.dir = { ...DIR.LEFT };
  }

  setFrightened(duration) {
    if (this.state === 'eaten') return;
    this.state = 'frightened';
    this.frightenedTimer = duration;
  }

  chooseTarget(player, ghosts) {
    switch (this.personality) {
      case 'chase':
        return { col: player.col, row: player.row };
      case 'ambush': {
        const aheadCol = player.col + player.facing.x * 4;
        const aheadRow = player.row + player.facing.y * 4;
        return { col: aheadCol, row: aheadRow };
      }
      case 'clyde': {
        const dist = Math.hypot(player.col - this.col, player.row - this.row);
        if (dist > 8) return { col: player.col, row: player.row };
        return { col: 1, row: ROWS - 2 }; // retreat to a corner when close
      }
      case 'random':
      default:
        return null; // signals random choice
    }
  }

  update(dt, maze, player, ghosts) {
    // frightened countdown
    if (this.state === 'frightened') {
      this.frightenedTimer -= dt * 1000;
      if (this.frightenedTimer <= 0) this.state = 'normal';
    }

    const speed = this.state === 'frightened' ? this.baseSpeed * 0.55
                : this.state === 'eaten' ? this.baseSpeed * 2.0
                : this.baseSpeed;
    this.speed = speed;

    // stash refs the boundary-triggered AI callback needs
    this._player = player;
    this._ghosts = ghosts;

    this.step(dt, maze);
  }

  /** Called by Entity.step() exactly when this ghost lands on a tile center. */
  onReachTileCenter(maze) {
    const player = this._player;

    // eaten: once home, respawn as normal
    if (this.state === 'eaten') {
      const target = GHOST_HOUSE.center;
      if (this.col === target.col && this.row === target.row) {
        this.state = 'normal';
      }
    }

    const col = this.col, row = this.row;
    const options = maze.openDirections(col, row, this.dir);
    let chosen;

    if (options.length === 0) {
      chosen = { x: -this.dir.x, y: -this.dir.y }; // dead end — reverse
    } else if (options.length === 1) {
      chosen = options[0];
    } else if (this.state === 'frightened') {
      chosen = options[Math.floor(Math.random() * options.length)];
    } else if (this.state === 'eaten') {
      chosen = pickDirectionTowards(options, col, row, GHOST_HOUSE.center);
    } else if (this.personality === 'random') {
      chosen = Math.random() < 0.25
        ? pickDirectionTowards(options, col, row, { col: player.col, row: player.row })
        : options[Math.floor(Math.random() * options.length)];
    } else {
      const target = this.chooseTarget(player, this._ghosts);
      chosen = pickDirectionTowards(options, col, row, target);
    }

    this.dir = chosen;
  }

  draw(ctx) {
    const x = this.x, y = this.y;
    const w = TILE - 2, h = TILE - 3;
    const ox = x + 1, oy = y + 2;

    let fillColor = this.color;
    let showScared = false;
    if (this.state === 'frightened') {
      showScared = true;
      fillColor = this.frightenedTimer < 1800 && Math.floor(performance.now() / 160) % 2 === 0
        ? '#F5F6FA' : '#2740E6';
    }

    if (this.state === 'eaten') {
      // only draw eyes, returning home
      drawGhostEyes(ctx, x, y, this.dir, true);
      return;
    }

    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = showScared ? 6 : 9;
    ctx.beginPath();
    ctx.moveTo(ox, oy + h * 0.55);
    ctx.arc(ox + w / 2, oy + h * 0.5, w / 2, Math.PI, 0);
    ctx.lineTo(ox + w, oy + h);
    const waveCount = 4;
    const waveW = w / waveCount;
    for (let i = 0; i < waveCount; i++) {
      const wx = ox + w - i * waveW;
      const midx = wx - waveW / 2;
      const bottomY = (i % 2 === 0) ? oy + h : oy + h * 0.72;
      ctx.lineTo(midx, bottomY);
      ctx.lineTo(wx - waveW, oy + h);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    drawGhostEyes(ctx, x, y, this.dir, false, showScared);
  }
}

function drawGhostEyes(ctx, x, y, dir, eatenOnly, scared) {
  const ex1 = x + TILE * 0.32, ex2 = x + TILE * 0.68, ey = y + TILE * 0.42;
  const r = TILE * 0.15;
  ctx.save();
  ctx.fillStyle = '#F5F6FA';
  ctx.beginPath(); ctx.arc(ex1, ey, r, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(ex2, ey, r, 0, Math.PI * 2); ctx.fill();

  if (!scared) {
    ctx.fillStyle = eatenOnly ? '#00D9FF' : '#1a1a2e';
    const px = dir.x * r * 0.55, py = dir.y * r * 0.55;
    const pr = r * 0.5;
    ctx.beginPath(); ctx.arc(ex1 + px, ey + py, pr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2 + px, ey + py, pr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Among candidate directions, pick the one whose resulting tile is closest to target. */
function pickDirectionTowards(options, col, row, target) {
  if (!target) return options[Math.floor(Math.random() * options.length)];
  let best = options[0], bestDist = Infinity;
  for (const d of options) {
    const nc = col + d.x, nr = row + d.y;
    const dist = (nc - target.col) ** 2 + (nr - target.row) ** 2;
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

/* ----------------------------------------------------------------
   SOUND MANAGER — Web Audio API, no external audio files
------------------------------------------------------------------- */
class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('pacmanSoundOn') === 'false';
    this._unlocked = false;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  unlock() {
    if (this._unlocked) return;
    this._unlocked = true;
    this.ensureContext();
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('pacmanSoundOn', m ? 'false' : 'true');
  }

  tone(freq, duration, type = 'square', vol = 0.16, delay = 0) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  pellet() { this.tone(660, 0.06, 'square', 0.12); }
  power() { this.tone(220, 0.18, 'sawtooth', 0.16); this.tone(330, 0.18, 'sawtooth', 0.1, 0.05); }
  ghostEaten() { this.tone(880, 0.08, 'square', 0.18); this.tone(1180, 0.1, 'square', 0.14, 0.07); }
  death() {
    [520, 440, 360, 280, 200].forEach((f, i) => this.tone(f, 0.16, 'sawtooth', 0.16, i * 0.12));
  }
  levelComplete() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.15, i * 0.11));
  }
  gameOver() {
    [300, 260, 220, 160].forEach((f, i) => this.tone(f, 0.28, 'sawtooth', 0.15, i * 0.2));
  }
  start() {
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.1, 'square', 0.14, i * 0.08));
  }
}

/* ----------------------------------------------------------------
   INPUT MANAGER — keyboard, on-screen dpad, swipe
------------------------------------------------------------------- */
class InputManager {
  constructor(game) {
    this.game = game;
    this.touchStart = null;
    this.bindKeyboard();
    this.bindDpad();
    this.bindSwipe();
  }

  isTypingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this.isTypingTarget(document.activeElement)) return;
      this.game.sound.unlock();

      const map = {
        ArrowUp: DIR.UP, KeyW: DIR.UP,
        ArrowDown: DIR.DOWN, KeyS: DIR.DOWN,
        ArrowLeft: DIR.LEFT, KeyA: DIR.LEFT,
        ArrowRight: DIR.RIGHT, KeyD: DIR.RIGHT,
      };
      if (map[e.code]) {
        e.preventDefault();
        this.game.setNextDirection(map[e.code]);
      } else if (e.code === 'Space') {
        e.preventDefault();
        this.game.togglePause();
      } else if (e.code === 'Enter' && this.game.state === 'start') {
        this.game.startGame();
      }
    });
  }

  bindDpad() {
    const buttons = document.querySelectorAll('.dpad-btn');
    const dirMap = { up: DIR.UP, down: DIR.DOWN, left: DIR.LEFT, right: DIR.RIGHT };
    buttons.forEach((btn) => {
      const dir = dirMap[btn.dataset.dir];
      const activate = (e) => {
        e.preventDefault();
        this.game.sound.unlock();
        this.game.setNextDirection(dir);
      };
      btn.addEventListener('pointerdown', activate);
      btn.addEventListener('click', activate);
    });
  }

  bindSwipe() {
    const canvas = document.getElementById('gameCanvas');
    canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      if (!this.touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this.touchStart.x;
      const dy = t.clientY - this.touchStart.y;
      const threshold = 18;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) { this.touchStart = null; return; }
      this.game.sound.unlock();
      if (Math.abs(dx) > Math.abs(dy)) {
        this.game.setNextDirection(dx > 0 ? DIR.RIGHT : DIR.LEFT);
      } else {
        this.game.setNextDirection(dy > 0 ? DIR.DOWN : DIR.UP);
      }
      this.touchStart = null;
    });
  }
}

/* ----------------------------------------------------------------
   SCORE MANAGER — score, combo, high score persistence
------------------------------------------------------------------- */
const HS_KEY = 'pacmanHighScores';
const GHOST_EAT_SCORES = [200, 400, 800, 1600];

class ScoreManager {
  constructor() {
    this.score = 0;
    this.comboIndex = 0;
    this.highScores = ScoreManager.load();
  }

  static load() {
    try {
      const raw = JSON.parse(localStorage.getItem(HS_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }

  static save(list) {
    try { localStorage.setItem(HS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
  }

  topScore() {
    return this.highScores.length ? this.highScores[0].score : 0;
  }

  addPellet() { this.score += 10; }
  addPower() { this.score += 50; this.comboIndex = 0; }
  addGhost() {
    const pts = GHOST_EAT_SCORES[Math.min(this.comboIndex, GHOST_EAT_SCORES.length - 1)];
    this.score += pts;
    this.comboIndex++;
    return pts;
  }
  addLevelBonus(level) { const bonus = level * 1000; this.score += bonus; return bonus; }

  reset() { this.score = 0; this.comboIndex = 0; }

  submit(name, level, mode = 'classic') {
    const entry = { name: (name || 'PLAYER').toUpperCase().slice(0, 10), score: this.score, level, mode, date: new Date().toISOString().slice(0, 10) };
    this.highScores.push(entry);
    this.highScores.sort((a, b) => b.score - a.score);
    this.highScores = this.highScores.slice(0, 8);
    ScoreManager.save(this.highScores);
    return this.highScores;
  }
}

/* ----------------------------------------------------------------
   GAME — orchestrator / state machine
------------------------------------------------------------------- */
const BASE_PLAYER_SPEED = 128; // px/sec
const BASE_GHOST_SPEED = 112;  // px/sec
const FRIGHTENED_BASE_MS = 7000;

const GHOST_SPAWNS = [
  { row: 9, col: 8, personality: 'chase', color: GHOST_COLORS.red },
  { row: 9, col: 10, personality: 'ambush', color: GHOST_COLORS.pink },
  { row: 11, col: 8, personality: 'random', color: GHOST_COLORS.cyan },
  { row: 11, col: 10, personality: 'clyde', color: GHOST_COLORS.orange },
];

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');

    this.sound = new SoundManager();
    this.score = new ScoreManager();
    this.input = new InputManager(this);

    this.state = 'start'; // start | playing | paused | levelcomplete | gameover
    this.level = 1;
    this.lives = 3;
    this.mode = 'classic'; // classic | turbo

    this.maze = new Maze();
    this.player = new Player(9, 17, BASE_PLAYER_SPEED);
    this.ghosts = GHOST_SPAWNS.map((g) => new Ghost(g.col, g.row, BASE_GHOST_SPEED, g.personality, g.color));

    this.lastTime = 0;
    this.deathTimer = 0;
    this.levelCompleteTimer = 0;

    this.cacheDom();
    this.bindUI();
    this.renderHighScores();
    this.updateHud();

    requestAnimationFrame((t) => this.loop(t));
  }

  cacheDom() {
    this.el = {
      hudScore: document.getElementById('hudScore'),
      hudHighScore: document.getElementById('hudHighScore'),
      hudLevel: document.getElementById('hudLevel'),
      hearts: Array.from(document.querySelectorAll('#hudLives .life-heart')),
      livesWrap: document.getElementById('hudLives'),

      startOverlay: document.getElementById('startOverlay'),
      startGameBtn: document.getElementById('startGameBtn'),
      modeClassicBtn: document.getElementById('modeClassicBtn'),
      modeTurboBtn: document.getElementById('modeTurboBtn'),

      pauseOverlay: document.getElementById('pauseOverlay'),
      resumeBtn: document.getElementById('resumeBtn'),
      pauseBtn: document.getElementById('pauseBtn'),

      levelCompleteOverlay: document.getElementById('levelCompleteOverlay'),
      levelCompleteBonus: document.getElementById('levelCompleteBonus'),

      gameOverOverlay: document.getElementById('gameOverOverlay'),
      finalScore: document.getElementById('finalScore'),
      nameEntry: document.getElementById('nameEntry'),
      playerName: document.getElementById('playerName'),
      saveScoreBtn: document.getElementById('saveScoreBtn'),
      tryAgainBtn: document.getElementById('tryAgainBtn'),
      backToMenuBtn: document.getElementById('backToMenuBtn'),

      restartBtn: document.getElementById('restartBtn'),
      soundToggle: document.getElementById('soundToggle'),
      crtToggle: document.getElementById('crtToggle'),
      navBurger: document.getElementById('navBurger'),
      header: document.querySelector('.site-header'),
      playNowBtn: document.getElementById('playNowBtn'),

      scoresList: document.getElementById('scoresList'),
      scoresEmpty: document.getElementById('scoresEmpty'),
    };
  }

  bindUI() {
    const e = this.el;

    e.startGameBtn.addEventListener('click', () => { this.sound.unlock(); this.startGame(); });
    e.playNowBtn.addEventListener('click', () => { this.sound.unlock(); });

    e.modeClassicBtn.addEventListener('click', () => this.setMode('classic'));
    e.modeTurboBtn.addEventListener('click', () => this.setMode('turbo'));

    e.pauseBtn.addEventListener('click', () => this.togglePause());
    e.resumeBtn.addEventListener('click', () => this.togglePause());
    e.restartBtn.addEventListener('click', () => this.restart());
    e.tryAgainBtn.addEventListener('click', () => this.restart());
    e.backToMenuBtn.addEventListener('click', () => this.backToMenu());

    e.saveScoreBtn.addEventListener('click', () => this.saveScore());
    e.playerName.addEventListener('keydown', (ev) => {
      if (ev.code === 'Enter') this.saveScore();
    });

    e.soundToggle.setAttribute('aria-pressed', String(!this.sound.muted));
    e.soundToggle.addEventListener('click', () => {
      this.sound.unlock();
      const nowMuted = !this.sound.muted;
      this.sound.setMuted(nowMuted);
      e.soundToggle.setAttribute('aria-pressed', String(!nowMuted));
    });

    e.crtToggle.addEventListener('click', () => {
      const on = document.body.classList.toggle('crt');
      e.crtToggle.setAttribute('aria-pressed', String(on));
    });

    e.navBurger.addEventListener('click', () => {
      const open = e.header.classList.toggle('nav-open');
      e.navBurger.setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('.mobile-nav a').forEach((a) => {
      a.addEventListener('click', () => {
        e.header.classList.remove('nav-open');
        e.navBurger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------------- state control ---------------- */

  setNextDirection(dir) {
    if (this.state !== 'playing') return;
    this.player.nextDir = dir;
  }

  showOverlay(el) { el.classList.remove('overlay--hidden'); }
  hideOverlay(el) { el.classList.add('overlay--hidden'); }

  setMode(mode) {
    this.mode = mode;
    this.el.modeClassicBtn.classList.toggle('mode-btn--active', mode === 'classic');
    this.el.modeTurboBtn.classList.toggle('mode-btn--active', mode === 'turbo');
  }

  startGame() {
    this.level = 1;
    this.lives = 3;
    this.score.reset();
    this.maze = new Maze();
    this.resetPositions();
    this.applyLevelSpeeds();
    this.hideOverlay(this.el.startOverlay);
    this.hideOverlay(this.el.gameOverOverlay);
    this.hideOverlay(this.el.levelCompleteOverlay);
    this.el.nameEntry.classList.remove('is-saved');
    this.el.playerName.value = '';
    this.updateHearts();
    this.updateHud();
    this.state = 'playing';
    this.sound.start();
  }

  restart() { this.startGame(); }

  backToMenu() {
    this.state = 'start';
    this.hideOverlay(this.el.gameOverOverlay);
    this.hideOverlay(this.el.levelCompleteOverlay);
    this.hideOverlay(this.el.pauseOverlay);
    this.showOverlay(this.el.startOverlay);
    document.getElementById('top').scrollIntoView({ behavior: 'smooth' });
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.showOverlay(this.el.pauseOverlay);
      this.el.pauseBtn.textContent = 'PAUSE';
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hideOverlay(this.el.pauseOverlay);
    }
  }

  resetPositions() {
    this.player.resetToStart();
    this.ghosts.forEach((g) => g.resetToStart());
  }

  applyLevelSpeeds() {
    const lvl = this.level;
    const turboMult = this.mode === 'turbo' ? 1.25 : 1;
    this.player.speed = BASE_PLAYER_SPEED * (1 + (lvl - 1) * 0.05);
    this.ghosts.forEach((g) => {
      g.baseSpeed = BASE_GHOST_SPEED * (1 + (lvl - 1) * 0.12) * turboMult;
    });
    this.frightenedDuration = Math.max(3000, (FRIGHTENED_BASE_MS - (lvl - 1) * 1000) / turboMult);
  }

  loseLife() {
    this.lives--;
    this.updateHearts();
    this.sound.death();
    if (this.lives <= 0) {
      this.gameOver();
    } else {
      this.state = 'dying';
      this.deathTimer = 1100;
    }
  }

  gameOver() {
    this.state = 'gameover';
    this.el.finalScore.textContent = String(this.score.score);
    this.el.nameEntry.classList.remove('is-saved');
    this.el.playerName.value = '';
    this.showOverlay(this.el.gameOverOverlay);
    this.sound.gameOver();
  }

  saveScore() {
    const name = this.el.playerName.value.trim() || 'PLAYER';
    this.score.submit(name, this.level, this.mode);
    this.el.nameEntry.classList.add('is-saved');
    this.renderHighScores();
    this.updateHud();
  }

  levelComplete() {
    this.state = 'levelcomplete';
    const bonus = this.score.addLevelBonus(this.level);
    this.el.levelCompleteBonus.textContent = `+${bonus} BONUS`;
    this.showOverlay(this.el.levelCompleteOverlay);
    this.updateHud();
    this.sound.levelComplete();
    this.levelCompleteTimer = 2200;
  }

  nextLevel() {
    this.level++;
    this.maze = new Maze();
    this.resetPositions();
    this.applyLevelSpeeds();
    this.hideOverlay(this.el.levelCompleteOverlay);
    this.updateHud();
    this.state = 'playing';
  }

  /* ---------------- HUD ---------------- */

  updateHud() {
    this.el.hudScore.textContent = String(this.score.score).padStart(6, '0');
    const hs = Math.max(this.score.topScore(), this.score.score);
    this.el.hudHighScore.textContent = String(hs).padStart(6, '0');
    this.el.hudLevel.textContent = String(this.level).padStart(2, '0');
  }

  updateHearts() {
    this.el.hearts.forEach((h, i) => h.classList.toggle('life-lost', i >= this.lives));
    this.el.livesWrap.setAttribute('aria-label', `${Math.max(this.lives, 0)} lives remaining`);
  }

  /* ---------------- collision ---------------- */

  checkCollisions() {
    for (const g of this.ghosts) {
      if (g.state === 'eaten') continue;
      const dx = g.centerX - this.player.centerX;
      const dy = g.centerY - this.player.centerY;
      const dist = Math.hypot(dx, dy);
      if (dist < TILE * 0.62) {
        if (g.state === 'frightened') {
          g.state = 'eaten';
          this.score.addGhost();
          this.sound.ghostEaten();
          this.updateHud();
        } else {
          this.loseLife();
        }
        return;
      }
    }
  }

  /* ---------------- main loop ---------------- */

  loop(timestamp) {
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05) || 0;
    this.lastTime = timestamp;

    if (this.state === 'playing') {
      this.update(dt);
    } else if (this.state === 'dying') {
      this.deathTimer -= dt * 1000;
      if (this.deathTimer <= 0) {
        this.resetPositions();
        this.state = 'playing';
      }
    } else if (this.state === 'levelcomplete') {
      this.levelCompleteTimer -= dt * 1000;
      if (this.levelCompleteTimer <= 0) this.nextLevel();
    }

    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    this.player.update(dt, this.maze);

    const eaten = this.maze.eatAt(this.player.col, this.player.row);
    if (eaten === 'pellet') {
      this.score.addPellet();
      this.sound.pellet();
      this.updateHud();
    } else if (eaten === 'power') {
      this.score.addPower();
      this.sound.power();
      this.ghosts.forEach((g) => g.setFrightened(this.frightenedDuration));
      this.updateHud();
    }

    this.ghosts.forEach((g) => g.update(dt, this.maze, this.player, this.ghosts));
    this.checkCollisions();

    if (this.maze.pelletsRemaining <= 0) {
      this.levelComplete();
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.maze.draw(ctx);
    this.ghosts.forEach((g) => g.draw(ctx));
    this.player.draw(ctx);
  }

  /* ---------------- high scores UI ---------------- */

  renderHighScores() {
    const list = this.score.highScores;
    const container = this.el.scoresList;
    container.querySelectorAll('.score-row').forEach((n) => n.remove());

    if (!list.length) {
      this.el.scoresEmpty.style.display = 'block';
      return;
    }
    this.el.scoresEmpty.style.display = 'none';

    list.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `
        <span class="score-rank">${String(i + 1).padStart(2, '0')}</span>
        <span>
          <span class="score-name">${escapeHtml(entry.name)}</span>
          <span class="score-meta">Level ${entry.level} · ${(entry.mode || 'classic').toUpperCase()} · ${entry.date}</span>
        </span>
        <span class="score-points">${String(entry.score).padStart(6, '0')}</span>
      `;
      container.appendChild(row);
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ----------------------------------------------------------------
   BOOTSTRAP
------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  window.pacGame = new Game();
});