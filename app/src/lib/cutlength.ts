import type { Segment } from '../types'
import { centerToFace } from '../data/masters'
import type { Effective } from './inheritance'

export interface CutResult {
  /** 芯々寸法(mm)。未入力なら undefined */
  center?: number
  /** 始点側の差し引き寸法(mm)＝継手 + フランジの中心〜端面寸法の合計 */
  startAllow: number
  /** 終点側の差し引き寸法(mm) */
  endAllow: number
  /** 切断長さ(mm)。芯々未入力なら undefined */
  cut?: number
  /** サイズ（呼び径）が判明しているか。未判明だと継手寸法を引けない */
  sizeKnown: boolean
}

/**
 * 1区間の切断（加工）寸法を計算する。
 *   切断長 = 芯々寸法 −（始点側の継手＋フランジ 中心〜端面寸法）−（終点側の同）
 * 継手・フランジの中心〜端面寸法は実効サイズ(effSize)で fittings.json から引く。
 */
export function computeCutLength(seg: Segment, effSize?: string): CutResult {
  const fitAllow = (fid?: string) => centerToFace(fid, effSize) ?? 0
  const flangeAllow = (f?: 'double' | 'single') =>
    f ? (centerToFace('flange', effSize) ?? 0) : 0

  const startAllow = fitAllow(seg.startFitting) + flangeAllow(seg.startFlange)
  const endAllow = fitAllow(seg.endFitting) + flangeAllow(seg.endFlange)

  const center = seg.centerLength
  const cut =
    center != null && !Number.isNaN(center)
      ? Math.max(0, center - startAllow - endAllow)
      : undefined

  return {
    center,
    startAllow,
    endAllow,
    cut,
    sizeKnown: effSize != null && effSize !== '',
  }
}

/** 全セグメントの切断寸法をまとめて計算 */
export function computeAllCut(
  segments: Segment[],
  effectiveById: Record<string, Effective>,
): Record<string, CutResult> {
  const out: Record<string, CutResult> = {}
  for (const s of segments) {
    out[s.id] = computeCutLength(s, effectiveById[s.id]?.size)
  }
  return out
}
