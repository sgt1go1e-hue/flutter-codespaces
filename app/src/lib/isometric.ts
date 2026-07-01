import type { Point } from '../types'

// ユーザー指定のアイソメ角度（度）。画面座標は y が下向きである点に注意。
export const ISO_ANGLES = [0, 30, 90, 150, 210, 270, 330] as const

// スナップ候補は、指定角度とその反対方向（+180°）を合わせた対称な集合にする。
// これにより、どの向きに線を引いても最寄りのアイソメ軸へ吸着できる。
const SNAP_CANDIDATES: number[] = Array.from(
  new Set(
    ISO_ANGLES.flatMap((a) => [a, (a + 180) % 360]),
  ),
).sort((a, b) => a - b)

const DEG = Math.PI / 180

/** 2点間の距離 */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** ベクトル (dx, dy) の角度を度で返す（0〜360） */
export function angleOf(dx: number, dy: number): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI
  return (deg + 360) % 360
}

/** 2つの角度（度）の最小差（0〜180） */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b + 180) % 360) - 180)
  return d
}

/**
 * 始点と終点から、アイソメ角度にスナップした終点を計算する。
 * 線分の長さ（始点〜終点の距離）は保ったまま、向きだけを最寄りのアイソメ軸に合わせる。
 */
export function snapToIsometric(
  start: Point,
  rawEnd: Point,
): { end: Point; angle: number } {
  const dx = rawEnd.x - start.x
  const dy = rawEnd.y - start.y
  const len = Math.hypot(dx, dy)
  const rawAngle = angleOf(dx, dy)

  // 最寄りのスナップ候補角度を選ぶ
  let best = SNAP_CANDIDATES[0]
  let bestDiff = Infinity
  for (const cand of SNAP_CANDIDATES) {
    const diff = angleDiff(rawAngle, cand)
    if (diff < bestDiff) {
      bestDiff = diff
      best = cand
    }
  }

  const rad = best * DEG
  const end: Point = {
    x: start.x + Math.cos(rad) * len,
    y: start.y + Math.sin(rad) * len,
  }
  return { end, angle: best }
}

export interface GridLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * 指定角度(度)の平行線群を、w×h の領域を覆うように生成する。
 * 中心から前後に、direction 方向へ長く伸ばした線を perpendicular 方向に gap 間隔で並べる。
 */
function parallelLines(
  w: number,
  h: number,
  gap: number,
  angleDeg: number,
): GridLine[] {
  if (w <= 0 || h <= 0 || gap <= 0) return []
  const rad = angleDeg * DEG
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  // 線に垂直な方向（この方向へ gap 間隔でずらす）
  const nx = -uy
  const ny = ux
  const cx = w / 2
  const cy = h / 2
  const diag = Math.hypot(w, h)
  const count = Math.ceil(diag / gap)
  const lines: GridLine[] = []
  for (let k = -count; k <= count; k++) {
    const ox = cx + nx * k * gap
    const oy = cy + ny * k * gap
    lines.push({
      x1: ox - ux * diag,
      y1: oy - uy * diag,
      x2: ox + ux * diag,
      y2: oy + uy * diag,
    })
  }
  return lines
}

/**
 * アイソメ（等角投影）グリッドの線を生成する。
 * 30° と 150° の2方向の平行線群を重ねることで菱形（ひし形）パターンになる。
 * これらは配管のアイソメ角(30/150/210/330°)と一致し、描画時のガイドになる。
 */
export function isometricGrid(w: number, h: number, gap: number): GridLine[] {
  return [
    ...parallelLines(w, h, gap, 30),
    ...parallelLines(w, h, gap, 150),
  ]
}

/** 点 p から線分 a-b までの最短距離 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return distance(p, a)
  // p を線分上に射影したパラメータ t を 0〜1 にクランプ
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const proj: Point = { x: a.x + t * abx, y: a.y + t * aby }
  return distance(p, proj)
}

/**
 * 既存の端点（各セグメントの始点・終点）のうち、p に近いものへ吸着する。
 * threshold(px) 以内に候補が無ければ p をそのまま返す。
 * ルートを連続してつなげやすくするための補助。
 */
export function snapToEndpoints(
  p: Point,
  endpoints: Point[],
  threshold: number,
): Point {
  let best: Point | null = null
  let bestDist = threshold
  for (const ep of endpoints) {
    const d = distance(p, ep)
    if (d <= bestDist) {
      bestDist = d
      best = ep
    }
  }
  return best ?? p
}
