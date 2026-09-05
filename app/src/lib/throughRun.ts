import type { Point, Segment } from '../types'
import { samePoint } from './isometric'
import type { CutResult } from './cutlength'

// 「通り」= 曲がるまで一直線に続く区間のまとまり。
// チーズ・フランジ・レジューサーで区間が分かれていても、向きが変わらなければ
// 1本の通りとして扱う（エルボで区切る）。
//
// これを2つの用途で使う:
//  1. 通り寸法の表示（L—T—L のとき、L—T と T—L に加えて通しの L—L も出す）
//  2. 「全長基準」の寸法入力（全長を1つ入れ、残り1区間だけ空にしておくと、
//     その区間を全長から自動算出する）。区間をチーズやフランジで更に分けても
//     通り全体の全長は変わらないため、分割しても全長を持ち越せる。
// どちらも表示・入力補助のためのもので、切り寸法やBOMの計算そのものには
// 関与しない。

export interface RunGroup {
  /** 上流から順に並んだ構成区間 */
  members: Segment[]
  /** 通り全体の始点・終点(両端の自由端) */
  start: Point
  end: Point
}

export interface ThroughRun {
  ids: string[]
  start: Point
  end: Point
  /** 構成区間の芯々の合計。1つでも未入力なら undefined */
  total?: number
}

/** 向きを「軸」として正規化する（180°反転しても同じ軸とみなすため）。 */
function axisOf(s: Segment): { x: number; y: number } {
  const dx = s.end.x - s.start.x
  const dy = s.end.y - s.start.y
  const len = Math.hypot(dx, dy) || 1
  let ux = dx / len
  let uy = dy / len
  if (ux < -1e-6 || (Math.abs(ux) <= 1e-6 && uy < 0)) {
    ux = -ux
    uy = -uy
  }
  return { x: ux, y: uy }
}

function sameAxis(a: Segment, b: Segment): boolean {
  const p = axisOf(a)
  const q = axisOf(b)
  return Math.abs(p.x - q.x) < 1e-3 && Math.abs(p.y - q.y) < 1e-3
}

/** 点 pt で s と一直線に続く区間を探す（無ければ undefined）。 */
function collinearNeighborAt(
  s: Segment,
  pt: Point,
  segments: Segment[],
  used: Set<string>,
): Segment | undefined {
  const hits = segments.filter(
    (x) =>
      x.id !== s.id &&
      !used.has(x.id) &&
      (samePoint(x.start, pt) || samePoint(x.end, pt)) &&
      sameAxis(x, s),
  )
  // 一直線に続く相手はノードにつき1本のはず。複数あれば曖昧なので繋がない
  // (チーズの枝は向きが違うのでここには入ってこない)。
  return hits.length === 1 ? hits[0] : undefined
}

/**
 * 曲がるまで一直線に続く区間のまとまりを返す（形だけで判定し、計算結果には
 * 依存しない）。寸法の自動算出(cutlength.ts)からも使うため独立させてある。
 * 1本だけの通りも含む。
 */
export function groupRuns(segments: Segment[]): RunGroup[] {
  const used = new Set<string>()
  const groups: RunGroup[] = []

  for (const seed of segments) {
    if (used.has(seed.id)) continue
    used.add(seed.id)
    const chain: Segment[] = [seed]

    // seed の始点側へ遡る
    let head = seed
    let headPt = seed.start
    for (let guard = 0; guard < 200; guard++) {
      const nb = collinearNeighborAt(head, headPt, segments, used)
      if (!nb) break
      used.add(nb.id)
      chain.unshift(nb)
      headPt = samePoint(nb.start, headPt) ? nb.end : nb.start
      head = nb
    }
    // seed の終点側へ辿る
    let tail = seed
    let tailPt = seed.end
    for (let guard = 0; guard < 200; guard++) {
      const nb = collinearNeighborAt(tail, tailPt, segments, used)
      if (!nb) break
      used.add(nb.id)
      chain.push(nb)
      tailPt = samePoint(nb.start, tailPt) ? nb.end : nb.start
      tail = nb
    }

    groups.push({ members: chain, start: headPt, end: tailPt })
  }
  return groups
}

/** ある区間が属する通りを返す。 */
export function runOf(segmentId: string, segments: Segment[]): RunGroup | undefined {
  return groupRuns(segments).find((g) => g.members.some((m) => m.id === segmentId))
}

/**
 * 通り寸法の一覧。区間が1本しかない通り（＝分かれていない）は、個別の寸法と
 * 同じ値になり二重表示になるだけなので含めない。
 */
export function computeThroughRuns(
  segments: Segment[],
  cutById: Record<string, CutResult>,
): ThroughRun[] {
  const runs: ThroughRun[] = []
  for (const g of groupRuns(segments)) {
    if (g.members.length < 2) continue
    let total: number | undefined = 0
    for (const c of g.members) {
      const v = cutById[c.id]?.center
      if (v == null) {
        total = undefined
        break
      }
      total += v
    }
    runs.push({
      ids: g.members.map((c) => c.id),
      start: g.start,
      end: g.end,
      total: total != null ? Math.round(total * 10) / 10 : undefined,
    })
  }
  return runs
}

/**
 * 通りに設定された「全長」を持っている区間を探す。全長はユーザーが入力した
 * 区間に保存されるだけで、通り全体に対する値として扱う（チーズやフランジで
 * 更に分割されても通り全体の長さは変わらないため、そのまま持ち越せる）。
 * 「個別入力」に切り替えてある通りでは全長を使わない。
 */
export function runSpanHolder(run: RunGroup): Segment | undefined {
  if (run.members.some((m) => m.flangeSpanMode === 'each')) return undefined
  return run.members.find((m) => m.flangeSpanLength != null)
}
