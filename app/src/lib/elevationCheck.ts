// 排水配管の「基準高さ」チェック。
// 配管ルートの両端(フリー端)に、任意の基準面(FL等)からの相対高さを入力しておくと、
// 実際に描いたルート(縦区間の芯々寸法・勾配による高低差)から計算した高低差と
// 一致しているかを確認できる。現場で「二段階に分けて配管を落としても、
// スタートとゴールの高さだけは絶対に変えられない」という制約を検算する指標。
import type { Point, Segment } from '../types'
import { samePoint } from './isometric'
import { elevationDrop } from './slope'

const NODE_EPS = 1
const round1 = (x: number) => Math.round(x * 10) / 10

interface Anchor {
  segId: string
  end: 'start' | 'end'
  point: Point
  elevation: number
}

function findAnchors(segments: Segment[]): Anchor[] {
  const anchors: Anchor[] = []
  for (const s of segments) {
    if (s.startRefElevation != null) {
      anchors.push({ segId: s.id, end: 'start', point: s.start, elevation: s.startRefElevation })
    }
    if (s.endRefElevation != null) {
      anchors.push({ segId: s.id, end: 'end', point: s.end, elevation: s.endRefElevation })
    }
  }
  return anchors
}

// セグメントを fromPoint 側から反対側へ通過するときの高低差(mm)。
// 上へ行くほど+、下へ行くほど-。縦区間(90°/270°)は芯々寸法そのもの、
// 勾配を設定した区間はその高低差ぶんを追加でマイナスする（勾配は常に
// 「今たどっている向き」に下るものとして扱う簡易モデル）。
function segmentElevationDelta(s: Segment, fromPoint: Point): number {
  const forward = samePoint(s.start, fromPoint, NODE_EPS)
  const length = s.centerLength ?? 0
  let base = 0
  if (s.angle === 90) base = -length
  else if (s.angle === 270) base = length
  if (s.slopeDenom) base -= elevationDrop(s.centerLength, s.slopeDenom)
  return forward ? base : -base
}

interface PathStep {
  seg: Segment
  fromPoint: Point
}

// 2点間の経路をたどる（配管は基本ツリー構造のため、単純なBFSで一意に求まる）。
function findPath(segments: Segment[], from: Point, to: Point): PathStep[] | null {
  if (samePoint(from, to, NODE_EPS)) return []
  const visited: Point[] = [from]
  const queue: { point: Point; path: PathStep[] }[] = [{ point: from, path: [] }]
  while (queue.length > 0) {
    const { point, path } = queue.shift()!
    for (const s of segments) {
      let nextPoint: Point | null = null
      if (samePoint(s.start, point, NODE_EPS)) nextPoint = s.end
      else if (samePoint(s.end, point, NODE_EPS)) nextPoint = s.start
      if (!nextPoint) continue
      if (visited.some((v) => samePoint(v, nextPoint!, NODE_EPS))) continue
      const nextPath = [...path, { seg: s, fromPoint: point }]
      if (samePoint(nextPoint, to, NODE_EPS)) return nextPath
      visited.push(nextPoint)
      queue.push({ point: nextPoint, path: nextPath })
    }
  }
  return null
}

export interface ElevationCheckResult {
  /** `${segId}:${end}` 形式のアンカーキー */
  fromKey: string
  toKey: string
  fromSegId: string
  toSegId: string
  /** 入力した基準高さどうしの差(ゴール - スタート) */
  expectedDelta: number
  /** 実際のルート(縦区間+勾配)から計算した高低差 */
  actualDelta: number
  /** actualDelta - expectedDelta。0ならルートが基準高さと矛盾しない。 */
  diff: number
  pathSegIds: string[]
}

/**
 * フリー端に基準高さが入力されている全ペアについて、実際のルートの高低差と
 * 入力値が一致するかを確認する。1組も基準高さが無ければ空配列。
 */
export function computeElevationChecks(segments: Segment[]): ElevationCheckResult[] {
  const anchors = findAnchors(segments)
  if (anchors.length < 2) return []
  const results: ElevationCheckResult[] = []
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i]
      const b = anchors[j]
      const path = findPath(segments, a.point, b.point)
      if (!path) continue
      let actualDelta = 0
      for (const step of path) actualDelta += segmentElevationDelta(step.seg, step.fromPoint)
      const expectedDelta = b.elevation - a.elevation
      results.push({
        fromKey: `${a.segId}:${a.end}`,
        toKey: `${b.segId}:${b.end}`,
        fromSegId: a.segId,
        toSegId: b.segId,
        expectedDelta: round1(expectedDelta),
        actualDelta: round1(actualDelta),
        diff: round1(actualDelta - expectedDelta),
        pathSegIds: path.map((p) => p.seg.id),
      })
    }
  }
  return results
}
