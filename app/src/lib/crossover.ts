import type { Point, Segment } from '../types'
import { distance } from './isometric'

// 2つの線分の交点（内部でのみ交わる場合）を返す。
// t は線分1上のパラメータ、u は線分2上のパラメータ（いずれも 0〜1）。
// 端点どうしの接続（t,u が 0/1 付近）は「またぎ」ではないので除外する。
function segmentIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): { t: number; u: number } | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-6) return null // 平行 or 重なり
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom
  const eps = 0.02 // 端点付近（接続点）は除外
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) return { t, u }
  return null
}

// 配管の向きを、アイソメ格子が持つ4方向(0/30/90/150、±180は同一視)のいずれかへ丸める。
const ANGLE_FAMILIES = [0, 30, 90, 150] as const
function angleFamily(dx: number, dy: number): number {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI
  deg = ((deg % 180) + 180) % 180
  let best: number = ANGLE_FAMILIES[0]
  let bestDiff = Infinity
  for (const f of ANGLE_FAMILIES) {
    const diff = Math.min(Math.abs(deg - f), 180 - Math.abs(deg - f))
    if (diff < bestDiff) {
      bestDiff = diff
      best = f
    }
  }
  return best
}

// 立て管（90°、垂直方向）は現場の作画慣習上、横引き・斜め管（0°/30°/150°）より
// 手前に見えるため、途切れずに通し線で描く。横引き・斜め管側が交差点で途切れる。
function frontPriority(seg: Segment): number {
  return angleFamily(seg.end.x - seg.start.x, seg.end.y - seg.start.y) === 90 ? 1 : 0
}

/**
 * 「またぎ」表示のために、各セグメント上で線を途切れさせるべき位置
 * （そのセグメント上のパラメータ t, 0〜1）を求める。
 *
 * ルール: データ上つながっていない（端点を共有しない）2線が視覚的に交差する場合、
 * 立て管（垂直方向）を通し線・横引き/斜め管を途切れとする（前後関係が同じ優先度
 * 同士のときのみ、後から作成された方＝配列で後ろにある方を途切れさせる）。
 * これは見た目だけの処理で、接続関係（parentId 等）には影響しない。
 */
export function computeCrossoverGaps(segments: Segment[]): Record<string, number[]> {
  const gaps: Record<string, number[]> = {}
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]
      const b = segments[j]
      const hit = segmentIntersection(a.start, a.end, b.start, b.end)
      if (!hit) continue
      const pa = frontPriority(a)
      const pb = frontPriority(b)
      // 優先度が高い方（立て管）を通し線に残し、低い方を途切れさせる。
      // 同優先度なら従来通り後から作成された方(b)を途切れさせる。
      if (pa > pb) {
        ;(gaps[b.id] ??= []).push(hit.u)
      } else if (pb > pa) {
        ;(gaps[a.id] ??= []).push(hit.t)
      } else {
        ;(gaps[b.id] ??= []).push(hit.u)
      }
    }
  }
  return gaps
}

/**
 * 始点〜終点の線を、指定パラメータ位置(centers)で gapPx だけ途切れさせた
 * 可視部分（複数の線片）に分割する。
 */
export function breakLine(
  start: Point,
  end: Point,
  centers: number[],
  gapPx: number,
): Array<{ a: Point; b: Point }> {
  const len = distance(start, end)
  const lerp = (t: number): Point => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  })
  if (!centers.length || len === 0) return [{ a: start, b: end }]

  const half = gapPx / 2 / len
  const intervals = centers
    .map((c) => [Math.max(0, c - half), Math.min(1, c + half)] as [number, number])
    .sort((p, q) => p[0] - q[0])

  const pieces: Array<{ a: Point; b: Point }> = []
  let cursor = 0
  for (const [g0, g1] of intervals) {
    if (g0 > cursor) pieces.push({ a: lerp(cursor), b: lerp(g0) })
    cursor = Math.max(cursor, g1)
  }
  if (cursor < 1) pieces.push({ a: lerp(cursor), b: lerp(1) })
  return pieces
}
