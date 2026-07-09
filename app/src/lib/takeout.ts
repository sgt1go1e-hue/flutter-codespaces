import type { Point, Segment } from '../types'
import { samePoint, distanceToSegment, distance } from './isometric'
import {
  getFitting,
  nominalOf,
  reducerKey,
  type ReducerDim,
  type TeeDim,
} from '../data/masters'
// ノード同一判定の許容誤差(px)
const NODE_EPS = 1

// このファイルの関数は実効属性のうち size しか参照しないため、
// inheritance.ts の Effective 全体ではなくこの最小限の形で受け取る
// （inheritance.ts 側からも sizeのみのマップで安全に呼べるようにするため）。
export interface SizeInfo {
  size?: string
}

export type EndRole =
  | 'free' // 接続なし（芯出し基準）
  | 'straight' // 直管接続（同径・一直線）
  | 'elbow'
  | 'elbow-reducer' // エルボの直後に突き合わせ(継手直結)のレジューサーが続く場合、まとめて1つの取り出しとして扱う
  | 'reducer'
  | 'tee-run'
  | 'tee-run-reducer' // チーズ(ラン)直後にレジューサーで縮径（ツキ合わせ）
  | 'tee-branch'

export interface EndResult {
  role: EndRole
  /** 差し引く取り出し寸法(mm) */
  mm: number
  /** 参照した継手 id（表示用） */
  fittingId?: string
  /** elbow-reducer のとき、突き合わせレジューサーの相手径（BOM表示用） */
  reducerCounterpart?: string
}

