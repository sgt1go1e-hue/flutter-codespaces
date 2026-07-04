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

/**
 * レジューサー/径違いチーズの「相手径」を、接続している隣接セグメントの
 * 実効サイズから自動判定する。自分と径が異なる隣接管のサイズを採用。
 * （手動指定 seg.reducerSize があればそちらを優先する想定で、ここは自動値のみ返す）
 */
export function reducerCounterpart(
  seg: Segment,
  segments: Segment[],
  effectiveById: Record<string, { size?: string }>,
): string | undefined {
  const segSize = effectiveById[seg.id]?.size
  const isNeighbor = (n: Segment) =>
    n.id !== seg.id &&
    (samePoint(n.start, seg.start) ||
      samePoint(n.start, seg.end) ||
      samePoint(n.end, seg.start) ||
      samePoint(n.end, seg.end) ||
      n.id === seg.parentId ||
      n.parentId === seg.id)
  for (const n of segments) {
    if (!isNeighbor(n)) continue
    const ns = effectiveById[n.id]?.size
    if (ns && ns !== segSize) return ns
  }
  return undefined
}

/**
 * セグメントの始点側・終点側それぞれが、他セグメントに接続しているかを判定する。
 * 接続あり＝他セグメントの端点が一致、またはその端点が他セグメント上（中間分岐）にある。
 * 接続なし（フリー端）＝ルートの起点や、まだ何も繋がっていない末端。
 */
export function endConnections(
  seg: Segment,
  segments: Segment[],
): { start: boolean; end: boolean } {
  const touches = (pt: Point) =>
    segments.some(
      (n) =>
        n.id !== seg.id &&
        (samePoint(pt, n.start) ||
          samePoint(pt, n.end) ||
          distanceToSegment(pt, n.start, n.end) < 1.5),
    )
  return { start: touches(seg.start), end: touches(seg.end) }
}

// ノード同一判定の許容誤差(px)。グリッドスナップの浮動小数点誤差を吸収する。
const NODE_EPS = 1

interface NodeCluster {
  p: Point
  endpoints: number
  interior: number
}

/**
 * ノードの「次数」を許容誤差付きで求める。
 * 端点は EPS 以内なら同一ノードとしてクラスタリングし、
 * 次数 = そのノードに集まる端点の数 + 2×そのノードを内部で通過する線の数。
 * 直線チェーンの中間ノードは 2、分岐（3方向以上）は 3 以上になる。
 * 返り値は「点 → 次数」を許容誤差で引く関数。
 */
function buildDegreeLookup(segments: Segment[]): (p: Point) => number {
  const clusters: NodeCluster[] = []
  const find = (p: Point) =>
    clusters.find((c) => samePoint(c.p, p, NODE_EPS))

  // 端点をクラスタリングして数える
  for (const s of segments) {
    for (const pt of [s.start, s.end]) {
      const c = find(pt)
      if (c) c.endpoints += 1
      else clusters.push({ p: { ...pt }, endpoints: 1, interior: 0 })
    }
  }
  // 中間通過（他線の途中にノードが乗る＝中間分岐）を +2 でカウント
  for (const c of clusters) {
    for (const s of segments) {
      if (samePoint(c.p, s.start, NODE_EPS) || samePoint(c.p, s.end, NODE_EPS)) continue
      if (distanceToSegment(c.p, s.start, s.end) < 1.5) c.interior += 1
    }
  }
  return (p: Point) => {
    const c = find(p)
    return c ? c.endpoints + 2 * c.interior : 0
  }
}

/** 全セグメントの実効属性をまとめて計算する */
export function computeEffective(segments: Segment[]): Record<string, Effective> {
  const byId = buildSegmentMap(segments)
  const degreeAt = buildDegreeLookup(segments)
  const out: Record<string, Effective> = {}
  for (const s of segments) {
    const size = effectiveSize(s, byId)
    const parent = s.parentId ? byId[s.parentId] : undefined
    const parentSize = parent ? effectiveSize(parent, byId) : undefined
    // 分岐: いずれかの端点が次数3以上のノード
    const isBranch = degreeAt(s.start) >= 3 || degreeAt(s.end) >= 3
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
