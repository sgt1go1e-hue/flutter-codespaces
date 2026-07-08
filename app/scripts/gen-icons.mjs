// PWA アイコンを外部ライブラリ無しで生成する。
// ユーザー指定のロゴ(白背景+グラデーション青の開いた三角形モチーフ)を再現。
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
const WHITE = hex('#ffffff')
const LIGHT = hex('#7dd3fc') // 明るい水色（起点側）
const DARK = hex('#2563eb') // 濃い青（終点側）

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

function lerpColor(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ]
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
  const radius = S * 0.22
  // 参考画像(案1)を実測: 線の太さ ≒ アイコン全体の3%（従来の 9% から大幅に細く）
  const w = S * 0.015 // 線の太さ(半幅)

  const P = (nx, ny) => [nx * S, ny * S]
  // 開いた三角形モチーフ: 左下の短い足 → 長い斜辺(頂点へ) → 右辺(下へ) →
  // 斜めに戻るが起点までは閉じない(あえて開いた形にする)。
  // 座標は参考画像をピクセル解析して実測した比率（安全域 66% 前後に収める）。
  const p1 = P(0.175, 0.745) // 足の下端
  const p2 = P(0.175, 0.577) // 足の上端／長い斜辺の始点
  const p3 = P(0.83, 0.16) // 頂点
  const p4 = P(0.83, 0.84) // 右下
  const p5 = P(0.505, 0.555) // 戻りの斜線の終点(p2の手前で止まる)

  const segs = [
    [p1, p2],
    [p2, p3],
    [p3, p4],
    [p4, p5],
  ]
  // グラデーションは p1(明) → p3(暗) の軸に沿って全体に一貫してかける
  const gx = p3[0] - p1[0]
  const gy = p3[1] - p1[1]
  const gLen2 = gx * gx + gy * gy || 1

  const inRounded = (x, y) => {
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
      const inside = inRounded(x + 0.5, y + 0.5)
      let col = inside ? WHITE : null
      let minD = Infinity
      for (const [p, q] of segs) {
        const d = distSeg(x, y, p[0], p[1], q[0], q[1])
        if (d < minD) minD = d
      }
      if (inside && minD <= w) {
        const t = Math.max(
          0,
          Math.min(1, ((x - p1[0]) * gx + (y - p1[1]) * gy) / gLen2),
        )
        col = lerpColor(LIGHT, DARK, t)
      }
      if (col) {
        rgba[i] = col[0]
        rgba[i + 1] = col[1]
        rgba[i + 2] = col[2]
        rgba[i + 3] = 255
      } else {
        rgba[i + 3] = 0
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
