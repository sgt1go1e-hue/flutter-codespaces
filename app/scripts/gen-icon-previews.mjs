// アプリアイコンの候補デザインをいくつか生成し、選定用にプレビューPNGを出力する。
// 依存ライブラリ無しで動く自作PNGエンコーダ（scripts/gen-icons.mjs と同じ方式）。
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const OUT_DIR = process.argv[2] || '.'

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]
const BG = hex('#0f172a')
const BLUE = hex('#38bdf8')
const NODE = hex('#e2e8f0')
const GREEN = hex('#34d399')
const AMBER = hex('#fbbf24')

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

// 点が凸多角形の内側にあるか(半平面判定の積み重ね)
function insidePoly(px, py, pts) {
  let sign = 0
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[(i + 1) % pts.length]
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1
      if (sign === 0) sign = s
      else if (s !== sign) return false
    }
  }
  return true
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function makeCanvas(S) {
  const rgba = Buffer.alloc(S * S * 4)
  const radius = S * 0.22
  const inRounded = (x, y) => {
    const rx = Math.min(x, S - 1 - x)
    const ry = Math.min(y, S - 1 - y)
    if (rx >= radius || ry >= radius) return true
    const dx = radius - rx
    const dy = radius - ry
    return dx * dx + dy * dy <= radius * radius
  }
  const set = (x, y, col) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return
    const i = (y * S + x) * 4
    rgba[i] = col[0]
    rgba[i + 1] = col[1]
    rgba[i + 2] = col[2]
    rgba[i + 3] = 255
  }
  return { rgba, S, inRounded, set }
}

function fillBg(cv) {
  const { S, inRounded, set } = cv
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) if (inRounded(x + 0.5, y + 0.5)) set(x, y, BG)
}

function strokeSegs(cv, segs, w, col) {
  const { S, inRounded, set } = cv
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRounded(x + 0.5, y + 0.5)) continue
      for (const [p, q] of segs) {
        if (distSeg(x, y, p[0], p[1], q[0], q[1]) <= w) {
          set(x, y, col)
          break
        }
      }
    }
  }
}

function fillCircles(cv, pts, r, col) {
  const { S, inRounded, set } = cv
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRounded(x + 0.5, y + 0.5)) continue
      for (const [cx, cy] of pts) {
        if (Math.hypot(x - cx, y - cy) <= r) {
          set(x, y, col)
          break
        }
      }
    }
  }
}

function fillPoly(cv, pts, col) {
  const { S, inRounded, set } = cv
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRounded(x + 0.5, y + 0.5)) continue
      if (insidePoly(x + 0.5, y + 0.5, pts)) set(x, y, col)
    }
  }
}

const P = (S, nx, ny) => [nx * S, ny * S]

// --- A: 現行案(分岐チーズ) ---
function drawA(S) {
  const cv = makeCanvas(S)
  fillBg(cv)
  const a = P(S, 0.2, 0.42)
  const b = P(S, 0.52, 0.6)
  const c = P(S, 0.84, 0.42)
  const d = P(S, 0.52, 0.2)
  strokeSegs(cv, [[a, b], [b, c], [b, d]], S * 0.05, BLUE)
  fillCircles(cv, [a, b, c, d], S * 0.055, NODE)
  return cv.rgba
}

// --- B: アイソメひし形(グリッド1マス) ---
function drawB(S) {
  const cv = makeCanvas(S)
  fillBg(cv)
  const top = P(S, 0.5, 0.18)
  const right = P(S, 0.82, 0.5)
  const bottom = P(S, 0.5, 0.82)
  const left = P(S, 0.18, 0.5)
  const w = S * 0.045
  strokeSegs(cv, [[top, right], [right, bottom], [bottom, left], [left, top]], w, BLUE)
  fillCircles(cv, [top, right, bottom, left], S * 0.05, NODE)
  return cv.rgba
}

// --- C: アイソメL字エルボ(単純な配管の曲がり) ---
function drawC(S) {
  const cv = makeCanvas(S)
  fillBg(cv)
  const a = P(S, 0.22, 0.28)
  const b = P(S, 0.5, 0.46)
  const c = P(S, 0.5, 0.78)
  strokeSegs(cv, [[a, b], [b, c]], S * 0.07, BLUE)
  fillCircles(cv, [a, c], S * 0.065, NODE)
  // エルボの角に小さい円弧っぽいアクセント(ノード)
  fillCircles(cv, [b], S * 0.05, AMBER)
  return cv.rgba
}

