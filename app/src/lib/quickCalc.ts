// クイック計算(芯引き)の計算ロジック。
// 作図画面と同じ継手マスタ・計算式(takeout.ts / cutlength.ts)を再利用し、
// 単発の「管種・サイズ・両端の継手・全体寸法」から切り寸法を求める。
// 新規のデータ定義・計算式の重複実装はしない。
import type { RoundMode } from './cutlength'
import { computeCutFromAllowances } from './cutlength'
import { elbowTakeoutById, teeTakeout, OFFSET_45_FACTOR, type ConnectionKind } from './takeout'

export type QuickFittingKind =
  | 'free'
  | 'elbow90_long'
  | 'elbow90_short'
  | 'elbow45'
  | 'tee'
  | 'tee_branch'
  | 'flange'

export interface QuickEndInput {
  kind: QuickFittingKind
  /** チーズで必要な相手径（メイン側/枝側の呼び径コード） */
  counterpartSize?: string
  /** フランジの引きしろ(mm)。フランジ選択時のみ使用（既存の作図画面と同じ手入力値） */
  flangeAllow?: number
  /**
   * 芯々(center)/芯先(face)の基準。faceを選ぶと、その端は継手を選んでいても
   * 取り出し寸法を0として扱う（実測をフィッティングの中心ではなく、パイプの
   * 切断端/端面からとった場合用）。フリー端は常にfaceとして扱う。
   */
  basis: 'center' | 'face'
}

export interface QuickCalcInput {
  pipeType?: string
  size?: string
  connection?: string
  vpSeries?: 'dv' | 'ts'
  overall?: number
  roundMode: RoundMode
  left: QuickEndInput
  right: QuickEndInput
}

export interface QuickCalcResult {
  startAllow: number
  endAllow: number
  startFittingId?: string
  endFittingId?: string
  /** 継手を選んでいるのに、そのサイズの寸法が継手マスタに無い端（控えを0として計算している） */
  startMissing?: boolean
  endMissing?: boolean
  rawCut?: number
  cut?: number
  status: 'none' | 'ok' | 'zero' | 'over'
  /** 入力不正の理由（あれば）。status='none'相当でも表示用に区別する。 */
  error?: string
}

// セグメントの接続方法(connection)・管種(pipeType)から、エルボ/チーズの
// 継手idを出し分けるための種別。resolveEnd()の自動判定と同じルール。
export function connectionKindOf(
  pipeType?: string,
  vpSeries?: 'dv' | 'ts',
  connection?: string,
): ConnectionKind {
  if (pipeType === 'vp') return vpSeries === 'ts' ? 'vp_ts' : 'vp_dv'
  if (connection === 'socket') return 'socket'
  if (connection === 'thread') return 'thread'
  return 'buttweld'
}

export function elbowFittingId(
  kind: 'elbow90_long' | 'elbow90_short' | 'elbow45',
  ck: ConnectionKind,
): string {
  const is45 = kind === 'elbow45'
  if (ck === 'socket') return is45 ? 'elbow45_socket' : 'elbow90_socket'
  if (ck === 'thread') return is45 ? 'elbow45_thread' : 'elbow90_thread'
  if (ck === 'vp_dv') return is45 ? 'elbow45_vp_dv' : 'elbow90_vp_dv'
  if (ck === 'vp_ts') return is45 ? 'elbow45_vp_ts' : 'elbow90_vp_ts'
  if (is45) return 'elbow45_long'
  return kind === 'elbow90_short' ? 'elbow90_short' : 'elbow90_long'
}

/** 1端の取り出し寸法(mm)と、参照した継手idを求める。 */
export function quickEndAllowance(
  end: QuickEndInput,
  size: string | undefined,
  pipeType: string | undefined,
  vpSeries: 'dv' | 'ts' | undefined,
  connection: string | undefined,
): { mm: number; fittingId?: string } {
  if (end.kind === 'free' || end.basis === 'face') return { mm: 0 }
  const ck = connectionKindOf(pipeType, vpSeries, connection)
  switch (end.kind) {
    case 'elbow90_long':
    case 'elbow90_short':
    case 'elbow45': {
      const id = elbowFittingId(end.kind, ck)
      return { mm: elbowTakeoutById(id, size), fittingId: id }
    }
    case 'tee': {
      const t = teeTakeout(size, end.counterpartSize ?? size, true, ck)
      return { mm: t.mm, fittingId: t.id }
    }
    case 'tee_branch': {
      const t = teeTakeout(end.counterpartSize ?? size, size, false, ck)
      return { mm: t.mm, fittingId: t.id }
    }
    case 'flange':
      return { mm: end.flangeAllow ?? 0 }
    default:
      return { mm: 0 }
  }
}

const MAX_DIGITS_VALUE = 99999

