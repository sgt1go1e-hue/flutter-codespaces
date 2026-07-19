import type { Segment } from '../types'
import type { Effective } from './inheritance'
import { reducerCounterpart, reducerLargeAtStart } from './inheritance'
import { computeEnds, resolveReducerH, type EndRole } from './takeout'
import { getFitting, nominalOf, reducerKey, type ReducerDim } from '../data/masters'
import { computeChainedSlopeDrop } from './slope'

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
  /**
   * レジューサー(同心/偏心)の面間寸法(H, mm)。s.fitting が reducer_concentric/
   * reducer_eccentric で相手径が判明しているときだけ設定される（表示用）。
   */
  reducerH?: number
  /**
   * レジューサーの面間寸法(H)がマスタ(reducerLengths.ts)に無い組み合わせで、
   * 手入力(reducerLengthOverride)も未設定のとき true。UIが手入力ダイアログを
   * 促すために使う。
   */
  needsReducerLength: boolean
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
  /**
   * ねじ込み継手同士を直結していて、切り寸法がメーカーの最短ニップル（丸ニップル）
   * 寸法(THREAD_MIN_NIPPLE)を下回っている＝現実的にねじ切り加工できない長さ。
   * status='ok'（切り寸>0）のときのみ意味を持つ。
   */
  threadTooShortForPipe: boolean
  /** 切り寸法が最短ニップル寸法に近い(15mm以内)。丸ニップルの使用を提案する目安。 */
  threadNearMinNipple: boolean
  /** 判定に使った最短ニップル(丸ニップル)寸法(mm、表示用)。 */
  threadMinNippleLength?: number
  /**
   * 塩ビ(VP)TS継手のエルボ同士を直結していて、切り寸法が両端の差込み深さの
   * 合計(=直結できる最短の直管長)を下回っている＝差込接着が届かず施工できない。
   * status='ok'（切り寸>0）のときのみ意味を持つ。
   */
  vpTsTooShortForPipe: boolean
  /** 判定に使った最短直管長(mm、表示用)。 */
  vpTsMinPipeLength?: number
  /**
   * 縦区間(90°/270°)で、下流に隣接する排水勾配区間により差し引かれた
   * 高低差の合計(mm)。0またはundefinedなら勾配による調整なし。
   * center(入力した芯々寸法)からこの分を引いた値で切り寸法を計算している。
   */
  slopeAdjust?: number
}

const round1 = (x: number) => Math.round(x * 10) / 10

// 差込（ソケット）溶接は継手のソケット部に管を差し込んで隅肉溶接するため、
// 突き合わせ溶接と違い継手同士を直結できない。溶接ビード（と熱影響部）が
// 干渉しないよう、間に最低限の直管部（溶接代）を残す必要がある。
// JIS/ASME等に明確な規定値はなく現場慣習上の目安のため、一般的に言われる
// 50mmを下回った場合に警告する（実際の管理値は現場の仕様に従うこと）。
const SOCKET_WELD_MIN_GAP = 50

const isSocketWeldFittingId = (id?: string) => !!id && id.endsWith('_socket')

// ねじ込み継手同士の間に入る直管は、短すぎるとパイプレンチが掛けられず現場で
// ねじ切り加工できない。メーカーが出している最短の既製ニップル（丸ニップル）の
// 全長を下回ったら「加工不可能」と判定する（現場実測に基づく指定値）。
// 近接(+15mm以内)の場合は、無理に現物合わせのパイプを作らず既製の丸ニップルを
// 使う方が現実的なため、その旨を表示する目安として使う。
const THREAD_MIN_NIPPLE: Record<string, number> = {
  '15': 34,
  '20': 38,
  '25': 42,
  '32': 50,
  '40': 50,
  '50': 58,
  '65': 70,
  '80': 78,
  '100': 90,
}
const THREAD_NEAR_MIN_MARGIN = 15

const isThreadFittingId = (id?: string) => !!id && id.endsWith('_thread')

// 塩ビ(VP)TS継手は差込接着のため、ねじ込みと違い突き合わせができない。
// 2つのTS継手（エルボ）を直結する直管は、両端それぞれのソケットに届くだけの
// 長さが最低限必要で、その長さ(ソケット差込み深さℓ)はカタログのH(継手中心〜
// 差込み口の参考寸法)−Z(取り出し寸法)がちょうど一致することを確認済み
// （90°/45°とも同じ値）。同一区間は両端とも同じ呼び径なので、最短直管長は
// ℓを2倍した値になる。
const TS_VP_ELBOW_SOCKET_DEPTH: Record<string, number> = {
  '13': 26,
  '16': 30,
  '20': 35,
  '25': 40,
  '30': 44,
  '40': 55,
  '50': 63,
  '65': 61,
  '75': 64,
  '100': 84,
}

const isVpTsElbowId = (id?: string) => id === 'elbow90_vp_ts' || id === 'elbow45_vp_ts'
const isVpTsTeeId = (id?: string) => id === 'tee_equal_vp_ts' || id === 'tee_reducing_vp_ts'

