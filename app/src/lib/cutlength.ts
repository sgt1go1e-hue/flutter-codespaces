import type { Segment } from '../types'
import type { Effective } from './inheritance'
import { reducerCounterpart, endConnections } from './inheritance'
import {
  getFitting,
  nominalOf,
  reducerKey,
  type FittingCalc,
  type ReducerDim,
  type TeeDim,
} from '../data/masters'

export interface EccentricInfo {
  /** 芯ズレ量(mm) = (大径OD − 小径OD) / 2 */
  offset?: number
  /** 合わせ面（未選択なら undefined） */
  align?: 'top' | 'bottom'
  /** 偏心レジューサーだが合わせ面が未選択 */
  alignNeeded: boolean
  /** 表示用の大径・小径ラベル */
  large?: string
  small?: string
}

export interface CutResult {
  center?: number
  startAllow: number
  endAllow: number
  cut?: number
  sizeKnown: boolean
  calc: FittingCalc
  /** 始点側が他セグメントに接続しているか（false=フリー端・差引なし） */
  startConnected: boolean
  /** 終点側が他セグメントに接続しているか */
  endConnected: boolean
  /** 相手径が未指定で計算できない（レジューサー/径違いチーズ） */
  needsCounterpart: boolean
  /** 実際に使った相手径（手動指定 or 自動判定） */
  counterpart?: string
  /** 隣接から自動判定した相手径（表示用） */
  autoCounterpart?: string
  /** 偏心レジューサーのときの芯ズレ情報 */
  eccentric?: EccentricInfo
}

const round1 = (x: number) => Math.round(x * 10) / 10

/**
 * 1区間の切断（加工）寸法を計算する。継手の計算方式(calc)ごとに式を分ける。
 * - centerMinus（エルボ/チーズ）: 中心〜端面を両端から差し引く
 * - overall（レジューサー）: 継手全長 H を差し引く（相手径が必要）
 * - endDepth（キャップ）: 終端の深さを片側で差し引く
 */
export function computeCutLength(
  seg: Segment,
  effSize?: string,
  effFitting?: string,
  autoCounterpart?: string,
  conn: { start: boolean; end: boolean } = { start: true, end: true },
): CutResult {
  const fitting = getFitting(effFitting)
  const calc: FittingCalc = fitting?.calc ?? 'none'
  const nominal = nominalOf(effSize)
  const nominalKey = nominal != null ? String(nominal) : ''
  // 相手径: 手動指定を優先し、無ければ隣接から自動判定した値を使う
  const counterpart = seg.reducerSize ?? autoCounterpart

  let startAllow = 0
  let endAllow = 0
  let needsCounterpart = false
  let eccentric: EccentricInfo | undefined

  if (fitting && calc === 'centerMinus') {
    // エルボ/チーズ: 接続している端だけ差し引く（フリー端は芯先で引かない）
    let t: number | undefined
    if (fitting.id === 'tee_reducing') {
      const key = reducerKey(effSize, counterpart)
      const dim = key ? (fitting.dims[key] as TeeDim | undefined) : undefined
      if (dim) t = dim.run
      else needsCounterpart = true
    } else {
      const raw = fitting.dims[nominalKey]
      t = typeof raw === 'number' ? raw : (raw as TeeDim | undefined)?.run
    }
    if (t != null) {
      if (conn.start) startAllow = t
      if (conn.end) endAllow = t
    }
  } else if (fitting && calc === 'overall') {
    // レジューサー: 全長 H を片側で差し引く。相手径が必要。
    const key = reducerKey(effSize, counterpart)
    const dim = key ? (fitting.dims[key] as ReducerDim | undefined) : undefined
    if (dim) {
      startAllow = dim.H
      if (fitting.id === 'reducer_eccentric') {
        const offset =
          dim.od1 != null && dim.od2 != null
            ? round1((dim.od1 - dim.od2) / 2)
            : undefined
        const a = nominalOf(effSize)
        const b = nominalOf(counterpart)
        const large = a != null && b != null ? `${Math.max(a, b)}A` : undefined
        const small = a != null && b != null ? `${Math.min(a, b)}A` : undefined
        eccentric = {
          offset,
          align: seg.reducerAlign,
          alignNeeded: !seg.reducerAlign,
          large,
          small,
        }
      }
    } else {
      needsCounterpart = true
    }
  } else if (fitting && calc === 'endDepth') {
    // キャップ: 終端（フリー端側）でキャップ深さを差し引く
    const raw = fitting.dims[nominalKey]
    if (typeof raw === 'number') {
      if (!conn.start) startAllow = raw
      else if (!conn.end) endAllow = raw
      else startAllow = raw // 両端接続の異常時は始点側
    }
  }

  const center = seg.centerLength
  const cut =
    center != null && !Number.isNaN(center)
      ? Math.max(0, round1(center - startAllow - endAllow))
      : undefined

  return {
    center,
    startAllow: round1(startAllow),
    endAllow: round1(endAllow),
    cut,
    sizeKnown: effSize != null && effSize !== '',
    calc,
    startConnected: conn.start,
    endConnected: conn.end,
    needsCounterpart,
    counterpart,
    autoCounterpart,
    eccentric,
  }
}

/** 全セグメントの切断寸法をまとめて計算 */
export function computeAllCut(
  segments: Segment[],
  effectiveById: Record<string, Effective>,
): Record<string, CutResult> {
  const out: Record<string, CutResult> = {}
  for (const s of segments) {
    const eff = effectiveById[s.id]
    const auto = reducerCounterpart(s, segments, effectiveById)
    const conn = endConnections(s, segments)
    out[s.id] = computeCutLength(s, eff?.size, eff?.fitting, auto, conn)
  }
  return out
}
