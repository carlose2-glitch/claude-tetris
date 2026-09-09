'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - azul pálido
  '#ffb74d', // L - orange
  '#b0bec5', // N - tuerca (gris metálico)
  '#ff4081', // B - bomba (rosa intenso)
  '#7c4dff', // R - rayo (violeta eléctrico)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca (3x3 con hueco central)
  [[9]],                                       // B - bomba (1x1, explota al caer)
  [[10]],                                      // R - rayo (1x1, arrasa fila o columna)
];

// Las piezas especiales no entran en el sorteo aleatorio (que solo cubre 1..BOMB-1):
// cada una aparece por contador, cada BOMB_EVERY / RAY_EVERY piezas.
const BOMB = 9;
const BOMB_EVERY = 12;
const BOMB_RADIUS = 1; // radio 1 => área de 3 x 3
const BOMB_SCORE = 10; // puntos por bloque destruido

const RAY = 10;
const RAY_EVERY = 15;
const RAY_SCORE = 15; // puntos por bloque arrasado

const LINE_SCORES = [0, 100, 300, 500, 800];

const INITIAL_DROP = 1000;  // ms entre bajada y bajada al empezar
const SPEEDUP_LINES = 20;   // cada cuántas líneas se acelera la caída
const SPEEDUP_RATE = 0.10;  // 10 % de la velocidad INICIAL por escalón

const THEME_STORAGE_KEY = 'tetris-theme';
const THEME_PALETTES = {
  dark: { grid: '#22222e', highlight: 'rgba(255,255,255,0.12)', icon: '🌙' },
  light: { grid: '#d8d8e4', highlight: 'rgba(0,0,0,0.12)', icon: '☀️' },
};

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, theme, piecesUntilBomb, piecesUntilRay;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  // Se descuentan siempre los dos contadores para que ninguna especial se
  // salte su turno cuando ambas coinciden en la misma pieza.
  piecesUntilBomb--;
  piecesUntilRay--;
  if (piecesUntilBomb <= 0) {
    piecesUntilBomb = BOMB_EVERY;
    return makePiece(BOMB);
  }
  if (piecesUntilRay <= 0) {
    piecesUntilRay = RAY_EVERY;
    return makePiece(RAY);
  }
  return makePiece(Math.floor(Math.random() * (BOMB - 1)) + 1);
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

// Vacía el área alrededor de la bomba y deja caer lo que quede flotando.
function explode(cx, cy) {
  let destroyed = 0;
  for (let r = cy - BOMB_RADIUS; r <= cy + BOMB_RADIUS; r++) {
    if (r < 0 || r >= ROWS) continue;
    for (let c = cx - BOMB_RADIUS; c <= cx + BOMB_RADIUS; c++) {
      if (c < 0 || c >= COLS) continue;
      if (board[r][c]) { board[r][c] = 0; destroyed++; }
    }
  }
  collapseColumns();
  score += destroyed * BOMB_SCORE;
  updateHUD();
}

// Compacta cada columna hacia abajo para que el hueco de la explosión no deje
// bloques flotando en el aire.
function collapseColumns() {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r][c]) continue;
      if (write !== r) {
        board[write][c] = board[r][c];
        board[r][c] = 0;
      }
      write--;
    }
  }
}

// El rayo arrasa la fila o la columna donde cae. La elección es aleatoria: el
// jugador no decide cuál de las dos toca.
function strike(cx, cy) {
  let destroyed = 0;
  if (Math.random() < 0.5) {
    // Fila entera: el rayo se para ENCIMA del montón, así que su propia fila
    // está vacía; la que arrasa es la de justo debajo, la que ha golpeado (o la
    // suya si ha caído hasta el suelo). Se elimina y todo lo de encima baja.
    const row = Math.min(cy + 1, ROWS - 1);
    destroyed = board[row].reduce((n, v) => n + (v ? 1 : 0), 0);
    board.splice(row, 1);
    board.unshift(new Array(COLS).fill(0));
  } else {
    // columna entera: se vacía de arriba abajo
    for (let r = 0; r < ROWS; r++) {
      if (board[r][cx]) { board[r][cx] = 0; destroyed++; }
    }
  }
  score += destroyed * RAY_SCORE;
  updateHUD();
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = dropIntervalFor(lines);
    updateHUD();
  }
}

