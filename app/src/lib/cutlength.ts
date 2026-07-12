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
  /**
   * 差込（ソケット）溶接継手同士を直結していて、両継手のツラ（差込み口の
   * 開口面）間の隙間が目安寸法(SOCKET_WELD_MIN_GAP)未満しか取れていない。
   * status='ok'（切り寸>0）のときのみ意味を持つ警告フラグ。
   */
  socketWeldGapWarning: boolean
  /** 差込溶接継手同士のツラ〜ツラ間の隙間(mm)。socketWeldGapWarning判定の元値（表示用）。 */
  socketWeldFaceGap?: number
}

const round1 = (x: number) => Math.round(x * 10) / 10

// 差込（ソケット）溶接は継手のソケット部に管を差し込んで隅肉溶接するため、
// 突き合わせ溶接と違い継手同士を直結できない。溶接ビード（と熱影響部）が
// 干渉しないよう、間に最低限の直管部（溶接代）を残す必要がある。
// JIS/ASME等に明確な規定値はなく現場慣習上の目安のため、一般的に言われる
// 50mmを下回った場合に警告する（実際の管理値は現場の仕様に従うこと）。
const SOCKET_WELD_MIN_GAP = 50

const isSocketWeldFittingId = (id?: string) => !!id && id.endsWith('_socket')

// 差込み深さ C(参考値, mm)。呼び径ごと。90°エルボ／チーズ(ラン・枝とも)は共通の
// ソケット深さ、45°エルボはソケット形状が異なるため別テーブル。
// 出典: 日本ジョイント SW SCH80(1欄) TB-0101-A/TB-0201-A(90°系)・TB-0401-A(45°)。
// 「切り寸法」はソケット底面〜底面間のパイプ長のため、そこから両端のC分
// （ソケットに隠れて溶接代として使えない部分）を差し引いた値が、実際に
// 溶接ビードが入る「継手のツラ〜ツラ」間の隙間になる。
const SOCKET_DEPTH_C_90: Record<string, number> = {
  '15': 12.5,
  '20': 14.0,
  '25': 15.5,
  '32': 16.5,
  '40': 17.5,
  '50': 19.5,
  '65': 25.0,
  '80': 28.5,
}
const SOCKET_DEPTH_C_45: Record<string, number> = {
  '15': 10.0,
  '20': 12.7,
  '25': 13.0,
  '32': 15.0,
  '40': 17.5,
  '50': 17.5,
  '65': 22.0,
  '80': 25.0,
}
const socketDepthC = (fittingId?: string, size?: string): number => {
  const n = nominalOf(size)
  if (n == null) return 0
  const table = fittingId?.startsWith('elbow45') ? SOCKET_DEPTH_C_45 : SOCKET_DEPTH_C_90
  return table[String(n)] ?? 0
}

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
    } else if (
      s.fitting === 'reducer_concentric' ||
      s.fitting === 'reducer_socket' ||
      s.fitting === 'reducer_thread' ||
      s.fitting === 'bushing_thread'
    ) {
      needsCounterpart = !(s.reducerSize ?? autoCounterpart)
    }
    // tee_reducing(径違いチーズ)は「メイン管サイズ／枝管サイズ」で実サイズを直接編集する
    // 方式のため、相手径待ちの警告は不要（ノードが分岐として成立していれば常に計算できる）。

    // 差込溶接の「継手のツラ〜ツラ」間の隙間 = 切り寸法(ソケット底面〜底面間)から
    // 両端のソケット差込み深さCを差し引いたもの。
    const socketWeldFaceGap =
      cut != null && isSocketWeldFittingId(e.start.fittingId) && isSocketWeldFittingId(e.end.fittingId)
        ? round1(cut - socketDepthC(e.start.fittingId, eff?.size) - socketDepthC(e.end.fittingId, eff?.size))
        : undefined

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
        s.fitting === 'reducer_socket' ||
        s.fitting === 'reducer_thread' ||
        s.fitting === 'bushing_thread'
          ? reducerLargeAtStart(s, segments, effectiveById, s.reducerSize ?? autoCounterpart)
          : undefined,
      socketWeldGapWarning:
        status === 'ok' &&
        socketWeldFaceGap != null &&
        socketWeldFaceGap < SOCKET_WELD_MIN_GAP &&
        isSocketWeldFittingId(e.start.fittingId) &&
        isSocketWeldFittingId(e.end.fittingId),
      socketWeldFaceGap,
    }
  }
  return out
}