// TSチーズはラン側/枝側で差込み深さが異なり、しかも組み合わせ(ラン径_枝径)
// ごとに値が変わる（同径どうしでもエルボと同じ値になるとは限らない）ため、
// カタログのH(ラン全長)−Z2(ラン取り出し)・I(枝全長)−Z1(枝取り出し)を
// 組み合わせキーごとに計算した値をそのまま使う。
const TS_VP_TEE_RUN_DEPTH: Record<string, number> = {
  '13_13': 26,
  '16_13': 29,
  '16_16': 30,
  '20_13': 32,
  '20_16': 33,
  '20_20': 35,
  '25_13': 34,
  '25_16': 35,
  '25_20': 37,
  '25_25': 40,
  '30_13': 35,
  '30_16': 36,
  '30_20': 38,
  '30_25': 41,
  '30_30': 44,
  '40_13': 40,
  '40_16': 41,
  '40_20': 43,
  '40_25': 46,
  '40_30': 49,
  '40_40': 55,
  '50_13': 42,
  '50_16': 42,
  '50_20': 43,
  '50_25': 48,
  '50_30': 51,
  '50_40': 57,
  '50_50': 63,
  '65_50': 60,
  '65_65': 61,
  '75_25': 45,
  '75_40': 53,
  '75_50': 58,
  '75_65': 57,
  '75_75': 64,
  '100_50': 66,
  '100_75': 72,
  '100_100': 84,
  '150_75': 101,
  '150_100': 110,
  '150_150': 132,
}
const TS_VP_TEE_BRANCH_DEPTH: Record<string, number> = {
  '13_13': 26,
  '16_13': 27,
  '16_16': 30,
  '20_13': 29,
  '20_16': 32,
  '20_20': 35,
  '25_13': 32,
  '25_16': 35,
  '25_20': 38,
  '25_25': 40,
  '30_13': 35,
  '30_16': 38,
  '30_20': 41,
  '30_25': 43,
  '30_30': 44,
  '40_13': 41,
  '40_16': 44,
  '40_20': 47,
  '40_25': 49,
  '40_30': 50,
  '40_40': 55,
  '50_13': 47,
  '50_16': 47,
  '50_20': 53,
  '50_25': 55,
  '50_30': 56,
  '50_40': 61,
  '50_50': 63,
  '65_50': 64,
  '65_65': 61,
  '75_25': 59,
  '75_40': 66,
  '75_50': 69,
  '75_65': 68,
  '75_75': 64,
  '100_50': 81,
  '100_75': 76,
  '100_100': 84,
  '150_75': 95,
  '150_100': 106,
  '150_150': 132,
}

// 塩ビ(VP)TS継手の差込み深さℓ(mm)を、継手idと自分側のサイズ・役割から求める。
// エルボは呼び径のみで決まるが、チーズはラン/枝の組み合わせ（相手側のサイズ）
// によって値が変わるため teeCounterpart（もう一方の実サイズ）も必要。
function tsVpSocketDepth(
  fittingId: string | undefined,
  size: string | undefined,
  role: EndRole,
  teeCounterpart: string | undefined,
): number | undefined {
  const n = nominalOf(size)
  if (n == null) return undefined
  if (isVpTsElbowId(fittingId)) return TS_VP_ELBOW_SOCKET_DEPTH[String(n)]
  if (isVpTsTeeId(fittingId)) {
    const cn = nominalOf(teeCounterpart)
    if (cn == null) return undefined
    const isRun = role === 'tee-run' || role === 'tee-run-reducer'
    const runN = isRun ? n : cn
    const branchN = isRun ? cn : n
    const key = `${runN}_${branchN}`
    return (isRun ? TS_VP_TEE_RUN_DEPTH : TS_VP_TEE_BRANCH_DEPTH)[key]
  }
  return undefined
}

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
 * 寸法(center)と両端の取り出し寸法から切り寸法を求める共通の計算式。
 * 作図画面(computeAllCut、区間ごと)とクイック計算(quickCalc、単発)の両方から
 * 同じ関数を呼ぶことで、計算式の重複実装・ズレを防ぐ。
 */
