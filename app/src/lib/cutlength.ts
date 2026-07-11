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
  /** 各端で実際に取り出し寸法の計算に使われた継手id（45°ローリングオフセット判定などに使用） */
  startFittingId?: string
  endFittingId?: string
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

// 切り寸法の丸め方。継手の取り出し寸法(startAllow/endAllow)には適用せず、
// 最終の切り寸法(cut)だけに適用する。
export type RoundMode = 'round' | 'floor'
const applyRound = (x: number, mode: RoundMode) =>
  mode === 'floor' ? Math.floor(x) : Math.round(x)

/**
 * 全セグメントの切断（加工）寸法を、端ごと（per-end）に計算する。
 * 各端の取り出し寸法は、その端のノードの役割（エルボ/チーズ/レジューサー/直管/フリー端）と
 * そのセグメント自身の実効サイズから、takeout.ts のノードグラフで求める。
 * roundMode は切り寸法(cut)のみに適用（既定=四捨五入）。継手寸法は小数のまま。
 */
export function computeAllCut(
  segments: Segment[],
  effectiveById: Record<string, Effective>,
  roundMode: RoundMode = 'round',
  // フランジの引きしろ(mm)。フランジが付いた端の取り出し寸法に加算する（全フランジ共通）。
  // 溶接フランジ等は引きしろが規格化されず任意のため、ユーザーが入力する。
  flangeAllow = 0,
  // パッキン(ガスケット)厚(mm)。フランジ面間に必ず入る。加味する場合、フランジ端で差し引く。
  // 加味しない場合は 0 を渡す。片フランジ・両フランジとも同様に適用。
  gasketMm = 0,
): Record<string, CutResult> {
  const ends = computeEnds(segments, effectiveById)
  const out: Record<string, CutResult> = {}

  for (const s of segments) {
    const eff = effectiveById[s.id]
    const e = ends[s.id]
    // 取り出し寸法 = 継手の取り出し + (端にフランジがあれば)フランジ引きしろ + パッキン厚
    const flangeDeduct = flangeAllow + gasketMm
    const startAllow = round1(e.start.mm) + (s.startFlange ? flangeDeduct : 0)
    const endAllow = round1(e.end.mm) + (s.endFlange ? flangeDeduct : 0)
    const center = s.centerLength
    const hasCenter = center != null && !Number.isNaN(center)
    const rawCut = hasCenter ? round1(center! - startAllow - endAllow) : undefined
    // 切り寸法だけ丸め（継手の取り出し寸法は小数のまま）。0未満は0にクランプ。
    const cut =
      rawCut != null ? applyRound(Math.max(0, rawCut), roundMode) : undefined
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
    } else if (s.fitting === 'reducer_concentric' || s.fitting === 'reducer_socket') {
      needsCounterpart = !(s.reducerSize ?? autoCounterpart)
    }
    // tee_reducing(径違いチーズ)は「メイン管サイズ／枝管サイズ」で実サイズを直接編集する
    // 方式のため、相手径待ちの警告は不要（ノードが分岐として成立していれば常に計算できる）。

    out[s.id] = {
      center,
      startAllow,
      endAllow,
      startRole: e.start.role,
      endRole: e.end.role,
      startFittingId: e.start.fittingId,
      endFittingId: e.end.fittingId,
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
        s.fitting === 'reducer_concentric' ||
        s.fitting === 'reducer_eccentric' ||
        s.fitting === 'reducer_socket'
          ? reducerLargeAtStart(s, segments, effectiveById, s.reducerSize ?? autoCounterpart)
          : undefined,
    }
  }
  return out
}
