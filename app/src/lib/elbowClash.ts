import type { Segment } from '../types'
import type { CutResult } from './cutlength'
import { samePoint } from './isometric'

const NODE_EPS = 1

export type ElbowSuggestion = 'double45' | '90plus45'

export interface ElbowClash {
  /** 2つのエルボに挟まれた、芯々寸法が不足している区間 */
  midSegId: string
  /** 手前側の配管（提案適用時にこちらの継手を書き換える） */
  outerASegId: string
  /** 奥側の配管（提案適用時にこちらの継手を書き換える） */
  outerBSegId: string
  suggestion: ElbowSuggestion
}

// 配管の向きを、アイソメ格子が持つ4方向(0/30/90/150、±180は同一視)のいずれかへ丸める。
function angleFamily(dx: number, dy: number): number {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI
  deg = ((deg % 180) + 180) % 180
  const families = [0, 30, 90, 150]
  let best = families[0]
  let bestDiff = Infinity
  for (const f of families) {
    const diff = Math.min(Math.abs(deg - f), 180 - Math.abs(deg - f))
    if (diff < bestDiff) {
      bestDiff = diff
      best = f
    }
  }
  return best
}

// mid の指定端で、ノードを共有する唯一の相手セグメントを探す（分岐点は対象外）。
function findSoleNeighbor(
  segments: Segment[],
  mid: Segment,
  end: 'start' | 'end',
): Segment | undefined {
  const p = end === 'start' ? mid.start : mid.end
  const matches = segments.filter(
    (s) =>
      s.id !== mid.id &&
      (samePoint(s.start, p, NODE_EPS) || samePoint(s.end, p, NODE_EPS)),
  )
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * エルボtoエルボの区間で芯々寸法が足りず継手同士が収まらない箇所を検出する。
 * 現場では、この場合に90°エルボ2丁ではなく45°エルボ2丁、または90°+45°の
 * 組み合わせに振り分けて必要な芯々距離を短縮する（芯先の取り出し寸法が
 * 小さくなるため）。前後の配管の向きが同じ(平行→平行/オフセット)なら45°×2、
 * 向きが変わる(垂直⇄水平など)なら90°+45°を提案する。
 */
export function detectElbowClashes(
  segments: Segment[],
  cutById: Record<string, CutResult>,
): ElbowClash[] {
  const result: ElbowClash[] = []
  for (const mid of segments) {
    const c = cutById[mid.id]
    if (!c || c.status !== 'over') continue
    if (c.startRole !== 'elbow' || c.endRole !== 'elbow') continue
    const outerA = findSoleNeighbor(segments, mid, 'start')
    const outerB = findSoleNeighbor(segments, mid, 'end')
    if (!outerA || !outerB) continue
    const famA = angleFamily(outerA.end.x - outerA.start.x, outerA.end.y - outerA.start.y)
    const famB = angleFamily(outerB.end.x - outerB.start.x, outerB.end.y - outerB.start.y)
    const suggestion: ElbowSuggestion = famA === famB ? 'double45' : '90plus45'
    result.push({ midSegId: mid.id, outerASegId: outerA.id, outerBSegId: outerB.id, suggestion })
  }
  return result
}

/** 提案どおりに、前後の配管(outerA/outerB)の継手を書き換える。 */
export function applyElbowSuggestion(segments: Segment[], clash: ElbowClash): Segment[] {
  const fitA = clash.suggestion === 'double45' ? 'elbow45_long' : 'elbow90_long'
  const fitB = 'elbow45_long'
  return segments.map((s) => {
    if (s.id === clash.outerASegId) return { ...s, fitting: fitA }
    if (s.id === clash.outerBSegId) return { ...s, fitting: fitB }
    return s
  })
}
