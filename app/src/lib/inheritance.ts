import type { Segment } from '../types'

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
}

/** 全セグメントの実効属性をまとめて計算する */
export function computeEffective(segments: Segment[]): Record<string, Effective> {
  const byId = buildSegmentMap(segments)
  const out: Record<string, Effective> = {}
  for (const s of segments) {
    const size = effectiveSize(s, byId)
    out[s.id] = {
      pipeType: effectivePipeType(s, byId),
      size,
      sizeOwn: s.size != null && s.size !== '',
      resolved: size != null && size !== '',
    }
  }
  return out
}
