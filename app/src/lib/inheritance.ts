import type { Point, Segment } from '../types'
import { distanceToSegment, samePoint } from './isometric'

export type SegmentMap = Record<string, Segment>

export function buildSegmentMap(segments: Segment[]): SegmentMap {
  const m: SegmentMap = {}
  for (const s of segments) m[s.id] = s
  return m
}

// 親チェーンをたどり、pick が最初に値を返したところで返す（循環はガード）。
function walkUp(
  startId: string | undefined,
  byId: SegmentMap,
  pick: (s: Segment) => string | undefined,
): string | undefined {
  let cur = startId ? byId[startId] : undefined
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    const v = pick(cur)
    if (v != null && v !== '') return v
    cur = cur.parentId ? byId[cur.parentId] : undefined
  }
  return undefined
}

/** 親（上流）から継承される管種（自分自身は見ない） */
export function inheritedPipeType(seg: Segment, byId: SegmentMap) {
  return walkUp(seg.parentId, byId, (s) => s.pipeType)
}

/** 親（上流）から継承されるサイズ（自分自身は見ない） */
export function inheritedSize(seg: Segment, byId: SegmentMap) {
  return walkUp(seg.parentId, byId, (s) => s.size)
}

/** 実効管種 = 自分の値 or 継承値 */
export function effectivePipeType(seg: Segment, byId: SegmentMap) {
  return seg.pipeType ?? inheritedPipeType(seg, byId)
}

/** 実効サイズ = 自分の値 or 継承値 */
export function effectiveSize(seg: Segment, byId: SegmentMap) {
  return seg.size ?? inheritedSize(seg, byId)
}

export interface Effective {
  pipeType?: string
  size?: string
  /** サイズが自分自身で明示設定されているか（false は継承 or 未設定） */
  sizeOwn: boolean
  /** 実効サイズが（自分 or 継承で）決まっているか */
  resolved: boolean
  /**
   * サイズラベルを表示すべきか。
   * 「サイズが切り替わった地点」＝実効サイズが親（上流）の実効サイズと異なる場合のみ true。
   * 同一サイズが継承され続ける後続では false（表示を間引く）。データ自体は全保持。
   */
  showSizeLabel: boolean
  /** 実効継手（自分の値 or 自動デフォルト） */
  fitting: string
  /** 継手が自分自身で明示設定されているか（false は自動デフォルト） */
  fittingOwn: boolean
  /** 分岐（チーズが必要な）箇所か */
  isBranch: boolean
}

const nodeKey = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`

/**
 * 各ノード（端点位置）の「次数」を求める。
 * 次数 = その点に集まる端点の数 + 2×その点を内部で通過する線の数。
 * 直線チェーンの中間ノードは 2、分岐（T字）は 3 以上になる。
 */
function computeNodeDegrees(segments: Segment[]): Map<string, number> {
  const deg = new Map<string, number>()
  const nodes: Point[] = []
  const seen = new Set<string>()
  for (const s of segments) {
    for (const p of [s.start, s.end]) {
      const k = nodeKey(p)
      deg.set(k, (deg.get(k) ?? 0) + 1)
      if (!seen.has(k)) {
        seen.add(k)
        nodes.push(p)
      }
    }
  }
  // 内部通過（中間分岐 = 途中に他線の端点が乗る）を +2 でカウント
  for (const node of nodes) {
    for (const s of segments) {
      if (samePoint(node, s.start) || samePoint(node, s.end)) continue
      if (distanceToSegment(node, s.start, s.end) < 1.5) {
        const k = nodeKey(node)
        deg.set(k, (deg.get(k) ?? 0) + 2)
      }
    }
  }
  return deg
}

/** 全セグメントの実効属性をまとめて計算する */
export function computeEffective(segments: Segment[]): Record<string, Effective> {
  const byId = buildSegmentMap(segments)
  const degrees = computeNodeDegrees(segments)
  const out: Record<string, Effective> = {}
  for (const s of segments) {
    const size = effectiveSize(s, byId)
    const parent = s.parentId ? byId[s.parentId] : undefined
    const parentSize = parent ? effectiveSize(parent, byId) : undefined
    // 分岐: いずれかの端点が次数3以上のノード
    const isBranch =
      (degrees.get(nodeKey(s.start)) ?? 0) >= 3 ||
      (degrees.get(nodeKey(s.end)) ?? 0) >= 3
    const fittingOwn = s.fitting != null && s.fitting !== ''
    const fitting = fittingOwn
      ? (s.fitting as string)
      : isBranch
        ? 'tee_equal'
        : 'elbow90_short'
    out[s.id] = {
      pipeType: effectivePipeType(s, byId),
      size,
      sizeOwn: s.size != null && s.size !== '',
      resolved: size != null && size !== '',
      showSizeLabel: size != null && size !== '' && size !== parentSize,
      fitting,
      fittingOwn,
      isBranch,
    }
  }
  return out
}
