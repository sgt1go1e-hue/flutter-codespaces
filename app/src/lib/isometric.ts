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

// 菱形グリッドを構成する2方向（30° / 150°）の単位法線ベクトル。
// 原点(0,0)を基準に、各線は p·n = k*gap（k は整数）上に並ぶ。
// このため格子（交点）も原点基準で定義でき、キャンバスサイズに依らず安定する。
const N_A = { x: -Math.sin(30 * DEG), y: Math.cos(30 * DEG) } // 30°線の法線
const N_B = { x: -Math.sin(150 * DEG), y: Math.cos(150 * DEG) } // 150°線の法線

/**
 * 指定角度(度)の平行線群を、原点(0,0)基準で w×h の領域を覆うように生成する。
 * 各線は p·n = k*gap 上に並ぶので、格子スナップ(snapToLattice)と必ず一致する。
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
  const nx = -uy // 線に垂直な方向（単位ベクトル）
  const ny = ux
  // ビューポート四隅での p·n の範囲から、必要な k の範囲を求める
  const corners = [
    0,
    w * nx,
    h * ny,
    w * nx + h * ny,
  ]
  const cmin = Math.min(...corners)
  const cmax = Math.max(...corners)
  const diag = Math.hypot(w, h)
  const lines: GridLine[] = []
  for (let k = Math.floor(cmin / gap); k <= Math.ceil(cmax / gap); k++) {
    const c = k * gap
    // 線 p·n = c 上の基準点（法線方向に c だけ進んだ点）
    const px = nx * c
    const py = ny * c
    lines.push({
      x1: px - ux * diag,
      y1: py - uy * diag,
      x2: px + ux * diag,
      y2: py + uy * diag,
    })
  }
  return lines
}

/**
 * アイソメ（等角投影）グリッドの線を生成する。
 * 30° と 150° の2方向の平行線群を重ねることで菱形（ひし形）パターンになる。
 */
export function isometricGrid(w: number, h: number, gap: number): GridLine[] {
  return [
    ...parallelLines(w, h, gap, 30),
    ...parallelLines(w, h, gap, 150),
  ]
}

/**
 * 任意の点を、最寄りのアイソメ格子交点（グリッド線の交点）へスナップする。
 * 30°線群と150°線群の交点で構成される格子の格子点を返す。
 */
export function snapToLattice(p: Point, gap: number): Point {
  const i = Math.round((p.x * N_A.x + p.y * N_A.y) / gap)
  const j = Math.round((p.x * N_B.x + p.y * N_B.y) / gap)
  const A = i * gap
  const B = j * gap
  // 連立 p·N_A = A, p·N_B = B を解いた閉形式（N_A,N_B は上記の単位法線）
  return { x: -(A + B), y: (A - B) / Math.sqrt(3) }
}

/**
 * 指定アイソメ角度に沿って隣り合う格子点どうしの距離(px)。
 * 0°/180°(水平)は 2*gap、それ以外(30/90/150…)は 2*gap/√3。
 */
export function latticeStep(angleDeg: number, gap: number): number {
  const a = ((angleDeg % 180) + 180) % 180
  return a === 0 ? 2 * gap : (2 * gap) / Math.sqrt(3)
}

/**
 * フリーハンドの始点・終点を、
 *  1) 始点を最寄り格子点へスナップ
 *  2) 向きを最寄りのアイソメ角へスナップ
 *  3) その方向で最寄り格子点に乗る長さ（格子ステップの整数倍）に終点をスナップ
 * することで、必ず「交点から交点へ・アイソメ角に沿った」セグメントに整える。
 */
export function snapSegmentToGrid(
  rawStart: Point,
  rawEnd: Point,
  gap: number,
): { start: Point; end: Point; angle: number } {
  const start = snapToLattice(rawStart, gap)
  return { start, ...snapEndFromStart(start, rawEnd, gap) }
}

/**
 * 始点（すでに格子点）を固定し、終点だけをアイソメ角＋格子点にスナップする。
 * 分岐など、始点を別ロジックで決めたい場合に使う。
 */
export function snapEndFromStart(
  start: Point,
  rawEnd: Point,
  gap: number,
): { end: Point; angle: number } {
  const dx = rawEnd.x - start.x
  const dy = rawEnd.y - start.y
  const rawAngle = angleOf(dx, dy)

  let angle = SNAP_CANDIDATES[0]
  let bestDiff = Infinity
  for (const cand of SNAP_CANDIDATES) {
    const diff = angleDiff(rawAngle, cand)
    if (diff < bestDiff) {
      bestDiff = diff
      angle = cand
    }
  }

  const rad = angle * DEG
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const projLen = dx * ux + dy * uy
  const step = latticeStep(angle, gap)
  const k = Math.max(1, Math.round(projLen / step))
  const end: Point = { x: start.x + ux * step * k, y: start.y + uy * step * k }
  return { end, angle }
}

/** 2点がほぼ同一か（格子スナップ済みなので誤差は極小） */
export function samePoint(a: Point, b: Point, eps = 1): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
}

/** 点 p を線分 a-b 上へ射影した点とパラメータ t（0〜1にクランプ） */
export function projectOnSegment(
  p: Point,
  a: Point,
  b: Point,
): { point: Point; t: number } {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return { point: { ...a }, t: 0 }
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  return { point: { x: a.x + t * abx, y: a.y + t * aby }, t }
}

/** 点 p から線分 a-b までの最短距離 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const { point } = projectOnSegment(p, a, b)
  return distance(p, point)
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
