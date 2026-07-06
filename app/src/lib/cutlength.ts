import type { Segment } from '../types'
import type { Effective } from './inheritance'
import { reducerCounterpart, reducerLargeAtStart } from './inheritance'
import { computeEnds, type EndRole } from './takeout'
import { getFitting, nominalOf, reducerKey, type ReducerDim } from '../data/masters'

export interface EccentricInfo {
  offset?: number
  align?: 'top' | 'bottom'
  alignNeeded: boolean
  large?: string
  small?: string
}

export interface CutResult {
  center?: number
  startAllow: number
  endAllow: number
  startRole: EndRole
  endRole: EndRole
  /** 表示用の切り寸法(mm)。0未満は0にクランプ済み */
  cut?: number
  /** クランプ前の切り寸法（負値あり＝継手が収まらない判定用） */
  rawCut?: number
  /**
   * 切り寸法の状態:
   * 'none'=芯々未入力 / 'ok'=正の切り寸 / 'zero'=ほぼ0(継手直結) / 'over'=負(芯々不足)
   */
  status: 'none' | 'ok' | 'zero' | 'over'
  /** BOM でパイプ材として計上できるか（切り寸 > 0） */
  countable: boolean
  /** 両端継手接続=芯々 / 片端フリー=芯先 */
  mode: '芯々' | '芯先'
  sizeKnown: boolean
  startConnected: boolean
  endConnected: boolean
  /** レジューサー/径違いチーズで相手径が不明で計算できない */
  needsCounterpart: boolean
  /** 隣接から自動判定した相手径（表示用） */
  autoCounterpart?: string
  eccentric?: EccentricInfo
  /** レジューサー描画用: 大径側が始点側か */
  reducerLargeAtStart?: boolean
}

const round1 = (x: number) => Math.round(x * 10) / 10

/**
 * 全セグメントの切断（加工）寸法を、端ごと（per-end）に計算する。
 * 各端の取り出し寸法は、その端のノードの役割（エルボ/チーズ/レジューサー/直管/フリー端）と
 * そのセグメント自身の実効サイズから、takeout.ts のノードグラフで求める。
 */
export function computeAllCut(
  segments: Segment[],
  effectiveById: Record<string, Effective>,
): Record<string, CutResult> {
  const ends = computeEnds(segments, effectiveById)
  const out: Record<string, CutResult> = {}

  for (const s of segments) {
    const eff = effectiveById[s.id]
    const e = ends[s.id]
    const startAllow = round1(e.start.mm)
    const endAllow = round1(e.end.mm)
    const center = s.centerLength
    const hasCenter = center != null && !Number.isNaN(center)
    const rawCut = hasCenter ? round1(center! - startAllow - endAllow) : undefined
    const cut = rawCut != null ? Math.max(0, rawCut) : undefined
    const status: CutResult['status'] =
      rawCut == null
        ? 'none'
        : rawCut < -0.5
          ? 'over'
          : rawCut <= 0.5
            ? 'zero'
            : 'ok'
    const startConnected = e.start.role !== 'free'
    const endConnected = e.end.role !== 'free'
    const mode: '芯々' | '芯先' =
      startConnected && endConnected ? '芯々' : '芯先'

    // 偏心レジューサーの芯ズレ
    let eccentric: EccentricInfo | undefined
    let needsCounterpart = false
    const autoCounterpart = reducerCounterpart(s, segments, effectiveById)
    if (s.fitting === 'reducer_eccentric') {
      const cp = s.reducerSize ?? autoCounterpart
      const key = reducerKey(eff?.size, cp)
      const dim = key
        ? (getFitting('reducer_eccentric')?.dims[key] as ReducerDim | undefined)
        : undefined
      const offset =
        dim && dim.od1 != null && dim.od2 != null
          ? round1((dim.od1 - dim.od2) / 2)
          : undefined
      const a = nominalOf(eff?.size)
      const b = nominalOf(cp)
      const large = a != null && b != null ? `${Math.max(a, b)}A` : undefined
      const small = a != null && b != null ? `${Math.min(a, b)}A` : undefined
      eccentric = { offset, align: s.reducerAlign, alignNeeded: !s.reducerAlign, large, small }
      needsCounterpart = !cp
    } else if (s.fitting === 'reducer_concentric' || s.fitting === 'tee_reducing') {
      needsCounterpart = !(s.reducerSize ?? autoCounterpart)
    }

    out[s.id] = {
      center,
      startAllow,
      endAllow,
      startRole: e.start.role,
      endRole: e.end.role,
      cut,
      rawCut,
      status,
      countable: status === 'ok',
      mode,
      sizeKnown: eff?.size != null && eff?.size !== '',
      startConnected,
      endConnected,
      needsCounterpart,
      autoCounterpart,
      eccentric,
      reducerLargeAtStart:
        s.fitting === 'reducer_concentric' || s.fitting === 'reducer_eccentric'
          ? reducerLargeAtStart(s, segments, effectiveById, s.reducerSize ?? autoCounterpart)
          : undefined,
    }
  }
  return out
}