// La velocidad sube un SPEEDUP_RATE de la velocidad INICIAL por cada escalón de
// SPEEDUP_LINES líneas (acumulación lineal, no compuesta); el intervalo entre
// bajadas es su inverso. El nivel va por su cuenta y ya no toca la velocidad.
function dropIntervalFor(clearedLines) {
  const steps = Math.floor(clearedLines / SPEEDUP_LINES);
  return Math.max(100, Math.round(INITIAL_DROP / (1 + SPEEDUP_RATE * steps)));
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.type === BOMB) explode(current.x, current.y);
  else if (current.type === RAY) strike(current.x, current.y);
  else merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  if (colorIndex === BOMB) { drawBomb(context, x, y, size, alpha); return; }
  if (colorIndex === RAY) { drawRay(context, x, y, size, alpha); return; }
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = THEME_PALETTES[theme].highlight;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawBomb(context, x, y, size, alpha) {
  const cx = x * size + size / 2;
  const cy = y * size + size / 2;
  const rad = size / 2 - 3;
  context.globalAlpha = alpha ?? 1;
  // cuerpo
  context.fillStyle = COLORS[BOMB];
  context.beginPath();
  context.arc(cx, cy, rad, 0, Math.PI * 2);
  context.fill();
  // brillo
  context.fillStyle = THEME_PALETTES[theme].highlight;
  context.beginPath();
  context.arc(cx - rad / 3, cy - rad / 3, rad / 3.5, 0, Math.PI * 2);
  context.fill();
  // mecha
  context.strokeStyle = COLORS[BOMB];
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(cx, cy - rad);
  context.quadraticCurveTo(cx + rad, cy - rad, cx + rad * 0.7, cy - rad - rad * 0.6);
  context.stroke();
  context.globalAlpha = 1;
}

// Polígono del rayo en coordenadas normalizadas (0..1) dentro de la celda.
const RAY_PATH = [
  [0.62, 0.04], [0.18, 0.56], [0.44, 0.56],
  [0.34, 0.96], [0.82, 0.42], [0.54, 0.42],
];

function drawRay(context, x, y, size, alpha) {
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = COLORS[RAY];
  context.beginPath();
  RAY_PATH.forEach(([px, py], i) => {
    const cx = x * size + px * size;
    const cy = y * size + py * size;
    if (i === 0) context.moveTo(cx, cy);
    else context.lineTo(cx, cy);
  });
  context.closePath();
  context.fill();
  // brillo
  context.strokeStyle = THEME_PALETTES[theme].highlight;
  context.lineWidth = 2;
  context.stroke();
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = THEME_PALETTES[theme].grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // tras el game over la pieza no llegó a entrar: se pinta solo el tablero
  if (gameOver) return;

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function applyTheme(newTheme) {
  theme = newTheme;
  document.body.classList.toggle('light-theme', theme === 'light');
  themeToggleBtn.textContent = THEME_PALETTES[theme].icon;
  themeToggleBtn.setAttribute('aria-pressed', String(theme === 'light'));
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  if (current) draw();
  if (next) drawNext();
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    // Se descuenta el intervalo en vez de poner el acumulador a 0: así no se
    // tira el sobrante del frame y el periodo real es exacto. Con dropAccum = 0
    // el ritmo se redondeaba a frames enteros (16,7 ms a 60 fps) y una mejora
    // pequeña, como el 1 % de 1000 ms, se perdía entera en el redondeo.
    dropAccum -= dropInterval;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  // lockPiece() puede haber terminado la partida: el cancelAnimationFrame() de
  // endGame() apuntaba a este mismo frame, que ya había disparado, así que no
  // sirvió de nada. Hay que salir sin encolar el siguiente.
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark');
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = dropIntervalFor(lines);
  dropAccum = 0;
  piecesUntilBomb = BOMB_EVERY;
  piecesUntilRay = RAY_EVERY;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

// Tras un clic con el ratón el botón se queda con el foco del DOM, y entonces el
// navegador lo vuelve a activar al pulsar Espacio. Con la partida terminada o en
// pausa el keydown sale antes del preventDefault() del hard drop, así que ese
// Espacio acababa cambiando el tema. Se suelta el foco solo si el clic vino del
// ratón (detail > 0); si vino del teclado se respeta, para no romper el tabulado.
function blurAfterMouseClick(e) {
  if (e.detail > 0) e.currentTarget.blur();
}

restartBtn.addEventListener('click', e => { blurAfterMouseClick(e); init(); });
themeToggleBtn.addEventListener('click', e => {
  blurAfterMouseClick(e);
  applyTheme(theme === 'dark' ? 'light' : 'dark');
});

init();
