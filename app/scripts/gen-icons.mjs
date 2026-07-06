// PWA アイコンを外部ライブラリ無しで生成する。
// アプリのテーマ（アイソメの分岐＝ラン＋枝チーズ）をモチーフにした PNG を出力。
// zlib は Node 標準。ピクセルを直接描いて PNG(RGBA) にエンコードする。
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]
const BG = hex('#0f172a')
const BLUE = hex('#38bdf8')
const NODE = hex('#e2e8f0')

// 点と線分の距離
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // 各行の先頭にフィルタbyte(0)を付ける
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const S = size
  const radius = S * 0.22 // 角丸
  const lineW = S * 0.05 // 配管の太さ(半幅)
  const nodeR = S * 0.055
  // モチーフ座標（正規化 0..1 → px）。アプリの「本管ラン＋縦枝」を模す。
  const P = (nx, ny) => [nx * S, ny * S]
  const [a, b] = [P(0.2, 0.42), P(0.52, 0.6)] // ラン前半（右下がり）
  const [c] = [P(0.84, 0.42)] // ラン後半（右上がり）… b→c
  const [d] = [P(0.52, 0.2)] // 縦枝 b→d
  const segs = [
    [a, b],
    [b, c],
    [b, d],
  ]
  const nodes = [a, b, c, d]

  const inRounded = (x, y) => {
    // 角丸矩形の内側判定
    const rx = Math.min(x, S - 1 - x)
    const ry = Math.min(y, S - 1 - y)
    if (rx >= radius || ry >= radius) return true
    const dx = radius - rx
    const dy = radius - ry
    return dx * dx + dy * dy <= radius * radius
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      let col = null
      // 背景（角丸内のみ塗る。外は透明）
      const inside = inRounded(x + 0.5, y + 0.5)
      if (inside) col = BG
      // 配管ライン
      let onPipe = false
      for (const [p, q] of segs) {
        if (distSeg(x, y, p[0], p[1], q[0], q[1]) <= lineW) {
          onPipe = true
          break
        }
      }
      if (onPipe && inside) col = BLUE
      // ノード点
      for (const n of nodes) {
        if (Math.hypot(x - n[0], y - n[1]) <= nodeR && inside) {
          col = NODE
          break
        }
      }
      if (col) {
        rgba[i] = col[0]
        rgba[i + 1] = col[1]
        rgba[i + 2] = col[2]
        rgba[i + 3] = 255
      } else {
        rgba[i + 3] = 0 // 透明
      }
    }
  }
  return encodePng(S, rgba)
}

for (const size of [192, 512, 180]) {
  const png = drawIcon(size)
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`
  writeFileSync(join(outDir, name), png)
  console.log(`wrote ${name} (${png.length} bytes)`)
}