// --- D: 寸法線モチーフ(切り寸法の下線表現) ---
function drawD(S) {
  const cv = makeCanvas(S)
  fillBg(cv)
  const a = P(S, 0.24, 0.36)
  const b = P(S, 0.76, 0.36)
  strokeSegs(cv, [[a, b]], S * 0.055, BLUE)
  fillCircles(cv, [a, b], S * 0.06, NODE)
  // 下段: 寸法線(緑・下線イメージ)
  const da = P(S, 0.28, 0.62)
  const db = P(S, 0.72, 0.62)
  strokeSegs(cv, [[da, db]], S * 0.03, GREEN)
  // 端の小さいティック
  const t1a = P(S, 0.28, 0.57)
  const t1b = P(S, 0.28, 0.67)
  const t2a = P(S, 0.72, 0.57)
  const t2b = P(S, 0.72, 0.67)
  strokeSegs(cv, [[t1a, t1b], [t2a, t2b]], S * 0.025, GREEN)
  return cv.rgba
}

// --- E: アイソメキューブ頂点(3方向線) ---
function drawE(S) {
  const cv = makeCanvas(S)
  fillBg(cv)
  const center = P(S, 0.5, 0.55)
  const up = P(S, 0.5, 0.22)
  const dl = P(S, 0.22, 0.7)
  const dr = P(S, 0.78, 0.7)
  strokeSegs(cv, [[center, up], [center, dl], [center, dr]], S * 0.055, BLUE)
  fillCircles(cv, [center, up, dl, dr], S * 0.05, NODE)
  return cv.rgba
}

// 配管の端に直交する短いティック(フランジ記号)を描く。アプリ本体の
// flangeMarker と同じ考え方：端点での配管方向に垂直な線分を引く。
function flangeTick(p, other, S, half = S * 0.09) {
  const len = Math.hypot(other[0] - p[0], other[1] - p[1]) || 1
  const ux = (other[0] - p[0]) / len
  const uy = (other[1] - p[1]) / len
  const nx = -uy
  const ny = ux
  return [
    [p[0] - nx * half, p[1] - ny * half],
    [p[0] + nx * half, p[1] + ny * half],
  ]
}

// --- F: 3節スプール(エルボ2つ・フランジ端) ---
// 現場のスプール図(部分詳細図)らしく、アイソメ角で折れ曲がる配管ルートに
// フランジ端(直交ティック)を付けたモチーフ。
function drawF(S) {
  const cv = makeCanvas(S)
  fillBg(cv)
  const a = P(S, 0.2, 0.72)
  const b = P(S, 0.42, 0.58)
  const c = P(S, 0.42, 0.3)
  const d = P(S, 0.72, 0.16)
  const w = S * 0.05
  strokeSegs(cv, [[a, b], [b, c], [c, d]], w, BLUE)
  fillCircles(cv, [b, c], S * 0.045, NODE)
  // 両端にフランジのティック
  const [f1a, f1b] = flangeTick(a, b, S)
  const [f2a, f2b] = flangeTick(d, c, S)
  strokeSegs(cv, [[f1a, f1b], [f2a, f2b]], S * 0.032, NODE)
  return cv.rgba
}

// --- G: フランジ付き直管スプール(1本・両端フランジ) ---
function drawG(S) {
  const cv = makeCanvas(S)
  fillBg(cv)
  const a = P(S, 0.22, 0.66)
  const b = P(S, 0.78, 0.34)
  const w = S * 0.06
  strokeSegs(cv, [[a, b]], w, BLUE)
  const [f1a, f1b] = flangeTick(a, b, S, S * 0.1)
  const [f2a, f2b] = flangeTick(b, a, S, S * 0.1)
  strokeSegs(cv, [[f1a, f1b], [f2a, f2b]], S * 0.035, NODE)
  return cv.rgba
}

// --- H: 溶接点付きスプール(エルボ+レジューサー風の径変化) ---
function drawH(S) {
  const cv = makeCanvas(S)
  fillBg(cv)
  const a = P(S, 0.18, 0.3)
  const b = P(S, 0.46, 0.46)
  const c = P(S, 0.46, 0.78)
  strokeSegs(cv, [[a, b]], S * 0.065, BLUE)
  strokeSegs(cv, [[b, c]], S * 0.04, BLUE)
  // 溶接点(小さいアンバーの丸)を継ぎ目に
  fillCircles(cv, [a, b, c], S * 0.032, AMBER)
  return cv.rgba
}

const variants = { A: drawA, B: drawB, C: drawC, D: drawD, E: drawE, F: drawF, G: drawG, H: drawH }
for (const [key, fn] of Object.entries(variants)) {
  const S = 512
  const rgba = fn(S)
  const png = encodePng(S, rgba)
  const path = `${OUT_DIR}/icon-preview-${key}.png`
  writeFileSync(path, png)
  console.log(`wrote ${path}`)
}
