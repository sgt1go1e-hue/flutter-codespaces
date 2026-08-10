import type { Point, Segment } from '../types'
import { samePoint } from './isometric'
import type { CutResult } from './cutlength'

// 「通り寸法」= 曲がるまで一直線に続く区間をひとまとめにした全体の芯々。
// チーズ・フランジ・レジューサーで区間が分かれていても、向きが変わらなければ
// 1本の通りとして扱い、その合計を出す（エルボで区切る）。
// 例: L—T—L なら L—T と T—L の各寸法に加えて、通しの L—L も出せるようにする。
// 表示専用で、切り寸法・BOM等の計算結果には一切関与しない。

export interface ThroughRun {
  /** 上流から順に並んだ構成区間のid */
  ids: string[]
  /** 通り全体の始点・終点(両端の自由端) */
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
  // 反転しても同じ軸として比較できるよう、向きを一方向へ揃える
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

/** 点 pt で s と一直線に continuing する区間を探す（無ければ undefined）。 */
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
 * 曲がるまで一直線に続く区間をまとめた「通り」の一覧を返す。
 * 区間が1本しかない通り（＝分かれていない）は、個別の寸法と同じ値になり
 * 二重表示になるだけなので含めない。
 */
export function computeThroughRuns(
  segments: Segment[],
  cutById: Record<string, CutResult>,
): ThroughRun[] {
  const used = new Set<string>()
  const runs: ThroughRun[] = []

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

    if (chain.length < 2) continue

    // 芯々の合計。1つでも未入力なら合計は出さない(部分的な数字は誤解を生む)。
    let total: number | undefined = 0
    for (const c of chain) {
      const v = cutById[c.id]?.center
      if (v == null) {
        total = undefined
        break
      }
      total += v
    }
    runs.push({
      ids: chain.map((c) => c.id),
      start: headPt,
      end: tailPt,
      total: total != null ? Math.round(total * 10) / 10 : undefined,
    })
  }
  return runs
}
