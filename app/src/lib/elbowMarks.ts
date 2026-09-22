import type { Point, Segment } from '../types'
import type { CutResult } from './cutlength'
import { distance } from './isometric'

// エルボの継手マーク（画面・印刷の両方で使う）。
// ロングが既定のため、それ以外（45°ロング/ショート、90°ショート）を
// 使っている端だけを図中に明示し、現場での見落としを防ぐ。

export type ElbowMarkKind = 'L45' | 'S45' | 'short'

export interface ElbowMarkEnd {
  segId: string
  at: 'start' | 'end'
  kind: ElbowMarkKind
  /** マークを描く位置（重なり回避の障害物としてもこの位置を使う）。 */
  pos: Point
}

const KIND_BY_FITTING: Record<string, ElbowMarkKind> = {
  elbow45_long: 'L45',
  elbow45_short: 'S45',
  elbow90_short: 'short',
}

export const ELBOW_MARK_LABELS: Record<ElbowMarkKind, string> = {
  L45: 'L45°',
  S45: 'S45°',
  short: 'ショート',
}

/** マークを描く端を一意に指す（描画側の判定と位置計算で同じキーを使う）。 */
export function elbowMarkEndKey(segId: string, at: 'start' | 'end'): string {
  return `${segId}:${at}`
}

/**
 * 図中に実際に描かれるエルボマークの一覧。
 *
 * セグメント自身の fitting 値ではなく、実際の計算に使われた継手id
 * (cutById[...].start/endFittingId、始点/終点の個別上書きも反映済み)で判定する。
 *
 * エルボの角は隣り合う2本の線が共有しているため、そのまま両方に描かせると
 * 同じ角に同じマークが2つ並んでしまう。ノード（座標）ごとに最初の1本だけを
 * 描画担当に選び、1つだけ出るようにしている。
 *
 * showShort=false のときは90°ショートの「ショート」マークを一切作らない
 * （ショートが既定の会社向けに表示を切れるようにするため）。マークが無い
 * 位置を寸法ラベルが避けるのは不自然なので、重なり回避の障害物からも同時に
 * 外れるよう、ここで一括して除外する。
 */
export function elbowMarkEnds(
  segments: Segment[],
  cutById: Record<string, CutResult>,
  showShort = true,
): ElbowMarkEnd[] {
  const ends: ElbowMarkEnd[] = []
  const seenNodes = new Set<string>()
  for (const s of segments) {
    const c = cutById[s.id]
    if (!c) continue
    for (const at of ['start', 'end'] as const) {
      const role = at === 'start' ? c.startRole : c.endRole
      if (role !== 'elbow' && role !== 'elbow-reducer') continue
      const fittingId = at === 'start' ? c.startFittingId : c.endFittingId
      const kind = fittingId ? KIND_BY_FITTING[fittingId] : undefined
      if (!kind) continue
      if (kind === 'short' && !showShort) continue
      const pt = at === 'start' ? s.start : s.end
      const nodeKey = `${kind}@${Math.round(pt.x)},${Math.round(pt.y)}`
      if (seenNodes.has(nodeKey)) continue
      seenNodes.add(nodeKey)
      const other = at === 'start' ? s.end : s.start
      const len = distance(pt, other) || 1
      const dx = (other.x - pt.x) / len
      const dy = (other.y - pt.y) / len
      const nx = -dy
      const ny = dx
      const gap = 20
      const off = 11
      ends.push({
        segId: s.id,
        at,
        kind,
        pos: { x: pt.x + dx * gap + nx * off, y: pt.y + dy * gap + ny * off },
      })
    }
  }
  return ends
}

/** 端キー -> マーク種別。描画側で「この端に何を描くか」を引くのに使う。 */
export function elbowMarkKindByEnd(ends: ElbowMarkEnd[]): Map<string, ElbowMarkKind> {
  const m = new Map<string, ElbowMarkKind>()
  for (const e of ends) m.set(elbowMarkEndKey(e.segId, e.at), e.kind)
  return m
}
