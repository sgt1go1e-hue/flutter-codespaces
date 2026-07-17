// 排水勾配(1/N)による高低差の計算。
// DV継手(塩ビ)またはSGP管の排水・ドレン配管では、水平に近い区間にも
// 勾配を付ける必要がある。勾配を付けた区間の分だけ実際の高さが下がるため、
// その上流に隣接する縦区間(90°/270°)の芯々寸法から、下流側の勾配区間で
// 生じる高低差の合計を自動的に差し引く。
import type { Point, Segment } from '../types'
import type { Effective } from './inheritance'
import { samePoint } from './isometric'

const round1 = (x: number) => Math.round(x * 10) / 10
// ノード同一判定の許容誤差(px)。他ロジック(takeout.ts等)と同じ値。
const NODE_EPS = 1

/** 勾配設定欄を表示してよい管種/継手か（SGP管、またはVP管のDV継手） */
export function isSlopeEligible(pipeType?: string, vpSeries?: 'dv' | 'ts'): boolean {
  return pipeType === 'sgp' || (pipeType === 'vp' && vpSeries === 'dv')
}

/** よく使う排水勾配の分母(1/N のN)。現場で使用頻度の高いものを用意。 */
export const SLOPE_DENOM_OPTIONS = [50, 75, 100, 125, 150, 200] as const

/** 区間の芯々寸法と勾配(1/N)から、その区間で生じる高低差(mm)を求める */
export function elevationDrop(
  centerLength: number | undefined,
  slopeDenom: number | undefined,
): number {
  if (!slopeDenom || centerLength == null || Number.isNaN(centerLength)) return 0
  return round1(centerLength / slopeDenom)
}

export interface SlopeEnds {
  start: number
  end: number
}

/**
 * 各セグメントの端ごとに、そこから次数2(直列)でつながり続ける勾配区間の
 * 高低差を合計する。分岐・フリー端・勾配なしの区間に達したら打ち切る。
 * 縦区間(90°/270°)が、この値を自分の芯々寸法から差し引くために使う。
 */
export function computeChainedSlopeDrop(
  segments: Segment[],
  effectiveById: Record<string, Effective>,
): Record<string, SlopeEnds> {
  const out: Record<string, SlopeEnds> = {}
  const touchesPoint = (s: Segment, p: Point) =>
    samePoint(s.start, p, NODE_EPS) || samePoint(s.end, p, NODE_EPS)
  const neighborsAt = (p: Point, excludeId: string) =>
    segments.filter((s) => s.id !== excludeId && touchesPoint(s, p))

  for (const s of segments) {
    out[s.id] = { start: 0, end: 0 }
    for (const end of ['start', 'end'] as const) {
      let total = 0
      let currentPoint = end === 'start' ? s.start : s.end
      let prevId = s.id
      for (;;) {
        const neighbors = neighborsAt(currentPoint, prevId)
        if (neighbors.length !== 1) break // 分岐(2本以上) or フリー端(0本)で打ち切り
        const nb = neighbors[0]
        const eff = effectiveById[nb.id]
        if (!nb.slopeDenom || !isSlopeEligible(eff?.pipeType, eff?.vpSeries)) break
        total += elevationDrop(nb.centerLength, nb.slopeDenom)
        currentPoint = samePoint(nb.start, currentPoint, NODE_EPS) ? nb.end : nb.start
        prevId = nb.id
      }
      out[s.id][end] = round1(total)
    }
  }
  return out
}