export function computeQuickCut(input: QuickCalcInput): QuickCalcResult {
  if (!input.size) {
    return { startAllow: 0, endAllow: 0, status: 'none', error: 'サイズを選択してください' }
  }

  // 控え寸法は全体寸法の入力前から図に出せるよう、先に求めておく
  const leftBasis = input.left.kind === 'free' ? 'face' : input.left.basis
  const rightBasis = input.right.kind === 'free' ? 'face' : input.right.basis
  const left = quickEndAllowance(
    { ...input.left, basis: leftBasis },
    input.size,
    input.pipeType,
    input.vpSeries,
    input.connection,
  )
  const right = quickEndAllowance(
    { ...input.right, basis: rightBasis },
    input.size,
    input.pipeType,
    input.vpSeries,
    input.connection,
  )
  const startMissing = isMissing(left)
  const endMissing = isMissing(right)
  const allows = {
    startAllow: left.mm,
    endAllow: right.mm,
    startFittingId: left.fittingId,
    endFittingId: right.fittingId,
    startMissing,
    endMissing,
  }

  if (input.overall == null || Number.isNaN(input.overall)) {
    return { ...allows, status: 'none', error: '全体寸法を入力してください' }
  }
  if (input.overall < 0) {
    return { ...allows, status: 'none', error: '全体寸法は0以上で入力してください' }
  }
  if (Math.abs(input.overall) > MAX_DIGITS_VALUE) {
    return { ...allows, status: 'none', error: '5桁を超えました' }
  }

  if (left.mm + right.mm > input.overall) {
    return {
      startAllow: left.mm,
      endAllow: right.mm,
      startFittingId: left.fittingId,
      endFittingId: right.fittingId,
      startMissing,
      endMissing,
      status: 'over',
      error: '全体寸法が継手の控え寸法より短いです',
    }
  }

  const { rawCut, cut, status } = computeCutFromAllowances(
    input.overall,
    left.mm,
    right.mm,
    input.roundMode,
  )
  return {
    startAllow: left.mm,
    endAllow: right.mm,
    startFittingId: left.fittingId,
    endFittingId: right.fittingId,
    startMissing,
    endMissing,
    rawCut,
    cut,
    status,
  }
}

// 継手マスタに該当サイズが無いと elbowTakeoutById/teeTakeout は0を返す。
// 黙って0のまま計算すると切り寸が長くなるので、UIで注意を出せるよう区別する。
function isMissing(end: { mm: number; fittingId?: string }): boolean {
  return end.fittingId != null && end.mm === 0
}

// --- 45°振り(直角三角形)の芯引き ---
// 両端45°エルボのオフセット配管。作図画面と同じ「オフセット量×1.414」で
// 斜辺(芯々)を出し、両端の45°エルボの控えを引いて切り寸法を求める。

export interface Offset45Input {
  pipeType?: string
  size?: string
  connection?: string
  vpSeries?: 'dv' | 'ts'
  /** 入力した値がオフセット量(a=b)か斜辺の芯々(c)か */
  given: 'offset' | 'travel'
  value?: number
  roundMode: RoundMode
}

export interface Offset45Result {
  offset?: number
  travel?: number
  allow: number
  fittingId?: string
  missing?: boolean
  rawCut?: number
  cut?: number
  status: 'none' | 'ok' | 'zero' | 'over'
  error?: string
}

export function computeOffset45(input: Offset45Input): Offset45Result {
  const ck = connectionKindOf(input.pipeType, input.vpSeries, input.connection)
  const fittingId = elbowFittingId('elbow45', ck)
  const allow = input.size ? elbowTakeoutById(fittingId, input.size) : 0
  const base = { allow, fittingId, missing: !!input.size && allow === 0 }
  if (!input.size) return { ...base, status: 'none', error: 'サイズを選択してください' }
  const v = input.value
  if (v == null || Number.isNaN(v)) {
    return { ...base, status: 'none', error: input.given === 'offset' ? 'オフセット寸法を入力してください' : '芯々寸法を入力してください' }
  }
  if (v < 0) return { ...base, status: 'none', error: '0以上で入力してください' }
  if (v > MAX_DIGITS_VALUE) return { ...base, status: 'none', error: '5桁を超えました' }

  const offset = input.given === 'offset' ? v : Math.round((v / OFFSET_45_FACTOR) * 10) / 10
  const travel = input.given === 'travel' ? v : Math.round(v * OFFSET_45_FACTOR * 10) / 10
  if (allow * 2 > travel) {
    return { ...base, offset, travel, status: 'over', error: '寸法が45°エルボの控え寸法より短いです' }
  }
  const { rawCut, cut, status } = computeCutFromAllowances(travel, allow, allow, input.roundMode)
  return { ...base, offset, travel, rawCut, cut, status }
}