interface Inc {
  seg: Segment
  end: 'start' | 'end'
  /** セグメント本体→ノードへ向かう単位ベクトル */
  into: Point
  size?: string
}
interface GNode {
  p: Point
  incs: Inc[]
  through: Segment[] // このノードを内部通過する線（中間分岐の本管）
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const isElbowId = (id?: string) =>
  id === 'elbow90_short' || id === 'elbow90_long' || id === 'elbow45_long'
const isTeeId = (id?: string) => id === 'tee_equal' || id === 'tee_reducing'
const isReducerId = (id?: string) =>
  id === 'reducer_concentric' || id === 'reducer_eccentric'

function buildGraph(
  segments: Segment[],
  effById: Record<string, SizeInfo>,
): GNode[] {
  const nodes: GNode[] = []
  const findOrAdd = (p: Point) => {
    let n = nodes.find((n) => samePoint(n.p, p, NODE_EPS))
    if (!n) {
      n = { p: { ...p }, incs: [], through: [] }
      nodes.push(n)
    }
    return n
  }
  for (const s of segments) {
    for (const end of ['start', 'end'] as const) {
      const p = end === 'start' ? s.start : s.end
      const other = end === 'start' ? s.end : s.start
      const len = distance(p, other) || 1
      const into = { x: (p.x - other.x) / len, y: (p.y - other.y) / len }
      findOrAdd(p).incs.push({ seg: s, end, into, size: effById[s.id]?.size })
    }
  }
  for (const n of nodes) {
    for (const s of segments) {
      if (samePoint(n.p, s.start, NODE_EPS) || samePoint(n.p, s.end, NODE_EPS)) continue
      if (distanceToSegment(n.p, s.start, s.end) < 1.5) n.through.push(s)
    }
  }
  return nodes
}

// エルボの取り出し寸法（自セグメントのサイズで）
function elbowTakeout(inc: Inc, nb?: Inc): number {
  const nomKey = String(nominalOf(inc.size) ?? '')
  const id = isElbowId(inc.seg.fitting)
    ? (inc.seg.fitting as string)
    : isElbowId(nb?.seg.fitting)
      ? (nb!.seg.fitting as string)
      : 'elbow90_long'
  const raw = getFitting(id)?.dims[nomKey]
  return typeof raw === 'number' ? raw : 0
}

// レジューサーの取り出し寸法（大径側=0/小径側=全長H。face 基準）
function reducerTakeout(inc: Inc, nb: Inc): { mm: number; id: string } {
  const a = nominalOf(inc.size)
  const b = nominalOf(nb.size)
  const id = isReducerId(inc.seg.fitting)
    ? (inc.seg.fitting as string)
    : isReducerId(nb.seg.fitting)
      ? (nb.seg.fitting as string)
      : 'reducer_concentric'
  if (a == null || b == null) return { mm: 0, id }
  const key = reducerKey(inc.size, nb.size)
  const dim = key ? (getFitting(id)?.dims[key] as ReducerDim | undefined) : undefined
  const H = dim?.H ?? 0
  const isLarge = a >= b
  return { mm: isLarge ? 0 : H, id }
}

// チーズの取り出し寸法（ラン/枝で C・M を出し分け）
function teeTakeout(
  runSize: string | undefined,
  branchSize: string | undefined,
  isRun: boolean,
): { mm: number; id: string } {
  const runN = nominalOf(runSize)
  const brN = nominalOf(branchSize)
  const reducing = runN != null && brN != null && runN !== brN
  const id = reducing ? 'tee_reducing' : 'tee_equal'
  let dim: TeeDim | undefined
  if (reducing) {
    dim = getFitting('tee_reducing')?.dims[`${runN}_${brN}`] as TeeDim | undefined
  } else {
    dim = getFitting('tee_equal')?.dims[String(runN ?? '')] as TeeDim | undefined
  }
  if (!dim) return { mm: 0, id }
  return { mm: isRun ? dim.run : dim.branch, id }
}

// ノードの本管(run)軸のサイズ。貫通線・同一直線ペアのうち最大径を本管ヘッダ径とする。
// （途中でレジューサーにより縮径していても、チーズ本体の呼びは大径側で決まるため）
function runAxisSize(
  node: GNode,
  effById: Record<string, SizeInfo>,
): string | undefined {
  const candidates: (string | undefined)[] = []
  for (const t of node.through) candidates.push(effById[t.id]?.size)
  for (let i = 0; i < node.incs.length; i++) {
    for (let j = i + 1; j < node.incs.length; j++) {
      if (dot(node.incs[i].into, node.incs[j].into) < -0.9) {
        candidates.push(node.incs[i].size, node.incs[j].size)
      }
    }
  }
  let best: string | undefined
  let bestN = -1
  for (const c of candidates) {
    const n = nominalOf(c)
    if (n != null && n > bestN) {
      bestN = n
      best = c
    }
  }
  return best
}

// 同心レジューサーの全長 H（大径→小径の縮径分）。本管軸上で径が変わる継手接続に足す。
function reducerHmm(large?: string, small?: string): number {
  const key = reducerKey(large, small)
  const dim = key
    ? (getFitting('reducer_concentric')?.dims[key] as ReducerDim | undefined)
    : undefined
  return dim?.H ?? 0
}

function resolveEnd(
  inc: Inc,
  node: GNode,
  effById: Record<string, SizeInfo>,
): EndResult {
  const others = node.incs.filter((i) => i.seg.id !== inc.seg.id)
  const throughs = node.through.filter((t) => t.id !== inc.seg.id)
  const degree = node.incs.length + 2 * throughs.length

  if (others.length === 0 && throughs.length === 0) {
    return { role: 'free', mm: 0 }
  }

  // 分岐（3方向以上、または本管の途中に接続＝中間分岐）
  if (degree >= 3) {
    // このセグメントが本管(run)方向か？（反対向きの端点隣接、または本管通過に平行）
    const opposite = others.find((o) => dot(inc.into, o.into) < -0.9)
    let throughParallel = false
    if (throughs.length > 0) {
      const t = throughs[0]
      const tlen = distance(t.start, t.end) || 1
      const tdir = { x: (t.end.x - t.start.x) / tlen, y: (t.end.y - t.start.y) / tlen }
      throughParallel = Math.abs(dot(inc.into, tdir)) > 0.9
    }
    const isRun = Boolean(opposite) || throughParallel
    // 本管軸のヘッダ径（最大径）。枝側は自分のサイズ。
    // 「メイン管サイズ／枝管サイズ」欄で実サイズを直接編集する方式にしたため、
    // ここは常に実際のジオメトリ(隣接セグメントの実サイズ)から求める。
    const runSize = runAxisSize(node, effById) ?? inc.size
    const branchInc = others.find((o) => Math.abs(dot(inc.into, o.into)) < 0.9)
    const branchSize = isRun ? (branchInc?.size ?? inc.size) : inc.size
    const t = teeTakeout(runSize, branchSize, isRun)
    let mm = t.mm
    let role: EndRole = isRun ? 'tee-run' : 'tee-branch'
    // 本管(run)アームが本管ヘッダ径より小さい＝チーズ直後にレジューサーで縮径
    // （ツキ合わせ／パイプ0mmでチーズと直結）。tee-run 取り出しにレジューサー分を加算。
    if (isRun) {
      const rn = nominalOf(runSize)
      const an = nominalOf(inc.size)
      if (rn != null && an != null && an < rn) {
        mm += reducerHmm(runSize, inc.size)
        role = 'tee-run-reducer'
      }
    }
    return { role, mm, fittingId: t.id }
  }

  // 次数2：端点隣接1本
  const nb = others[0]
  if (!nb) return { role: 'free', mm: 0 }
  const straight = dot(inc.into, nb.into) < -0.9
  if (straight) {
    const a = nominalOf(inc.size)
    const b = nominalOf(nb.size)
    if (a != null && b != null && a !== b) {
      const r = reducerTakeout(inc, nb)
      return { role: 'reducer', mm: r.mm, fittingId: r.id }
    }
    return { role: 'straight', mm: 0 }
  }
  const elbowFittingId = isElbowId(inc.seg.fitting)
    ? (inc.seg.fitting as string)
    : isElbowId(nb.seg.fitting)
      ? (nb.seg.fitting as string)
      : 'elbow90_long'
  return { role: 'elbow', mm: elbowTakeout(inc, nb), fittingId: elbowFittingId }
}

export interface SegEnds {
  start: EndResult
  end: EndResult
}

/** 全セグメントの端ごとの取り出し寸法を計算 */
export function computeEnds(
  segments: Segment[],
  effById: Record<string, SizeInfo>,
): Record<string, SegEnds> {
  const nodes = buildGraph(segments, effById)
  const nodeAt = (p: Point) => nodes.find((n) => samePoint(n.p, p, NODE_EPS))!
  const out: Record<string, SegEnds> = {}
  for (const s of segments) {
    const startNode = nodeAt(s.start)
    const endNode = nodeAt(s.end)
    const startInc = startNode.incs.find((i) => i.seg.id === s.id && i.end === 'start')!
    const endInc = endNode.incs.find((i) => i.seg.id === s.id && i.end === 'end')!
    out[s.id] = {
      start: resolveEnd(startInc, startNode, effById),
      end: resolveEnd(endInc, endNode, effById),
    }
  }

  // 突き合わせ(継手直結のまま)のレジューサーがエルボの直後に続く場合、現場の
  // 考え方（突き合わせレジューサーは隣の異形パイプの一部）に合わせて、その先の
  // 取り出し寸法もまとめてエルボ側の取り出し寸法へ折り込む。レジューサー側に
  // 実際にパイプを足していれば(芯々寸法が突き合わせ既定値より大きい)折り込まない。
  // レジューサー分割で生じる寸法もサイズも持たない極小の中間区間(透過区間)を
  // 挟んでいる場合は、そこを透過してレジューサーまでたどる。
  const isPhantomSeg = (seg: Segment) =>
    !seg.size && !seg.fitting && seg.centerLength == null

  // 折り込んだ経路上の端は、BOM 集計で二重計上されないよう別途 'straight'
  // へ差し替える（切り寸法計算に使う mm 値はここでは変えない。抑制のみ最後に適用）。
  const suppressed = new Set<string>()

  for (const s of segments) {
    for (const end of ['start', 'end'] as const) {
      const result = out[s.id][end]
      if (result.role !== 'elbow') continue
      const p = end === 'start' ? s.start : s.end
      const node = nodeAt(p)
      let nb = node.incs.find((i) => i.seg.id !== s.id)
      const visited = new Set<string>([s.id])
      const path: string[] = []
      let found: Inc | undefined
      while (nb) {
        if (visited.has(nb.seg.id)) break
        visited.add(nb.seg.id)
        // このセグメントにレジューサーの継手が付いていても、今たどり着いた側の
        // 端が実際にサイズの変わる直線接続(role:'reducer')でなければ、単なる
        // 反対側のエルボ(同径)なので折り込み対象にしない。
        if (out[nb.seg.id]?.[nb.end]?.role === 'reducer') {
          found = nb
          path.push(`${nb.seg.id}:${nb.end}`)
          break
        }
        if (!isPhantomSeg(nb.seg)) break
        // 透過区間自体は継手を持たないため、両端ともBOMでは対象外にする
        path.push(`${nb.seg.id}:start`, `${nb.seg.id}:end`)
        const farEnd = nb.end === 'start' ? 'end' : 'start'
        const farPoint = farEnd === 'start' ? nb.seg.start : nb.seg.end
        const farNode = nodeAt(farPoint)
        const farOthers = farNode.incs.filter((i) => i.seg.id !== nb!.seg.id)
        nb = farOthers.length === 1 ? farOthers[0] : undefined
      }
      if (!found) continue
      const nbEnds = out[found.seg.id]
      if (!nbEnds) continue
      const nbOwnMm = nbEnds.start.mm + nbEnds.end.mm
      const nbCenter = found.seg.centerLength
      const stillDefault = nbCenter == null || Math.abs(nbCenter - nbOwnMm) < 0.6
      if (!stillDefault) continue
      out[s.id][end] = {
        ...result,
        role: 'elbow-reducer',
        mm: result.mm + nbOwnMm,
        reducerCounterpart: found.size,
      }
      for (const key of path) suppressed.add(key)
    }
  }

  for (const key of suppressed) {
    const sep = key.lastIndexOf(':')
    const segId = key.slice(0, sep)
    const end = key.slice(sep + 1) as 'start' | 'end'
    if (out[segId]?.[end]) {
      out[segId][end] = { ...out[segId][end], role: 'straight' }
    }
  }

  // エルボtoエルボの短い「オフセットのキック」区間（45°等でオフセットを取るための
  // 短い連結配管）を、隣接する長い区間の芯先/芯々計算へ自動的に畳み込む。
  // 現場では「1000」等の寸法を手前の基準点（本来1本エルボだった位置）から
  // 先端まで測るため、途中に挟まる短いキック区間の全長も先端側の取り出し
  // 寸法へ合算しないと、切り寸が実際より長く出てしまう。
  // キック区間自体が単体で継手が収まらない（=独立した配管として成立していない）
  // ときだけ畳み込む。十分な長さがあり単独で有効な配管として成立している
  // 場合は、意図的な独立区間の可能性があるため畳み込まない。
  for (const s of segments) {
    for (const end of ['start', 'end'] as const) {
      const result = out[s.id][end]
      if (result.role !== 'elbow') continue
      const p = end === 'start' ? s.start : s.end
      const node = nodeAt(p)
      const nb = node.incs.find((i) => i.seg.id !== s.id)
      if (!nb || nb.seg.centerLength == null) continue
      const nbEnds = out[nb.seg.id]
      if (!nbEnds) continue
      const nbOtherEnd = nb.end === 'start' ? 'end' : 'start'
      if (nbEnds[nb.end].role !== 'elbow' || nbEnds[nbOtherEnd].role !== 'elbow') continue
      const nbTakeoutSum = nbEnds.start.mm + nbEnds.end.mm
      if (nb.seg.centerLength - nbTakeoutSum >= -0.5) continue
      out[s.id][end] = { ...result, mm: result.mm + nb.seg.centerLength }
    }
  }

  return out
}

/** 分岐(チーズ)の「メイン管／枝管」情報。パネルでの直接編集用。 */
export interface TeeContext {
  /** 選択中セグメント自身がメイン管(本管)側か（false なら枝管側） */
  selectedIsMain: boolean
  /** メイン管を構成するセグメントid（貫通なら1つ、端点2本構成なら2つ） */
  mainSegIds: string[]
  /** メイン管の実効サイズ（未確定なら undefined） */
  mainSize?: string
  /** 枝管セグメントのid */
  branchSegId?: string
  /** 枝管の実効サイズ */
  branchSize?: string
}

/**
 * 指定セグメントが分岐(チーズ)ノードに接続していれば、その「メイン管／枝管」の
 * 構成セグメントとサイズを返す。両端とも分岐でなければ undefined。
 * パネルで「メイン管サイズ／枝管サイズ」を直接編集できるようにするための情報源。
 */
export function findTeeContext(
  segments: Segment[],
  effById: Record<string, SizeInfo>,
  segmentId: string,
): TeeContext | undefined {
  const nodes = buildGraph(segments, effById)
  const seg = segments.find((s) => s.id === segmentId)
  if (!seg) return undefined

  for (const end of ['start', 'end'] as const) {
    const p = end === 'start' ? seg.start : seg.end
    const node = nodes.find((n) => samePoint(n.p, p, NODE_EPS))
    if (!node) continue
    const inc = node.incs.find((i) => i.seg.id === segmentId && i.end === end)
    if (!inc) continue
    const others = node.incs.filter((i) => i.seg.id !== segmentId)
    const throughs = node.through.filter((t) => t.id !== segmentId)
    const degree = node.incs.length + 2 * throughs.length
    if (degree < 3) continue

    const opposite = others.find((o) => dot(inc.into, o.into) < -0.9)
    const throughSeg = throughs[0]
    let throughParallel = false
    if (throughSeg) {
      const tlen = distance(throughSeg.start, throughSeg.end) || 1
      const tdir = {
        x: (throughSeg.end.x - throughSeg.start.x) / tlen,
        y: (throughSeg.end.y - throughSeg.start.y) / tlen,
      }
      throughParallel = Math.abs(dot(inc.into, tdir)) > 0.9
    }
    // 自分(inc)が本管方向か＝自分と正反対のincがある、または貫通線と平行
    const selectedIsMain = Boolean(opposite) || throughParallel

    const mainSegIds = new Set<string>()
    let branchSegId: string | undefined
    let branchSize: string | undefined

    if (selectedIsMain) {
      // 自分がメイン管側 → 自分 + 自分と正反対のセグメント(+貫通線)がメイン管
      mainSegIds.add(segmentId)
      if (opposite) mainSegIds.add(opposite.seg.id)
      if (throughSeg) mainSegIds.add(throughSeg.id)
      const branchInc = others.find((o) => Math.abs(dot(inc.into, o.into)) < 0.9)
      branchSegId = branchInc?.seg.id
      branchSize = branchInc?.size
    } else {
      // 自分が枝管側 → 自分以外(others)の中から、互いに正反対のペア(または貫通線)を
      // 総当たりで探す（「自分から見て反対」ではなく、他のセグメント同士の関係を見る）。
      if (throughSeg) {
        mainSegIds.add(throughSeg.id)
      } else {
        outer: for (let i = 0; i < others.length; i++) {
          for (let j = i + 1; j < others.length; j++) {
            if (dot(others[i].into, others[j].into) < -0.9) {
              mainSegIds.add(others[i].seg.id)
              mainSegIds.add(others[j].seg.id)
              break outer
            }
          }
        }
      }
      branchSegId = segmentId
      branchSize = inc.size
    }

    return {
      selectedIsMain,
      mainSegIds: [...mainSegIds],
      mainSize: runAxisSize(node, effById),
      branchSegId,
      branchSize,
    }
  }
  return undefined
}

export { isTeeId }
