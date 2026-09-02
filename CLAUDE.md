# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla-JS Tetris (HTML5 Canvas + CSS). Three source files, no dependencies, no `package.json`, no build step, no tests, no linter.

## Running

Open `index.html` directly (`start index.html` on Windows), or serve statically:

```bash
python3 -m http.server 8000   # or: npx serve .
```

There is nothing to build, lint, or test — verify changes by reloading the page in a browser.

## Architecture (`game.js`)

Single global script (`'use strict'`, no modules). All state lives in one `let` declaration near the top (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `lastTime`, `dropAccum`, `dropInterval`, `animId`); `init()` resets every field and is also the restart-button handler. The file self-starts by calling `init()` at the bottom.

Key invariants to preserve when editing:

- **Cell values are piece types, not booleans.** `PIECES[n]` matrices are filled with `n` itself (1–7), and that same integer indexes `COLORS`. `board[r][c]` stores `0` or that type index. So shape/board/color all share one numbering — never normalize shapes to 0/1.
- **`collide(shape, ox, oy)` reads the module-level `board`** and is used for movement, rotation kicks, ghost projection and spawn-death detection alike. It tolerates `ny < 0` (piece above the board) but rejects `nx` out of range or `ny >= ROWS`.
- **`clearLines()` mutates `board` in place** with `splice`/`unshift` and compensates with `r++` after a removal — the loop index must stay in sync if you touch it. It also owns the level/`dropInterval` recomputation and calls `updateHUD()`.
- **Rotation is transpose+reverse (`rotateCW`) plus a kick list** `[0,-1,1,-2,2]` in `tryRotate()`; this is not SRS, so kick tables are intentionally simplistic.
- **The rAF loop is started and cancelled in three places**: `init()`, `togglePause()` (resume path sets `lastTime = performance.now()` to avoid a huge `dt` spike, then re-enters `loop`), and `endGame()`. Any new pause/resume path must keep `animId` single-owner or the loop will double-run and drop pieces at 2×.
- **Canvas size is hard-coded in `index.html`** (`board` 300×600, `next-canvas` 120×120). Changing `COLS`, `ROWS` or `BLOCK` requires updating those attributes to `COLS*BLOCK` × `ROWS*BLOCK`. `drawNext()` separately assumes a 4×4 preview grid at 30px.
- **DOM lookups happen once at load** into module consts (`scoreEl`, `overlay`, …); the `#overlay` element is shared by both PAUSA and GAME OVER, differentiated only by the text written into `#overlay-title` / `#overlay-score`.

Input is a single `keydown` listener at the bottom of the file: `KeyP` is handled before the `paused || gameOver` guard so pause can be toggled off; everything else is gated by it.

## Conventions

UI strings, README, and comments are in Spanish. Keep them so.