export function computeCutFromAllowances(
  center: number | undefined,
  startAllow: number,
  endAllow: number,
  roundMode: RoundMode,
): { rawCut?: number; cut?: number; status: CutResult['status'] } {
  const hasCenter = center != null && !Number.isNaN(center)
  const rawCut = hasCenter ? round1(center! - startAllow - endAllow) : undefined
  // 切り寸法だけ丸め（継手の取り出し寸法は小数のまま）。0未満は0にクランプ。
  const cut = rawCut != null ? applyRound(Math.max(0, rawCut), roundMode) : undefined
  const status: CutResult['status'] =
    rawCut == null ? 'none' : rawCut < -0.5 ? 'over' : rawCut <= 0.5 ? 'zero' : 'ok'
  return { rawCut, cut, status }
}

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
  // 配管設定(ベース)の勾配(1/N のN)。区間自身に個別上書きが無いときのフォールバック値。
  baseSlopeDenom?: number,
): Record<string, CutResult> {
  const ends = computeEnds(segments, effectiveById)
  const slopeDrops = computeChainedSlopeDrop(segments, effectiveById, baseSlopeDenom)
  const out: Record<string, CutResult> = {}

  for (const s of segments) {
    const eff = effectiveById[s.id]
    const e = ends[s.id]
    // 取り出し寸法 = 継手の取り出し + (端にフランジがあれば)フランジ引きしろ + パッキン厚
    const flangeDeduct = flangeAllow + gasketMm
    const startAllow = round1(e.start.mm) + (s.startFlange ? flangeDeduct : 0)
    const endAllow = round1(e.end.mm) + (s.endFlange ? flangeDeduct : 0)
    // 縦区間(90°/270°)は、下流に隣接する排水勾配区間で生じる高低差の合計を
    // 切り寸法の計算にだけ差し引く（勾配で下がった分、縦区間はその分短くなる）。
    // 表示上の「芯々」は引き続きユーザーが入力した値のまま見せる。
    const isVertical = s.angle === 90 || s.angle === 270
    const slopeAdjust =
      isVertical ? round1(slopeDrops[s.id].start + slopeDrops[s.id].end) : 0
    const center = s.centerLength
    const adjustedCenter = center != null ? center - slopeAdjust : undefined
    const { rawCut, cut, status } = computeCutFromAllowances(
      adjustedCenter,
      startAllow,
      endAllow,
      roundMode,
    )
    const startConnected = e.start.role !== 'free'
    const endConnected = e.end.role !== 'free'
    const mode: '芯々' | '芯先' =
      startConnected && endConnected ? '芯々' : '芯先'

    // 偏心レジューサーの芯ズレ
    let eccentric: EccentricInfo | undefined
    let needsCounterpart = false
    const autoCounterpart = reducerCounterpart(s, segments, effectiveById)
    // レジューサー(同心/偏心)の面間寸法(H)。表示用・手入力ダイアログ判定用。
    // 実際の切り寸法への控除は takeout.ts 側(resolveEnd の 'reducer' role)で
    // 既に行われているため、ここでは表示・警告のための値だけを求める。
    let reducerH: number | undefined
    let needsReducerLength = false
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
      if (cp) {
        const r = resolveReducerH(eff?.size, cp, s.reducerLengthOverride)
        reducerH = r.H
        needsReducerLength = r.needsInput
      }
    } else if (s.fitting === 'reducer_concentric') {
      const cp = s.reducerSize ?? autoCounterpart
      needsCounterpart = !cp
      if (cp) {
        const r = resolveReducerH(eff?.size, cp, s.reducerLengthOverride)
        reducerH = r.H
        needsReducerLength = r.needsInput
      }
    } else if (s.fitting === 'reducer_socket' || s.fitting === 'reducer_thread' || s.fitting === 'bushing_thread') {
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

    // ねじ込み継手同士を直結している区間の切り寸法が、既製の最短ニップル(丸ニップル)
    // 寸法を下回っていないか（=現場でねじ切り加工できる最短の長さか）を判定する。
    const threadMinNippleLength =
      isThreadFittingId(e.start.fittingId) && isThreadFittingId(e.end.fittingId)
        ? THREAD_MIN_NIPPLE[String(nominalOf(eff?.size) ?? '')]
        : undefined
    const threadTooShortForPipe =
      status === 'ok' && threadMinNippleLength != null && cut! < threadMinNippleLength
    const threadNearMinNipple =
      status === 'ok' &&
      threadMinNippleLength != null &&
      cut! >= threadMinNippleLength &&
      cut! <= threadMinNippleLength + THREAD_NEAR_MIN_MARGIN

    // 塩ビ(VP)TS継手(エルボ/チーズ)同士を直結している区間の最短直管長
    // (両端それぞれの差込み深さの合計)。
    const vpTsStartDepth = tsVpSocketDepth(
      e.start.fittingId,
      eff?.size,
      e.start.role,
      e.start.teeCounterpart,
    )
    const vpTsEndDepth = tsVpSocketDepth(
      e.end.fittingId,
      eff?.size,
      e.end.role,
      e.end.teeCounterpart,
    )
    const vpTsMinPipeLength =
      vpTsStartDepth != null && vpTsEndDepth != null
        ? vpTsStartDepth + vpTsEndDepth
        : undefined
    const vpTsTooShortForPipe =
      status === 'ok' && vpTsMinPipeLength != null && cut! < vpTsMinPipeLength

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
      reducerH,
      needsReducerLength:
        needsReducerLength || e.start.needsReducerLength === true || e.end.needsReducerLength === true,
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
      threadTooShortForPipe,
      threadNearMinNipple,
      threadMinNippleLength,
      vpTsTooShortForPipe,
      vpTsMinPipeLength,
      slopeAdjust: slopeAdjust || undefined,
    }
  }
  return out
}
