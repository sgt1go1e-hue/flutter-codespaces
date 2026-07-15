import type { Point, Segment } from '../types'
import { distanceToSegment, samePoint } from './isometric'
import { findTeeContext } from './takeout'

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

/** 実効管種 = 自分の値 or 継承値 */
export function effectivePipeType(seg: Segment, byId: SegmentMap) {
  return seg.pipeType ?? inheritedPipeType(seg, byId)
}

const isReducerId = (id?: string) =>
  id === 'reducer_concentric' ||
  id === 'reducer_eccentric' ||
  id === 'reducer_socket' ||
  id === 'reducer_thread' ||
  id === 'bushing_thread'

/**
 * そのセグメントが下流(子)へ渡すサイズ。
 * レジューサー継手を持つ場合、下流は小径側（自分のサイズと相手径のうち小さい方）になる。
 * これにより「レジューサーでサイズを落とすと下流も縮小したサイズを継承する」。
 */
function outputSize(
  seg: Segment,
  byId: SegmentMap,
  seen: Set<string>,
): string | undefined {
  const base = effectiveSizeInner(seg, byId, seen)
  if (base && isReducerId(seg.fitting) && seg.reducerSize) {
    const a = nomA(base)
    const b = nomA(seg.reducerSize)
    if (a != null && b != null) return a <= b ? base : seg.reducerSize
  }
  return base
}

function effectiveSizeInner(
  seg: Segment,
  byId: SegmentMap,
  seen: Set<string>,
): string | undefined {
  if (seg.size) return seg.size
  if (!seg.parentId || seen.has(seg.id)) return undefined
  seen.add(seg.id)
  const parent = byId[seg.parentId]
  if (!parent) return undefined
  return outputSize(parent, byId, seen)
}

/** 実効サイズ = 自分の値 or 親の「下流へ渡すサイズ」（レジューサーで縮小反映） */
export function effectiveSize(seg: Segment, byId: SegmentMap) {
  return effectiveSizeInner(seg, byId, new Set())
}

/** 親（上流）から継承されるサイズ（自分自身は見ない） */
export function inheritedSize(seg: Segment, byId: SegmentMap) {
  if (!seg.parentId) return undefined
  const parent = byId[seg.parentId]
  if (!parent) return undefined
  return outputSize(parent, byId, new Set())
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

const nomA = (code?: string): number | null => {
  const m = /^(\d+)A$/.exec(code ?? '')
  return m ? Number(m[1]) : null
}

/**
 * レジューサーの「大径側が始点(start)側か」を判定する。
 * 上流(大径)→下流(小径)の向きをシンボル描画に使う。
 * 径の異なる隣接セグメントがどちらの端に接続しているかと、その径から決める。
 */
export function reducerLargeAtStart(
  seg: Segment,
  segments: Segment[],
  effectiveById: Record<string, { size?: string }>,
  counterpartSize?: string,
): boolean {
  const segN = nomA(effectiveById[seg.id]?.size)
  let cpEnd: 'start' | 'end' | undefined
  let cpN: number | null = null
  for (const n of segments) {
    if (n.id === seg.id) continue
    const nn = nomA(effectiveById[n.id]?.size)
    if (nn == null || nn === segN) continue
    if (samePoint(n.start, seg.start) || samePoint(n.end, seg.start) ||
        distanceToSegment(seg.start, n.start, n.end) < 1.5) {
      cpEnd = 'start'; cpN = nn; break
    }
    if (samePoint(n.start, seg.end) || samePoint(n.end, seg.end) ||
        distanceToSegment(seg.end, n.start, n.end) < 1.5) {
      cpEnd = 'end'; cpN = nn; break
    }
  }
  if (segN == null || cpN == null || !cpEnd) {
    // 幾何が取れない場合は手動相手径から推定（不明なら大径を始点側に）
    const mn = nomA(counterpartSize)
    if (segN != null && mn != null) return mn < segN
    return true
  }
  const other = cpEnd === 'start' ? 'end' : 'start'
  const largeEnd = cpN > segN ? cpEnd : other
  return largeEnd === 'start'
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
  // サイズだけ先に全セグメント分求めておく（分岐の同径/異径判定に使うため）。
  const sizeById: Record<string, { size?: string }> = {}
  for (const s of segments) sizeById[s.id] = { size: effectiveSize(s, byId) }

  const out: Record<string, Effective> = {}
  for (const s of segments) {
    const size = sizeById[s.id].size
    const parent = s.parentId ? byId[s.parentId] : undefined
    const parentSize = parent ? sizeById[parent.id]?.size : undefined
    // 分岐: いずれかの端点が次数3以上のノード
    const isBranch = degreeAt(s.start) >= 3 || degreeAt(s.end) >= 3
    const fittingOwn = s.fitting != null && s.fitting !== ''
    let fitting: string
    // 接続方法が「差込（ソケット）」「ねじ込み」のとき、継手未指定(自動)の既定値も
    // 突き合わせ溶接ではなく差込式/ねじ込み式の継手を選ぶ（接続方法だけ変えても
    // 継手が突き合わせ溶接のままになってしまう不具合の修正）。
    const socket = s.connection === 'socket'
    const thread = s.connection === 'thread'
    // 塩ビ(VP)は接続方法を差込のみで固定し、選ばせる必要がないため管種で判定する。
    const vp = effectivePipeType(s, byId) === 'vp'
    if (fittingOwn) {
      fitting = s.fitting as string
    } else if (isBranch) {
      // メイン管／枝管の実サイズが異なれば「径違いチーズ」、同じなら「同径チーズ」を自動選択。
      const tee = findTeeContext(segments, sizeById, s.id)
      const mainN = nomA(tee?.mainSize)
      const branchN = nomA(tee?.branchSize)
      const reducing = mainN != null && branchN != null && mainN !== branchN
      fitting = reducing
        ? socket
          ? 'tee_reducing_socket'
          : thread
            ? 'tee_reducing_thread'
            : 'tee_reducing'
        : socket
          ? 'tee_equal_socket'
          : thread
            ? 'tee_equal_thread'
            : 'tee_equal'
    } else {
      fitting = vp
        ? 'elbow90_vp'
        : socket
          ? 'elbow90_socket'
          : thread
            ? 'elbow90_thread'
            : 'elbow90_long'
    }
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
