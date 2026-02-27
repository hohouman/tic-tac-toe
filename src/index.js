// ===== Server-side: Minimax 穷举引擎 + KV 缓存 =====

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWinnerServer(b) {
  for (let k = 0; k < LINES.length; k++) {
    const a = LINES[k][0], c = LINES[k][1], d = LINES[k][2];
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return 0;
}

/**
 * 在 Worker 端运行完整 minimax 穷举，并统计所有合法局面。
 * 返回 { mmCache, stats }
 */
function computeAllData() {
  const mmCache = {};

  function minimax(b, isX) {
    const key = b.join('') + (isX ? '1' : '0');
    if (mmCache[key] !== undefined) return mmCache[key];
    const w = checkWinnerServer(b);
    // 深度感知评分：快赢优于慢赢，慢输优于快输
    // 这样即使必败方也会封堵对手的即时威胁
    if (w !== 0) {
      let depth = 0;
      for (let i = 0; i < 9; i++) if (b[i] !== 0) depth++;
      const val = w === 1 ? (100 - depth) : (-100 + depth);
      mmCache[key] = val;
      return val;
    }
    let hasEmpty = false;
    for (let i = 0; i < 9; i++) { if (b[i] === 0) { hasEmpty = true; break; } }
    if (!hasEmpty) { mmCache[key] = 0; return 0; }
    let best = isX ? -100 : 100;
    for (let i = 0; i < 9; i++) {
      if (b[i] !== 0) continue;
      b[i] = isX ? 1 : 2;
      const v = minimax(b, !isX);
      if (isX) { if (v > best) best = v; }
      else { if (v < best) best = v; }
      b[i] = 0;
    }
    mmCache[key] = best;
    return best;
  }

  // 从空棋盘出发穷举所有可达状态
  minimax([0,0,0,0,0,0,0,0,0], true);
  minimax([0,0,0,0,0,0,0,0,0], false);

  // === 统计所有合法局面 ===
  let total = 0, xWins = 0, oWins = 0, draws = 0, ongoing = 0;
  for (let mask = 0; mask < 19683; mask++) {
    const b = [];
    let m = mask;
    for (let i = 0; i < 9; i++) { b.push(m % 3); m = Math.floor(m / 3); }
    let xs = 0, os = 0;
    for (let i = 0; i < 9; i++) { if (b[i] === 1) xs++; if (b[i] === 2) os++; }
    if (xs !== os && xs !== os + 1) continue;
    let xHas = false, oHas = false;
    for (let k = 0; k < LINES.length; k++) {
      const a = LINES[k][0], c = LINES[k][1], d = LINES[k][2];
      if (b[a] === 1 && b[c] === 1 && b[d] === 1) xHas = true;
      if (b[a] === 2 && b[c] === 2 && b[d] === 2) oHas = true;
    }
    if (xHas && oHas) continue;
    if (xHas && xs === os) continue;
    if (oHas && xs !== os) continue;
    total++;
    if (xHas) xWins++;
    else if (oHas) oWins++;
    else {
      let full = true;
      for (let i = 0; i < 9; i++) { if (b[i] === 0) { full = false; break; } }
      if (full) draws++; else ongoing++;
    }
  }

  // === 裁剪：只保留游戏中实际可达的最优路径状态 ===
  const fullSize = Object.keys(mmCache).length;
  const pruned = buildPrunedCache(mmCache);
  const prunedSize = Object.keys(pruned).length;

  return {
    mmCache: pruned,
    stats: { total, xWins, oWins, draws, ongoing },
    cacheInfo: { full: fullSize, pruned: prunedSize }
  };
}

/**
 * 从完整 minimax 缓存中裁剪出仅包含游戏可达最优路径的子集。
 * 对每个可达状态，保留所有子状态的评估值（getOptimalMoves 需要比较），
 * 但只递归进入最优子状态。
 */
function buildPrunedCache(fullCache) {
  const pruned = {};
  const visited = new Set();

  function ensureState(b, isX) {
    const key = b.join('') + (isX ? '1' : '0');
    if (visited.has(key)) return;
    visited.add(key);
    const val = fullCache[key];
    if (val === undefined) return;
    pruned[key] = val;

    // 终局状态无需展开
    if (checkWinnerServer(b) !== 0) return;
    let hasEmpty = false;
    for (let i = 0; i < 9; i++) { if (b[i] === 0) { hasEmpty = true; break; } }
    if (!hasEmpty) return;

    const piece = isX ? 1 : 2;
    let best = isX ? -100 : 100;

    // 第一遍：存储所有子状态的值（客户端比较用），找出最优值
    for (let i = 0; i < 9; i++) {
      if (b[i] !== 0) continue;
      b[i] = piece;
      const childKey = b.join('') + (!isX ? '1' : '0');
      const childVal = fullCache[childKey];
      if (childVal !== undefined) {
        pruned[childKey] = childVal;
        if (isX) { if (childVal > best) best = childVal; }
        else { if (childVal < best) best = childVal; }
      }
      b[i] = 0;
    }

    // 第二遍：只递归进入最优子状态
    for (let i = 0; i < 9; i++) {
      if (b[i] !== 0) continue;
      b[i] = piece;
      const childKey = b.join('') + (!isX ? '1' : '0');
      const childVal = fullCache[childKey];
      if (childVal === best) {
        ensureState(b, !isX);
      }
      b[i] = 0;
    }
  }

  // 模式一：用户在9个格子中任选一格放X，之后双方最优
  for (let i = 0; i < 9; i++) {
    const b = [0,0,0,0,0,0,0,0,0];
    b[i] = 1;
    ensureState(b, false);
  }

  // 模式二：电脑X在角/中落子，用户O在剩余8格任选，之后双方最优
  for (const xm of [0, 2, 4, 6, 8]) {
    for (let om = 0; om < 9; om++) {
      if (om === xm) continue;
      const b = [0,0,0,0,0,0,0,0,0];
      b[xm] = 1;
      b[om] = 2;
      // showSafeHint 需要此状态的值
      const hintKey = b.join('') + '1';
      if (fullCache[hintKey] !== undefined) pruned[hintKey] = fullCache[hintKey];
      ensureState(b, true);
    }
  }

  return pruned;
}

// ===== Worker 入口 =====

const KV_KEY = 'tictactoe_data_v3';

export default {
  async fetch(request, env, ctx) {
    let data;
    let fromKV = false;

    // 1) 先查 KV 缓存
    const cached = await env.GAME_KV.get(KV_KEY, { type: 'json' });

    if (cached) {
      data = cached;
      fromKV = true;
    } else {
      // 2) 首次触发：服务端穷举计算
      data = computeAllData();
      // 3) 异步写入 KV，不阻塞响应
      ctx.waitUntil(env.GAME_KV.put(KV_KEY, JSON.stringify(data)));
    }

    // 标记数据来源，让前端展示
    data._fromKV = fromKV;

    const html = buildHTML(data);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  },
};

// ===== 拼装 HTML（把预计算数据注入页面）=====

function buildHTML(data) {
  const injectedJSON = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>井字棋 · 最佳策略探索器</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='%230a0a2e'/><line x1='22' y1='4' x2='22' y2='60' stroke='%23333' stroke-width='2.5'/><line x1='42' y1='4' x2='42' y2='60' stroke='%23333' stroke-width='2.5'/><line x1='4' y1='22' x2='60' y2='22' stroke='%23333' stroke-width='2.5'/><line x1='4' y1='42' x2='60' y2='42' stroke='%23333' stroke-width='2.5'/><line x1='7' y1='7' x2='17' y2='17' stroke='%2300d4ff' stroke-width='3.5' stroke-linecap='round'/><line x1='17' y1='7' x2='7' y2='17' stroke='%2300d4ff' stroke-width='3.5' stroke-linecap='round'/><circle cx='52' cy='52' r='7' fill='none' stroke='%23ff6b9d' stroke-width='3.5'/><line x1='27' y1='27' x2='37' y2='37' stroke='%2300d4ff' stroke-width='3.5' stroke-linecap='round'/><line x1='37' y1='27' x2='27' y2='37' stroke='%2300d4ff' stroke-width='3.5' stroke-linecap='round'/><circle cx='12' cy='52' r='7' fill='none' stroke='%23ff6b9d' stroke-width='3.5'/></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  min-height:100vh;
  background:linear-gradient(135deg,#0a0a2e 0%,#1a1a4e 50%,#0d0d3d 100%);
  color:#fff;
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
  display:flex;flex-direction:column;align-items:center;
  padding:20px 15px 40px;
  overflow-x:hidden;
}
h1{
  font-size:2rem;margin-bottom:6px;
  background:linear-gradient(90deg,#00d4ff,#a855f7,#ff6b9d);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  background-clip:text;
  animation:fadeIn .8s ease-out;
}
.subtitle{font-size:.85rem;color:#999;margin-bottom:6px;animation:fadeIn 1s ease-out;}
#stats{font-size:.78rem;color:#666;margin-bottom:22px;text-align:center;animation:fadeIn 1.2s ease-out;line-height:1.6;}
#stats strong{color:#aaa;}
.kv-badge{
  display:inline-block;margin-top:4px;padding:2px 8px;border-radius:6px;
  font-size:.7rem;
}
.kv-hit{background:rgba(0,212,100,.15);color:#0d6;}
.kv-miss{background:rgba(255,107,50,.15);color:#f84;}
.modes{display:flex;gap:12px;margin-bottom:22px;flex-wrap:wrap;justify-content:center;animation:fadeIn 1s ease-out;}
.mode-btn{
  padding:14px 20px;border:2px solid #2a2a5a;border-radius:14px;
  background:rgba(255,255,255,.03);color:#999;font-size:.95rem;
  cursor:pointer;transition:all .3s;text-align:center;min-width:200px;
}
.mode-btn small{display:block;font-size:.75rem;margin-top:4px;color:#666;}
.mode-btn:hover{border-color:#5b5bd6;color:#ccc;background:rgba(91,91,214,.1);}
.mode-btn.active{
  border-color:#00d4ff;color:#00d4ff;
  background:rgba(0,212,255,.08);
  box-shadow:0 0 20px rgba(0,212,255,.15);
}
.mode-btn.active small{color:#00d4ff99;}
#msg{
  margin:0 0 18px;font-size:1.05rem;min-height:1.5em;
  text-align:center;color:#ccc;transition:all .3s;
}
.board-wrapper{position:relative;animation:fadeIn .6s ease-out;}
.board{
  display:grid;
  grid-template-columns:repeat(3,var(--cell-size));
  grid-template-rows:repeat(3,var(--cell-size));
  gap:5px;
  --cell-size:100px;
}
.cell{
  width:var(--cell-size);height:var(--cell-size);
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.08);
  border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;transition:all .25s;
  position:relative;overflow:hidden;
}
.cell:hover:not(.filled){
  background:rgba(255,255,255,.09);
  border-color:rgba(255,255,255,.2);
  transform:scale(1.03);
}
.cell.filled{cursor:default;}
.cell.flash{animation:cellFlash .35s ease-out;}
.cell.win-cell{animation:winPulse 1.2s infinite;border-color:currentColor;}
.cell .move-num{
  position:absolute;top:3px;right:5px;
  font-size:.65rem;color:rgba(255,255,255,.35);
  font-weight:600;
}
.piece-svg{display:block;}
.draw-line{
  stroke-dasharray:85;stroke-dashoffset:85;
  animation:drawStroke .35s ease forwards;
}
.draw-line:nth-child(2){animation-delay:.15s;}
.draw-circle{
  stroke-dasharray:201;stroke-dashoffset:201;
  animation:drawStroke .45s ease forwards;
}
#result{
  margin:14px 0 4px;font-size:1.35rem;font-weight:bold;
  display:none;text-align:center;
}
.result-draw{color:#ffd700;animation:glow 1.5s infinite alternate;}
.result-x{color:#00d4ff;animation:glow 1.5s infinite alternate;}
.result-o{color:#ff6b9d;animation:glow 1.5s infinite alternate;}
#hint{font-size:.82rem;color:#888;margin:6px 0 10px;text-align:center;min-height:1.2em;}
.controls{display:none;gap:10px;margin-top:12px;flex-wrap:wrap;justify-content:center;}
.ctrl-btn{
  padding:8px 18px;border:1px solid #3a3a6a;border-radius:9px;
  background:rgba(255,255,255,.06);color:#bbb;
  cursor:pointer;font-size:.88rem;transition:all .2s;
}
.ctrl-btn:hover{background:rgba(255,255,255,.12);border-color:#666;color:#fff;}
#history{
  margin-top:14px;font-size:.8rem;color:#777;
  text-align:center;max-width:400px;line-height:1.7;
  min-height:1.5em;
}
.footer{margin-top:auto;padding-top:30px;font-size:.72rem;color:#444;text-align:center;}
.win-svg-line{
  stroke-dasharray:320;stroke-dashoffset:320;
  animation:drawStroke .5s .2s ease forwards;
}
@keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
@keyframes drawStroke{to{stroke-dashoffset:0}}
@keyframes cellFlash{0%{background:rgba(255,255,255,.2)}100%{background:rgba(255,255,255,.04)}}
@keyframes glow{from{text-shadow:0 0 5px currentColor}to{text-shadow:0 0 20px currentColor,0 0 40px currentColor}}
@keyframes winPulse{0%,100%{box-shadow:0 0 6px currentColor}50%{box-shadow:0 0 22px currentColor,0 0 40px currentColor}}
@media(max-width:380px){
  .board{--cell-size:82px;}
  h1{font-size:1.5rem}
  .mode-btn{min-width:160px;padding:10px 14px;font-size:.88rem}
}
</style>
</head>
<body>

<h1>井字棋 · 最佳策略探索器</h1>
<p class="subtitle">穷举所有合法局面，感受最优博弈之美</p>

<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin:10px 0 6px;flex-wrap:wrap;">
  <img src="https://avatars.githubusercontent.com/u/36781453" alt="avatar" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;">
  <a href="https://github.com/hohouman/tic-tac-toe" target="_blank" rel="noopener" style="color:#58a6ff;text-decoration:none;font-size:.9rem;">⭐ GitHub Open Source</a>
  <span style="color:#555;font-size:.8rem;">|</span>
  <a href="https://leidun.pp.ua/" target="_blank" rel="noopener" style="color:#58a6ff;text-decoration:none;font-size:.9rem;">📝 My Blog</a>
</div>

<div id="stats">加载中...</div>

<div class="modes">
  <button class="mode-btn" data-mode="1" onclick="selectMode(1)">
    &#127919; 模式一
    <small>你选X的第一步 → 展示平局路径</small>
  </button>
  <button class="mode-btn" data-mode="2" onclick="selectMode(2)">
    &#129302; 模式二
    <small>电脑先手X → 你下O → 看结果</small>
  </button>
</div>

<div id="msg">选择一个模式开始探索</div>

<div class="board-wrapper">
  <div class="board" id="board">
    <div class="cell" data-i="0" onclick="cellClick(0)"></div>
    <div class="cell" data-i="1" onclick="cellClick(1)"></div>
    <div class="cell" data-i="2" onclick="cellClick(2)"></div>
    <div class="cell" data-i="3" onclick="cellClick(3)"></div>
    <div class="cell" data-i="4" onclick="cellClick(4)"></div>
    <div class="cell" data-i="5" onclick="cellClick(5)"></div>
    <div class="cell" data-i="6" onclick="cellClick(6)"></div>
    <div class="cell" data-i="7" onclick="cellClick(7)"></div>
    <div class="cell" data-i="8" onclick="cellClick(8)"></div>
  </div>
  <svg id="winLine" width="310" height="310" style="position:absolute;top:0;left:0;pointer-events:none;"></svg>
</div>

<div id="result"></div>
<div id="hint"></div>

<div class="controls" id="controls">
  <button class="ctrl-btn" onclick="replay()">&#128260; 重播</button>
  <button class="ctrl-btn" onclick="newPath()">&#127922; 换条路径</button>
  <button class="ctrl-btn" onclick="resetGame()">&#8617; 重新开始</button>
</div>

<div id="history"></div>

<div class="footer">
  Minimax 穷举引擎 · 服务端预计算 + KV 缓存 · 所有路径均为双方最优解
</div>

<!-- 服务端预计算数据注入 -->
<script>window.__DATA__=${injectedJSON};</script>

<script>
(function(){
'use strict';

var DATA = window.__DATA__;
var mmCache = DATA.mmCache;
var serverStats = DATA.stats;

var LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
var POS_NAMES = ['左上','上','右上','左','中','右','左下','下','右下'];

/* ===== 游戏引擎（查表，不再本地计算） ===== */

function checkWinner(b) {
  for (var k = 0; k < LINES.length; k++) {
    var a = LINES[k][0], c = LINES[k][1], d = LINES[k][2];
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return 0;
}

/** minimax 直接查服务端预计算的查找表 */
function minimax(b, isX) {
  var key = b.join('') + (isX ? '1' : '0');
  return mmCache[key];
}

function getOptimalMoves(b, isX) {
  var piece = isX ? 1 : 2;
  var bestVal = isX ? -100 : 100;
  var moves = [];
  for (var i = 0; i < 9; i++) {
    if (b[i] !== 0) continue;
    b[i] = piece;
    var v = minimax(b, !isX);
    b[i] = 0;
    if ((isX && v > bestVal) || (!isX && v < bestVal)) {
      bestVal = v;
      moves = [i];
    } else if (v === bestVal) {
      moves.push(i);
    }
  }
  return { moves: moves, value: bestVal };
}

function generateOptimalPath(bSrc, isXTurn) {
  var b = bSrc.slice();
  var path = [];
  var turn = isXTurn;
  while (true) {
    if (checkWinner(b)) break;
    var hasEmpty = false;
    for (var i = 0; i < 9; i++) { if (b[i] === 0) { hasEmpty = true; break; } }
    if (!hasEmpty) break;
    var info = getOptimalMoves(b, turn);
    var mv = info.moves[Math.floor(Math.random() * info.moves.length)];
    var pc = turn ? 1 : 2;
    b[mv] = pc;
    path.push({ pos: mv, piece: pc });
    turn = !turn;
  }
  return { path: path, board: b, winner: checkWinner(b) };
}

/* ===== App State ===== */

var mode = 0;
var phase = 'idle';
var board = [0,0,0,0,0,0,0,0,0];
var fullPath = [];
var animTimer = null;
var animIdx = 0;
var computerFirst = -1;

/* ===== DOM Helpers ===== */

function $(id) { return document.getElementById(id); }
function qcell(i) { return document.querySelector('.cell[data-i="' + i + '"]'); }

function makeSVGPiece(piece) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', '58');
  svg.setAttribute('height', '58');
  svg.classList.add('piece-svg');
  if (piece === 1) {
    var l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l1.setAttribute('x1','22'); l1.setAttribute('y1','22');
    l1.setAttribute('x2','78'); l1.setAttribute('y2','78');
    l1.setAttribute('stroke','#00d4ff'); l1.setAttribute('stroke-width','11');
    l1.setAttribute('stroke-linecap','round'); l1.classList.add('draw-line');
    var l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l2.setAttribute('x1','78'); l2.setAttribute('y1','22');
    l2.setAttribute('x2','22'); l2.setAttribute('y2','78');
    l2.setAttribute('stroke','#00d4ff'); l2.setAttribute('stroke-width','11');
    l2.setAttribute('stroke-linecap','round'); l2.classList.add('draw-line');
    svg.appendChild(l1); svg.appendChild(l2);
  } else {
    var ci = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ci.setAttribute('cx','50'); ci.setAttribute('cy','50'); ci.setAttribute('r','32');
    ci.setAttribute('fill','none'); ci.setAttribute('stroke','#ff6b9d');
    ci.setAttribute('stroke-width','11'); ci.classList.add('draw-circle');
    svg.appendChild(ci);
  }
  return svg;
}

function placePieceDOM(pos, piece, moveNum) {
  var cell = qcell(pos);
  cell.innerHTML = '';
  cell.classList.add('filled');
  cell.appendChild(makeSVGPiece(piece));
  var num = document.createElement('span');
  num.className = 'move-num';
  num.textContent = moveNum;
  cell.appendChild(num);
  cell.classList.remove('flash');
  void cell.offsetWidth;
  cell.classList.add('flash');
}

function clearBoard() {
  for (var i = 0; i < 9; i++) {
    var cell = qcell(i);
    cell.innerHTML = '';
    cell.classList.remove('filled','flash','win-cell');
    cell.style.color = '';
  }
  $('winLine').innerHTML = '';
}

function highlightWin(winner) {
  for (var k = 0; k < LINES.length; k++) {
    var a = LINES[k][0], c = LINES[k][1], d = LINES[k][2];
    if (board[a] === winner && board[c] === winner && board[d] === winner) {
      var color = winner === 1 ? '#00d4ff' : '#ff6b9d';
      qcell(a).classList.add('win-cell'); qcell(a).style.color = color;
      qcell(c).classList.add('win-cell'); qcell(c).style.color = color;
      qcell(d).classList.add('win-cell'); qcell(d).style.color = color;
      drawWinSVGLine(LINES[k], color);
      break;
    }
  }
}

function drawWinSVGLine(line, color) {
  var sz = 100, gap = 5;
  function cx(i) { return (i % 3) * (sz + gap) + sz / 2; }
  function cy(i) { return Math.floor(i / 3) * (sz + gap) + sz / 2; }
  var svg = $('winLine');
  var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  ln.setAttribute('x1', cx(line[0])); ln.setAttribute('y1', cy(line[0]));
  ln.setAttribute('x2', cx(line[2])); ln.setAttribute('y2', cy(line[2]));
  ln.setAttribute('stroke', color); ln.setAttribute('stroke-width', '5');
  ln.setAttribute('stroke-linecap', 'round'); ln.setAttribute('opacity', '0.7');
  ln.classList.add('win-svg-line');
  svg.appendChild(ln);
}

/* ===== Game Flow ===== */

window.selectMode = function(m) {
  clearAnim();
  mode = m;
  board = [0,0,0,0,0,0,0,0,0];
  fullPath = [];
  computerFirst = -1;
  clearBoard();
  $('result').style.display = 'none';
  $('hint').textContent = '';
  $('controls').style.display = 'none';
  $('history').textContent = '';

  document.querySelectorAll('.mode-btn').forEach(function(btn) {
    btn.classList.toggle('active', parseInt(btn.getAttribute('data-mode')) === m);
  });

  if (m === 1) {
    $('msg').textContent = '请点击任意一格，作为 X 的第一步';
    phase = 'waiting';
  } else {
    var strong = [0, 2, 4, 6, 8];
    computerFirst = strong[Math.floor(Math.random() * strong.length)];
    board[computerFirst] = 1;
    fullPath = [{ pos: computerFirst, piece: 1 }];
    placePieceDOM(computerFirst, 1, 1);
    phase = 'waiting';
    $('msg').textContent = '电脑(X) 落子于「' + POS_NAMES[computerFirst] + '」，请点击一格作为 O 的第二步';
  }
};

window.cellClick = function(i) {
  if (phase !== 'waiting') return;
  if (board[i] !== 0) return;

  if (mode === 1) {
    board[i] = 1;
    fullPath = [{ pos: i, piece: 1 }];
    placePieceDOM(i, 1, 1);
    var result = generateOptimalPath(board, false);
    for (var j = 0; j < result.path.length; j++) {
      fullPath.push(result.path[j]);
    }
    startAnim(1);
  } else {
    board[i] = 2;
    fullPath.push({ pos: i, piece: 2 });
    placePieceDOM(i, 2, 2);
    var result = generateOptimalPath(board, true);
    for (var j = 0; j < result.path.length; j++) {
      fullPath.push(result.path[j]);
    }
    startAnim(2);
  }
};

function startAnim(fromIdx) {
  phase = 'animating';
  $('msg').textContent = '正在展示最佳策略路径...';
  animIdx = fromIdx;
  animTimer = setInterval(function() {
    if (animIdx >= fullPath.length) {
      clearInterval(animTimer);
      animTimer = null;
      finishAnim();
      return;
    }
    var mv = fullPath[animIdx];
    board[mv.pos] = mv.piece;
    placePieceDOM(mv.pos, mv.piece, animIdx + 1);
    animIdx++;
  }, 650);
}

function finishAnim() {
  phase = 'done';
  var winner = checkWinner(board);
  var el = $('result');
  if (winner === 1) {
    el.textContent = '\\ud83c\\udfc6 X 获胜！';
    el.className = 'result-x';
  } else if (winner === 2) {
    el.textContent = '\\ud83c\\udfc6 O 获胜！';
    el.className = 'result-o';
  } else {
    el.textContent = '\\ud83e\\udd1d 平局！';
    el.className = 'result-draw';
  }
  el.style.display = 'block';

  if (winner) highlightWin(winner);

  if (mode === 1) {
    $('msg').textContent = '双方均走最佳策略，结果必然是平局。';
  } else {
    if (winner === 1) {
      $('msg').textContent = 'O 的第二步给了 X 可乘之机！最佳策略下 X 将获胜。';
      showSafeHint();
    } else {
      $('msg').textContent = '好眼力！O 的第二步很稳健，双方最佳策略下是平局。';
    }
  }

  showHistory();
  $('controls').style.display = 'flex';
}

function showSafeHint() {
  if (mode !== 2 || computerFirst < 0) return;
  var safe = [];
  for (var i = 0; i < 9; i++) {
    if (i === computerFirst) continue;
    var tb = [0,0,0,0,0,0,0,0,0];
    tb[computerFirst] = 1;
    tb[i] = 2;
    var val = minimax(tb, true);
    if (val <= 0) safe.push(POS_NAMES[i]);
  }
  if (safe.length > 0) {
    $('hint').textContent = '\\ud83d\\udca1 能保持平局的 O 位置：' + safe.join('、');
  }
}

function showHistory() {
  var parts = [];
  for (var i = 0; i < fullPath.length; i++) {
    var m = fullPath[i];
    var name = m.piece === 1 ? 'X' : 'O';
    parts.push((i + 1) + '. ' + name + '→' + POS_NAMES[m.pos]);
  }
  $('history').textContent = parts.join('   ');
}

function clearAnim() {
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
}

window.replay = function() {
  clearAnim();
  board = [0,0,0,0,0,0,0,0,0];
  clearBoard();
  $('result').style.display = 'none';
  $('hint').textContent = '';
  $('controls').style.display = 'none';
  $('history').textContent = '';
  phase = 'animating';
  $('msg').textContent = '重播中...';
  animIdx = 0;
  animTimer = setInterval(function() {
    if (animIdx >= fullPath.length) {
      clearInterval(animTimer);
      animTimer = null;
      finishAnim();
      return;
    }
    var mv = fullPath[animIdx];
    board[mv.pos] = mv.piece;
    placePieceDOM(mv.pos, mv.piece, animIdx + 1);
    animIdx++;
  }, 650);
};

window.newPath = function() {
  clearAnim();
  var keepCount = (mode === 1) ? 1 : 2;
  var kept = fullPath.slice(0, keepCount);

  board = [0,0,0,0,0,0,0,0,0];
  for (var i = 0; i < kept.length; i++) {
    board[kept[i].pos] = kept[i].piece;
  }

  fullPath = kept.slice();
  var isXNext = (mode === 1) ? false : true;
  var result = generateOptimalPath(board, isXNext);
  for (var j = 0; j < result.path.length; j++) {
    fullPath.push(result.path[j]);
  }

  board = [0,0,0,0,0,0,0,0,0];
  clearBoard();
  $('result').style.display = 'none';
  $('hint').textContent = '';
  $('controls').style.display = 'none';
  $('history').textContent = '';

  phase = 'animating';
  $('msg').textContent = '展示另一条最佳策略路径...';
  animIdx = 0;
  animTimer = setInterval(function() {
    if (animIdx >= fullPath.length) {
      clearInterval(animTimer);
      animTimer = null;
      finishAnim();
      return;
    }
    var mv = fullPath[animIdx];
    board[mv.pos] = mv.piece;
    placePieceDOM(mv.pos, mv.piece, animIdx + 1);
    animIdx++;
  }, 650);
};

window.resetGame = function() {
  selectMode(mode);
};

/* ===== 初始化（使用服务端预计算数据，零本地计算） ===== */

function init() {
  var s = serverStats;
  var ci = DATA.cacheInfo || {};
  var cacheSize = Object.keys(mmCache).length;
  $('stats').innerHTML =
    '服务端已穷举 <strong>' + s.total.toLocaleString() + '</strong> 种合法局面 &nbsp;|&nbsp; ' +
    'X胜: <strong>' + s.xWins + '</strong> &nbsp;|&nbsp; ' +
    'O胜: <strong>' + s.oWins + '</strong> &nbsp;|&nbsp; ' +
    '平局: <strong>' + s.draws + '</strong> &nbsp;|&nbsp; ' +
    '进行中: <strong>' + s.ongoing.toLocaleString() + '</strong>' +
    '<br><span class="kv-badge ' + (DATA._fromKV ? 'kv-hit' : 'kv-miss') + '">' +
    (DATA._fromKV ? 'KV 缓存命中 \\u2713' : '首次计算 \\u2192 已写入 KV') +
    '</span> &nbsp; 查找表: <strong>' + cacheSize.toLocaleString() + '</strong> 条目' +
    (ci.full ? ' (从 ' + ci.full.toLocaleString() + ' 裁剪至最优路径)' : '');

  selectMode(1);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
</script>
</body>
</html>`;
}
