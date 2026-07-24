import type { Point, Segment } from '../types'
import { samePoint, distanceToSegment, distance } from './isometric'
import { getFitting, nominalOf, type TeeDim, type WyeDim } from '../data/masters'
import { getReducerLength } from '../data/reducerLengths'
import { getReducerLengthVpDv } from '../data/reducerLengthsVpDv'
// ノード同一判定の許容誤差(px)
const NODE_EPS = 1

// 45°オフセット計算: 現場の標準手法として「オフセット量×1.414」を斜め区間の
// 芯々寸法として使う(AttributePanel.tsxのオフセット入力欄と同じ係数)。
const OFFSET_45_FACTOR = 1.414

// 45°系継手(45°エルボ・45°Y等)のid。この継手を含む短い連結区間は、実長
// (芯々寸法)が直角二等辺三角形の斜辺(オフセット量×1.414)になる「キック区間」
// として扱う必要がある(下の畳み込み処理で使用)。
function isFortyFiveFitting(id?: string): boolean {
  return (
    id === 'elbow45_long' ||
    id === 'elbow45_socket' ||
    id === 'elbow45_thread' ||
    id === 'elbow45_vp_dv' ||
    id === 'elbow45_vp_ts' ||
    id === 'y45_vp_dv' ||
    id === 'y45_reducing_vp_dv'
  )
}

// このファイルの関数は実効属性のうち size しか参照しないため、
// inheritance.ts の Effective 全体ではなくこの最小限の形で受け取る
// （inheritance.ts 側からも sizeのみのマップで安全に呼べるようにするため）。
export interface SizeInfo {
  size?: string
  pipeType?: string
  vpSeries?: 'dv' | 'ts'
}

export type EndRole =
  | 'free' // 接続なし（芯出し基準）
  | 'straight' // 直管接続（同径・一直線）
  | 'elbow'
  | 'elbow-reducer' // エルボの直後に突き合わせ(継手直結)のレジューサーが続く場合、まとめて1つの取り出しとして扱う
  | 'reducer'
  | 'tee-run'
  | 'tee-run-reducer' // チーズ(ラン)直後にレジューサーで縮径（ツキ合わせ）
  | 'tee-branch'
  | 'wye-run' // Y継手(45°Y・90°大曲りY)の本管側
  | 'wye-run-reducer' // Y継手の本管直後にレジューサーで縮径（ツキ合わせ）
  | 'wye-branch' // Y継手の枝側

export interface EndResult {
  role: EndRole
  /** 差し引く取り出し寸法(mm) */
  mm: number
  /** 参照した継手 id（表示用） */
  fittingId?: string
  /** elbow-reducer のとき、突き合わせレジューサーの相手径（BOM表示用） */
  reducerCounterpart?: string
  /**
   * tee-run/tee-branch のとき、もう一方（run側ならbranch側、branch側ならrun側）の
   * 実サイズ。塩ビ(VP)継手の最短直管長判定など、組み合わせごとに差込み深さが
   * 異なる場合の参照に使う。
   */
  teeCounterpart?: string
  /**
   * レジューサーの面間寸法(H)がマスタ(reducerLengths.ts)に無い組み合わせで、
   * 手入力(reducerLengthOverride)も未設定のとき true。UIはこれを見て
   * 手入力ダイアログを促す。該当しない場合は常にfalse/undefined。
   */
  needsReducerLength?: boolean
  /**
   * wye-run/wye-run-reducer のとき、この区間が45°Y/90°大曲りYの本管の
   * どちら側(枝の直後=near / 枝の手前=far)かが未選択(wyeRole未設定)で
   * 決定できないとき true。近似値へ黙ってフォールバックせず、UIが選択を
   * 促す（本管の両側で控え寸法が大きく異なるため）。
   */
  needsWyeRole?: boolean
}

interface Inc {
  seg: Segment
  end: 'start' | 'end'
  /** セグメント本体→ノードへ向かう単位ベクトル */
  into: Point
  size?: string
  pipeType?: string
  vpSeries?: 'dv' | 'ts'
}
interface GNode {
  p: Point
  incs: Inc[]
  through: Segment[] // このノードを内部通過する線（中間分岐の本管）
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const isElbowId = (id?: string) =>
  id === 'elbow90_short' ||
  id === 'elbow90_long' ||
  id === 'elbow45_long' ||
  id === 'elbow90_socket' ||
  id === 'elbow45_socket' ||
  id === 'elbow90_thread' ||
  id === 'elbow45_thread' ||
  id === 'elbow90_vp_dv' ||
  id === 'elbow90_ll_vp_dv' ||
  id === 'elbow45_vp_dv' ||
  id === 'elbow90_vp_ts' ||
  id === 'elbow45_vp_ts'
const isTeeId = (id?: string) =>
  id === 'tee_equal' ||
  id === 'tee_reducing' ||
  id === 'tee_equal_socket' ||
  id === 'tee_reducing_socket' ||
  id === 'tee_equal_thread' ||
  id === 'tee_reducing_thread' ||
  id === 'tee_equal_vp_dv' ||
  id === 'tee_reducing_vp_dv' ||
  id === 'tee_equal_vp_ts' ||
  id === 'tee_reducing_vp_ts'
export const isReducerId = (id?: string) =>
  id === 'reducer_concentric' ||
  id === 'reducer_eccentric' ||
  id === 'reducer_socket' ||
  id === 'reducer_thread' ||
  id === 'bushing_thread'
// VP-DV排水配管の分岐(Y継手)ファミリー。'tee_equal_vp_dv'/'tee_reducing_vp_dv'は
// マスタにデータが無い(未登録)ため、VP-DVの分岐は必ずこちらのY継手系で計算する。
// 45°Yは明示選択時のみ、それ以外(未選択時)は90°大曲りY(LT)を既定にする
// （現場で大曲り側が標準的に使われ、タイトな90°Y(DT)は今回未登録のため）。
export type WyeFamily = 'y45' | 'y90lt'
const isYId = (id?: string) =>
  id === 'y45_vp_dv' ||
  id === 'y45_reducing_vp_dv' ||
  id === 'y90lt_vp_dv' ||
  id === 'y90lt_reducing_vp_dv'
const wyeFamilyOf = (id?: string): WyeFamily | undefined =>
  id === 'y45_vp_dv' || id === 'y45_reducing_vp_dv'
    ? 'y45'
    : id === 'y90lt_vp_dv' || id === 'y90lt_reducing_vp_dv'
      ? 'y90lt'
      : undefined

function buildGraph(
  segments: Segment[],
  effById: Record<string, SizeInfo>,
): GNode[] {
  const nodes: GNode[] = []
  const findOrAdd = (p: Point) => {
    let n = nodes.find((n) => samePoint(n.p, p, NODE_EPS))
    if (!n) {
      n = { p: { ...p }, incs: [], through: [] }
      nodes.push(n)
    }
    return n
  }
  for (const s of segments) {
    for (const end of ['start', 'end'] as const) {
      const p = end === 'start' ? s.start : s.end
      const other = end === 'start' ? s.end : s.start
      const len = distance(p, other) || 1
      const into = { x: (p.x - other.x) / len, y: (p.y - other.y) / len }
      findOrAdd(p).incs.push({
        seg: s,
        end,
        into,
        size: effById[s.id]?.size,
        pipeType: effById[s.id]?.pipeType,
        vpSeries: effById[s.id]?.vpSeries,
      })
    }
  }
  for (const n of nodes) {
    for (const s of segments) {
      if (samePoint(n.p, s.start, NODE_EPS) || samePoint(n.p, s.end, NODE_EPS)) continue
      if (distanceToSegment(n.p, s.start, s.end) < 1.5) n.through.push(s)
    }
  }
  return nodes
}

// エルボの継手id。自セグメント／隣接セグメントに明示指定があればそれを使い、
// どちらも未指定(自動)なら、管種が塩ビ(VP)ならVP用の継手、いずれかの接続方法が
// 「差込（ソケット）」なら差込式、「ねじ込み」ならねじ込み式、それ以外は
// 突き合わせ溶接(ロング)を既定にする（接続方法を変えても継手が突き合わせ溶接の
// ままになってしまう不具合の修正）。塩ビは接続方法(差込のみ)を選ばせる必要が
// ないため、管種で先に判定する。
function defaultElbowId(inc: Inc, nb?: Inc): string {
  if (isElbowId(inc.seg.fitting)) return inc.seg.fitting as string
  if (isElbowId(nb?.seg.fitting)) return nb!.seg.fitting as string
  if (inc.pipeType === 'vp' || nb?.pipeType === 'vp') {
    const series = inc.vpSeries ?? nb?.vpSeries ?? 'dv'
    return series === 'ts' ? 'elbow90_vp_ts' : 'elbow90_vp_dv'
  }
  const connection = inc.seg.connection ?? nb?.seg.connection
  if (connection === 'socket') return 'elbow90_socket'
  if (connection === 'thread') return 'elbow90_thread'
  return 'elbow90_long'
}

// エルボの取り出し寸法を、継手idとサイズから直接求める（自動判定を経由しない）。
// 作図画面(グラフから自動判定したidで呼ぶ)とクイック計算(明示選択したidで呼ぶ)の
// 両方から使う共通ロジック。
export function elbowTakeoutById(fittingId: string, size?: string): number {
  const nomKey = String(nominalOf(size) ?? '')
  const raw = getFitting(fittingId)?.dims[nomKey]
  return typeof raw === 'number' ? raw : 0
}

// エルボの取り出し寸法（自セグメントのサイズで）
function elbowTakeout(inc: Inc, nb?: Inc): number {
  return elbowTakeoutById(defaultElbowId(inc, nb), inc.size)
}

/**
 * サイズ組み合わせからレジューサー/インクリーザの面間寸法(H)を求める共通ロジック。
 * 管種が塩ビ(VP)のDV継手のときは reducerLengthsVpDv.ts の専用マスタを、
 * それ以外(SUS304突き合わせ溶接等)は reducerLengths.ts の共通マスタを
 * 第一の情報源とし、無ければ手入力値(override、セグメントの
 * reducerLengthOverride)にフォールバックする。どちらにも無ければ H=0 かつ
 * needsInput=true を返し、呼び出し側(UI)が手入力ダイアログを促せるように
 * する（0にフォールバックしたまま黙って計算を続けると、面間寸法が控除
 * されず下流の配管が伸びてしまうため）。
 */
export function resolveReducerH(
  size?: string,
  counterpartSize?: string,
  override?: number,
  pipeType?: string,
  vpSeries?: 'dv' | 'ts',
): { H: number; needsInput: boolean } {
  const a = nominalOf(size)
  const b = nominalOf(counterpartSize)
  if (a == null || b == null) return { H: 0, needsInput: false }
  const tableH =
    pipeType === 'vp' && vpSeries === 'dv' ? getReducerLengthVpDv(a, b) : getReducerLength(a, b)
  if (tableH != null) return { H: tableH, needsInput: false }
  if (override != null) return { H: override, needsInput: false }
  return { H: 0, needsInput: true }
}

// レジューサー/インクリーザの取り出し寸法（大径側=0/小径側=全長H。face基準）を、
// 自分のサイズ・相手径・手入力値(override)から直接求める共通ロジック。
export function reducerTakeoutById(
  size?: string,
  counterpartSize?: string,
  override?: number,
  pipeType?: string,
  vpSeries?: 'dv' | 'ts',
): { mm: number; needsInput: boolean } {
  const a = nominalOf(size)
  const b = nominalOf(counterpartSize)
  if (a == null || b == null) return { mm: 0, needsInput: false }
  const { H, needsInput } = resolveReducerH(size, counterpartSize, override, pipeType, vpSeries)
  const isLarge = a >= b
  return { mm: isLarge ? 0 : H, needsInput: isLarge ? false : needsInput }
}

// レジューサー/インクリーザの取り出し寸法（大径側=0/小径側=全長H。face 基準）
function reducerTakeout(inc: Inc, nb: Inc): { mm: number; id: string; needsInput: boolean } {
  const reducerInc = isReducerId(inc.seg.fitting) ? inc : isReducerId(nb.seg.fitting) ? nb : undefined
  const id = (reducerInc?.seg.fitting as string) ?? 'reducer_concentric'
  const override = reducerInc?.seg.reducerLengthOverride
  const { mm, needsInput } = reducerTakeoutById(
    inc.size,
    nb.size,
    override,
    inc.pipeType,
    inc.vpSeries ?? nb.vpSeries,
  )
  return { mm, id, needsInput }
}

// チーズの取り出し寸法（ラン/枝で C・M を出し分け）。connectionKindで
// 差込式/ねじ込み式/突き合わせ溶接式/塩ビ(DV・TS)の寸法を出し分ける。
// サイズ・接続種別を直接渡す純粋関数のため、作図画面(グラフから判定した値で呼ぶ)と
// クイック計算(明示選択した値で呼ぶ)の両方からそのまま使える。
export type ConnectionKind = 'buttweld' | 'socket' | 'thread' | 'vp_dv' | 'vp_ts'
export function teeTakeout(
  runSize: string | undefined,
  branchSize: string | undefined,
  isRun: boolean,
  connectionKind: ConnectionKind,
): { mm: number; id: string } {
  const runN = nominalOf(runSize)
  const brN = nominalOf(branchSize)
  const reducing = runN != null && brN != null && runN !== brN
  const equalId =
    connectionKind === 'socket'
      ? 'tee_equal_socket'
      : connectionKind === 'thread'
        ? 'tee_equal_thread'
        : connectionKind === 'vp_dv'
          ? 'tee_equal_vp_dv'
          : connectionKind === 'vp_ts'
            ? 'tee_equal_vp_ts'
            : 'tee_equal'
  const reducingId =
    connectionKind === 'socket'
      ? 'tee_reducing_socket'
      : connectionKind === 'thread'
        ? 'tee_reducing_thread'
        : connectionKind === 'vp_dv'
          ? 'tee_reducing_vp_dv'
          : connectionKind === 'vp_ts'
            ? 'tee_reducing_vp_ts'
            : 'tee_reducing'
  const id = reducing ? reducingId : equalId
  let dim: TeeDim | undefined
  if (reducing) {
    dim = getFitting(reducingId)?.dims[`${runN}_${brN}`] as TeeDim | undefined
  } else {
    dim = getFitting(equalId)?.dims[String(runN ?? '')] as TeeDim | undefined
  }
  if (!dim) return { mm: 0, id }
  return { mm: isRun ? dim.run : dim.branch, id }
}

// Y継手(45°Y・90°大曲りY)の取り出し寸法。チーズと違い本管の両側が
// 非対称(枝の分岐角度により芯〜差込み面の距離が異なる)なため、run側は
// さらに near(枝の直後=下流側)/far(枝の手前=上流側)を指定する必要がある。
// role='branch'なら枝側の値を返す（近似不要・一意に決まる）。
export function wyeTakeout(
  runSize: string | undefined,
  branchSize: string | undefined,
  role: 'near' | 'far' | 'branch',
  family: WyeFamily,
): { mm: number; id: string } {
  const runN = nominalOf(runSize)
  const brN = nominalOf(branchSize)
  const reducing = runN != null && brN != null && runN !== brN
  const equalId = family === 'y45' ? 'y45_vp_dv' : 'y90lt_vp_dv'
  const reducingId = family === 'y45' ? 'y45_reducing_vp_dv' : 'y90lt_reducing_vp_dv'
  const id = reducing ? reducingId : equalId
  let dim: WyeDim | undefined
  if (reducing) {
    dim = getFitting(reducingId)?.dims[`${runN}_${brN}`] as WyeDim | undefined
  } else {
    dim = getFitting(equalId)?.dims[String(runN ?? '')] as WyeDim | undefined
  }
  if (!dim) return { mm: 0, id }
  const mm = role === 'branch' ? dim.branch : role === 'near' ? dim.near : dim.far
  return { mm, id }
}

// ノードの本管(run)軸のサイズ。貫通線・同一直線ペアのうち最大径を本管ヘッダ径とする。
// （途中でレジューサーにより縮径していても、チーズ本体の呼びは大径側で決まるため）
function runAxisSize(
  node: GNode,
  effById: Record<string, SizeInfo>,
): string | undefined {
  const candidates: (string | undefined)[] = []
  for (const t of node.through) candidates.push(effById[t.id]?.size)
  for (let i = 0; i < node.incs.length; i++) {
    for (let j = i + 1; j < node.incs.length; j++) {
      if (dot(node.incs[i].into, node.incs[j].into) < -0.9) {
        candidates.push(node.incs[i].size, node.incs[j].size)
      }
    }
  }
  let best: string | undefined
  let bestN = -1
  for (const c of candidates) {
    const n = nominalOf(c)
    if (n != null && n > bestN) {
      bestN = n
      best = c
    }
  }
  return best
}

// 同心レジューサーの全長 H（大径→小径の縮径分）。本管軸上で径が変わる継手接続に足す。
function reducerHmm(large?: string, small?: string, pipeType?: string, vpSeries?: 'dv' | 'ts'): number {
  return resolveReducerH(large, small, undefined, pipeType, vpSeries).H
}

function resolveEnd(
  inc: Inc,
  node: GNode,
  effById: Record<string, SizeInfo>,
): EndResult {
  const others = node.incs.filter((i) => i.seg.id !== inc.seg.id)
  const throughs = node.through.filter((t) => t.id !== inc.seg.id)
  const degree = node.incs.length + 2 * throughs.length

  if (others.length === 0 && throughs.length === 0) {
    return { role: 'free', mm: 0 }
  }

  // 分岐（3方向以上、または本管の途中に接続＝中間分岐）
  if (degree >= 3) {
    // このセグメントが本管(run)方向か？（反対向きの端点隣接、または本管通過に平行）
    const opposite = others.find((o) => dot(inc.into, o.into) < -0.9)
    let throughParallel = false
    if (throughs.length > 0) {
      const t = throughs[0]
      const tlen = distance(t.start, t.end) || 1
      const tdir = { x: (t.end.x - t.start.x) / tlen, y: (t.end.y - t.start.y) / tlen }
      throughParallel = Math.abs(dot(inc.into, tdir)) > 0.9
    }
    const isRun = Boolean(opposite) || throughParallel
    // 本管軸のヘッダ径（最大径）。枝側は自分のサイズ。
    // 「メイン管サイズ／枝管サイズ」欄で実サイズを直接編集する方式にしたため、
    // ここは常に実際のジオメトリ(隣接セグメントの実サイズ)から求める。
    const runSize = runAxisSize(node, effById) ?? inc.size
    const branchInc = others.find((o) => Math.abs(dot(inc.into, o.into)) < 0.9)
    const branchSize = isRun ? (branchInc?.size ?? inc.size) : inc.size
    // このノードのいずれかの脚にチーズ継手が明示されていればそれに従う（突き合わせ/差込/ねじ込みとも）。
    // どの脚にも明示指定がなければ、いずれかの脚の接続方法から差込式/ねじ込み式の寸法を選ぶ
    // （接続方法を変えても継手が突き合わせ溶接のままになってしまう不具合の修正）。
    const explicitTeeId = node.incs.map((i) => i.seg.fitting).find(isTeeId)
    const connectionKind: ConnectionKind = explicitTeeId
      ? explicitTeeId.endsWith('_socket')
        ? 'socket'
        : explicitTeeId.endsWith('_thread')
          ? 'thread'
          : explicitTeeId.endsWith('_vp_dv')
            ? 'vp_dv'
            : explicitTeeId.endsWith('_vp_ts')
              ? 'vp_ts'
              : 'buttweld'
      : node.incs.some((i) => i.pipeType === 'vp')
        ? node.incs.some((i) => i.vpSeries === 'ts')
          ? 'vp_ts'
          : 'vp_dv'
        : node.incs.some((i) => i.seg.connection === 'socket')
          ? 'socket'
          : node.incs.some((i) => i.seg.connection === 'thread')
            ? 'thread'
            : 'buttweld'
    // VP-DV(塩ビ・DV継手)の排水配管は、突き合わせ/差込/ねじ込みのチーズと違い
    // 45°Y・90°大曲りY(LT)というY継手系で分岐する。'tee_equal_vp_dv'/
    // 'tee_reducing_vp_dv' はマスタにデータが無いため使わない。
    if (connectionKind === 'vp_dv') {
      const explicitYFitting = node.incs.map((i) => i.seg.fitting).find(isYId)
      const family: WyeFamily = wyeFamilyOf(explicitYFitting) ?? 'y90lt'
      if (!isRun) {
        const w = wyeTakeout(runSize, branchSize, 'branch', family)
        return { role: 'wye-branch', mm: w.mm, fittingId: w.id, teeCounterpart: runSize }
      }
      // 本管側は枝の直後(near)/手前(far)で控え寸法が大きく異なり、幾何学的に
      // 自動判定できないため明示選択(wyeRole)が必要。自分に未設定でも、反対側の
      // 本管区間に設定があればその逆を採用する（両側どちらから選んでもよい）。
      const oppositeRole = opposite?.seg.wyeRole
      const myRole = inc.seg.wyeRole ?? (oppositeRole === 'near' ? 'far' : oppositeRole === 'far' ? 'near' : undefined)
      let mm: number
      let fittingId: string
      let needsWyeRole = false
      if (myRole) {
        const w = wyeTakeout(runSize, branchSize, myRole, family)
        mm = w.mm
        fittingId = w.id
      } else {
        mm = 0
        fittingId = family === 'y45' ? 'y45_vp_dv' : 'y90lt_vp_dv'
        needsWyeRole = true
      }
      let role: EndRole = 'wye-run'
      // Y継手本管直後にレジューサーで縮径（ツキ合わせ）。チーズ(tee-run-reducer)と同じ考え方。
      const rn = nominalOf(runSize)
      const an = nominalOf(inc.size)
      if (rn != null && an != null && an < rn) {
        mm += reducerHmm(runSize, inc.size, inc.pipeType, inc.vpSeries)
        role = 'wye-run-reducer'
      }
      return {
        role,
        mm,
        fittingId,
        teeCounterpart: branchSize,
        needsWyeRole: needsWyeRole || undefined,
      }
    }

    const t = teeTakeout(runSize, branchSize, isRun, connectionKind)
    let mm = t.mm
    let role: EndRole = isRun ? 'tee-run' : 'tee-branch'
    // 本管(run)アームが本管ヘッダ径より小さい＝チーズ直後にレジューサーで縮径
    // （ツキ合わせ／パイプ0mmでチーズと直結）。tee-run 取り出しにレジューサー分を加算。
    if (isRun) {
      const rn = nominalOf(runSize)
      const an = nominalOf(inc.size)
      if (rn != null && an != null && an < rn) {
        mm += reducerHmm(runSize, inc.size, inc.pipeType, inc.vpSeries)
        role = 'tee-run-reducer'
      }
    }
    return {
      role,
      mm,
      fittingId: t.id,
      teeCounterpart: isRun ? branchSize : runSize,
    }
  }

  // 次数2：端点隣接1本
  const nb = others[0]
  if (!nb) return { role: 'free', mm: 0 }
  const straight = dot(inc.into, nb.into) < -0.9
  if (straight) {
    const a = nominalOf(inc.size)
    const b = nominalOf(nb.size)
    if (a != null && b != null && a !== b) {
      const r = reducerTakeout(inc, nb)
      return { role: 'reducer', mm: r.mm, fittingId: r.id, needsReducerLength: r.needsInput }
    }
    return { role: 'straight', mm: 0 }
  }
  return { role: 'elbow', mm: elbowTakeout(inc, nb), fittingId: defaultElbowId(inc, nb) }
}

export interface SegEnds {
  start: EndResult
  end: EndResult
}

/** 全セグメントの端ごとの取り出し寸法を計算 */
export function computeEnds(
  segments: Segment[],
  effById: Record<string, SizeInfo>,
): Record<string, SegEnds> {
  const nodes = buildGraph(segments, effById)
  const nodeAt = (p: Point) => nodes.find((n) => samePoint(n.p, p, NODE_EPS))!
  const out: Record<string, SegEnds> = {}
  for (const s of segments) {
    const startNode = nodeAt(s.start)
    const endNode = nodeAt(s.end)
    const startInc = startNode.incs.find((i) => i.seg.id === s.id && i.end === 'start')!
    const endInc = endNode.incs.find((i) => i.seg.id === s.id && i.end === 'end')!
    out[s.id] = {
      start: resolveEnd(startInc, startNode, effById),
      end: resolveEnd(endInc, endNode, effById),
    }
  }

  // 突き合わせ(継手直結のまま)のレジューサーがエルボの直後に続く場合、現場の
  // 考え方（突き合わせレジューサーは隣の異形パイプの一部）に合わせて、その先の
  // 取り出し寸法もまとめてエルボ側の取り出し寸法へ折り込む。レジューサー側に
  // 実際にパイプを足していれば(芯々寸法が突き合わせ既定値より大きい)折り込まない。
  // レジューサー分割で生じる寸法もサイズも持たない極小の中間区間(透過区間)を
  // 挟んでいる場合は、そこを透過してレジューサーまでたどる。
  const isPhantomSeg = (seg: Segment) =>
    !seg.size && !seg.fitting && seg.centerLength == null

  // 折り込んだ経路上の端は、BOM 集計で二重計上されないよう別途 'straight'
  // へ差し替える（切り寸法計算に使う mm 値はここでは変えない。抑制のみ最後に適用）。
  const suppressed = new Set<string>()

  for (const s of segments) {
    for (const end of ['start', 'end'] as const) {
      const result = out[s.id][end]
      if (result.role !== 'elbow') continue
      const p = end === 'start' ? s.start : s.end
      const node = nodeAt(p)
      let nb = node.incs.find((i) => i.seg.id !== s.id)
      const visited = new Set<string>([s.id])
      const path: string[] = []
      let found: Inc | undefined
      while (nb) {
        if (visited.has(nb.seg.id)) break
        visited.add(nb.seg.id)
        // このセグメントにレジューサーの継手が付いていても、今たどり着いた側の
        // 端が実際にサイズの変わる直線接続(role:'reducer')でなければ、単なる
        // 反対側のエルボ(同径)なので折り込み対象にしない。
        if (out[nb.seg.id]?.[nb.end]?.role === 'reducer') {
          found = nb
          path.push(`${nb.seg.id}:${nb.end}`)
          break
        }
        if (!isPhantomSeg(nb.seg)) break
        // 透過区間自体は継手を持たないため、両端ともBOMでは対象外にする
        path.push(`${nb.seg.id}:start`, `${nb.seg.id}:end`)
        const farEnd = nb.end === 'start' ? 'end' : 'start'
        const farPoint = farEnd === 'start' ? nb.seg.start : nb.seg.end
        const farNode = nodeAt(farPoint)
        const farOthers = farNode.incs.filter((i) => i.seg.id !== nb!.seg.id)
        nb = farOthers.length === 1 ? farOthers[0] : undefined
      }
      if (!found) continue
      const nbEnds = out[found.seg.id]
      if (!nbEnds) continue
      const nbOwnMm = nbEnds.start.mm + nbEnds.end.mm
      const nbCenter = found.seg.centerLength
      const stillDefault = nbCenter == null || Math.abs(nbCenter - nbOwnMm) < 0.6
      if (!stillDefault) continue
      out[s.id][end] = {
        ...result,
        role: 'elbow-reducer',
        mm: result.mm + nbOwnMm,
        reducerCounterpart: found.size,
      }
      for (const key of path) suppressed.add(key)
    }
  }

  for (const key of suppressed) {
    const sep = key.lastIndexOf(':')
    const segId = key.slice(0, sep)
    const end = key.slice(sep + 1) as 'start' | 'end'
    if (out[segId]?.[end]) {
      out[segId][end] = { ...out[segId][end], role: 'straight' }
    }
  }

  // 45°Yなど分岐継手の直後に、勾配を表現するためだけに角度を付けて描いた
  // 「中間の折れ点」(継手・サイズ・芯々寸法を持たない透過区間)を挟んでいる
  // 場合、その折れ点は実在の継手ではないため、自動判定でエルボの取り出し
  // 寸法を控除してしまわないようにする。これにより、45°Yの芯から折れ点を
  // 経由して次の継手の芯までを、折れ点側の区間には何も入力せず、ひとつの
  // 芯々寸法(次の継手側の区間の芯々寸法)としてそのまま入力できる。
  // ※ エルボtoエルボの畳み込み(下のキック区間処理)やレジューサー畳み込み
  //    (上の処理)とは独立のケースのため、既存の折り込みロジックには影響しない。
  for (const s of segments) {
    for (const end of ['start', 'end'] as const) {
      const result = out[s.id][end]
      if (result.role !== 'elbow') continue
      const p = end === 'start' ? s.start : s.end
      const node = nodeAt(p)
      let cur = node.incs.find((i) => i.seg.id !== s.id)
      const visited = new Set<string>([s.id])
      let reachedWye = false
      while (cur) {
        if (visited.has(cur.seg.id)) break
        visited.add(cur.seg.id)
        if (!isPhantomSeg(cur.seg)) break
        const farEnd = cur.end === 'start' ? 'end' : 'start'
        const farRole = out[cur.seg.id]?.[farEnd]?.role
        if (farRole === 'wye-run' || farRole === 'wye-run-reducer' || farRole === 'wye-branch') {
          reachedWye = true
          break
        }
        const farPoint = farEnd === 'start' ? cur.seg.start : cur.seg.end
        const farNode = nodeAt(farPoint)
        const farOthers = farNode.incs.filter((i) => i.seg.id !== cur!.seg.id)
        cur = farOthers.length === 1 ? farOthers[0] : undefined
      }
      if (reachedWye) {
        out[s.id][end] = { role: 'straight', mm: 0 }
      }
    }
  }

  // エルボtoエルボの短い「オフセットのキック」区間（45°等でオフセットを取るための
  // 短い連結配管）を、隣接する長い区間の芯先/芯々計算へ自動的に畳み込む。
  // 現場では「1000」等の寸法を手前の基準点（本来1本エルボだった位置）から
  // 先端まで測るため、途中に挟まる短いキック区間の分も先端側の取り出し
  // 寸法へ合算しないと、切り寸が実際より長く出てしまう。キック区間自体に
  // オフセット寸法欄などで独自の切り寸（正の値）が付いていても、その区間は
  // あくまで基準点〜先端の一連の測り方の途中にすぎないため、畳み込みは
  // キック区間の切り寸の有無に関わらず常に行う。
  // ただし畳み込むのは「45°エルボ側」だけ（この区間自身の継手が明示的に
  // elbow45_long のとき）。90°エルボ側は、キックが挟まる前と変わらない
  // ごく普通の基準点として扱い、そちら側の隣接区間まで畳み込むと、90°側の
  // 区間の寸法が意図せず縮んでしまう（90°側は元々どおり単独の取り出しのみでよい）。
  //
  // 畳み込む量は「基準点(本来1本エルボだった位置)から見て、元の軸方向に
  // どれだけ進んだか」であって、キック区間自身の実長(斜辺)ではない。
  // キック区間が45°系継手を含む(=直角二等辺三角形の斜辺として
  // オフセット量×1.414で芯々が算出されている)場合、実長のまま畳み込むと
  // 1:1:√2の「√2」(斜辺の実長)を「1」(軸方向の進み=オフセット量)の代わりに
  // 使ってしまい、控除しすぎて切り寸が短く出てしまう。そのためこの場合は
  // 1.414で割り戻し、軸方向の進み(オフセット量)だけを畳み込む。45°系を
  // 含まない(斜めではない)短い連結区間は、実長がそのまま軸方向の進みと
  // 一致するため、従来通り実長をそのまま畳み込む。
  for (const s of segments) {
    if (s.fitting !== 'elbow45_long') continue
    for (const end of ['start', 'end'] as const) {
      const result = out[s.id][end]
      if (result.role !== 'elbow') continue
      const p = end === 'start' ? s.start : s.end
      const node = nodeAt(p)
      const nb = node.incs.find((i) => i.seg.id !== s.id)
      if (!nb || nb.seg.centerLength == null) continue
      const nbEnds = out[nb.seg.id]
      if (!nbEnds) continue
      const nbOtherEnd = nb.end === 'start' ? 'end' : 'start'
      if (nbEnds[nb.end].role !== 'elbow' || nbEnds[nbOtherEnd].role !== 'elbow') continue
      const nbIsDiagonalKick =
        isFortyFiveFitting(nbEnds[nb.end].fittingId) ||
        isFortyFiveFitting(nbEnds[nbOtherEnd].fittingId)
      const foldLen = nbIsDiagonalKick
        ? nb.seg.centerLength / OFFSET_45_FACTOR
        : nb.seg.centerLength
      out[s.id][end] = { ...result, mm: result.mm + foldLen }
    }
  }

  return out
}

/** 分岐(チーズ)の「メイン管／枝管」情報。パネルでの直接編集用。 */
export interface TeeContext {
  /** 選択中セグメント自身がメイン管(本管)側か（false なら枝管側） */
  selectedIsMain: boolean
  /** メイン管を構成するセグメントid（貫通なら1つ、端点2本構成なら2つ） */
  mainSegIds: string[]
  /** メイン管の実効サイズ（未確定なら undefined） */
  mainSize?: string
  /** 枝管セグメントのid */
  branchSegId?: string
  /** 枝管の実効サイズ */
  branchSize?: string
}

/**
 * 指定セグメントが分岐(チーズ)ノードに接続していれば、その「メイン管／枝管」の
 * 構成セグメントとサイズを返す。両端とも分岐でなければ undefined。
 * パネルで「メイン管サイズ／枝管サイズ」を直接編集できるようにするための情報源。
 */
export function findTeeContext(
  segments: Segment[],
  effById: Record<string, SizeInfo>,
  segmentId: string,
): TeeContext | undefined {
  const nodes = buildGraph(segments, effById)
  const seg = segments.find((s) => s.id === segmentId)
  if (!seg) return undefined

  for (const end of ['start', 'end'] as const) {
    const p = end === 'start' ? seg.start : seg.end
    const node = nodes.find((n) => samePoint(n.p, p, NODE_EPS))
    if (!node) continue
    const inc = node.incs.find((i) => i.seg.id === segmentId && i.end === end)
    if (!inc) continue
    const others = node.incs.filter((i) => i.seg.id !== segmentId)
    const throughs = node.through.filter((t) => t.id !== segmentId)
    const degree = node.incs.length + 2 * throughs.length
    if (degree < 3) continue

    const opposite = others.find((o) => dot(inc.into, o.into) < -0.9)
    const throughSeg = throughs[0]
    let throughParallel = false
    if (throughSeg) {
      const tlen = distance(throughSeg.start, throughSeg.end) || 1
      const tdir = {
        x: (throughSeg.end.x - throughSeg.start.x) / tlen,
        y: (throughSeg.end.y - throughSeg.start.y) / tlen,
      }
      throughParallel = Math.abs(dot(inc.into, tdir)) > 0.9
    }
    // 自分(inc)が本管方向か＝自分と正反対のincがある、または貫通線と平行
    const selectedIsMain = Boolean(opposite) || throughParallel

    const mainSegIds = new Set<string>()
    let branchSegId: string | undefined
    let branchSize: string | undefined

    if (selectedIsMain) {
      // 自分がメイン管側 → 自分 + 自分と正反対のセグメント(+貫通線)がメイン管
      mainSegIds.add(segmentId)
      if (opposite) mainSegIds.add(opposite.seg.id)
      if (throughSeg) mainSegIds.add(throughSeg.id)
      const branchInc = others.find((o) => Math.abs(dot(inc.into, o.into)) < 0.9)
      branchSegId = branchInc?.seg.id
      branchSize = branchInc?.size
    } else {
      // 自分が枝管側 → 自分以外(others)の中から、互いに正反対のペア(または貫通線)を
      // 総当たりで探す（「自分から見て反対」ではなく、他のセグメント同士の関係を見る）。
      if (throughSeg) {
        mainSegIds.add(throughSeg.id)
      } else {
        outer: for (let i = 0; i < others.length; i++) {
          for (let j = i + 1; j < others.length; j++) {
            if (dot(others[i].into, others[j].into) < -0.9) {
              mainSegIds.add(others[i].seg.id)
              mainSegIds.add(others[j].seg.id)
              break outer
            }
          }
        }
      }
      branchSegId = segmentId
      branchSize = inc.size
    }

    return {
      selectedIsMain,
      mainSegIds: [...mainSegIds],
      mainSize: runAxisSize(node, effById),
      branchSegId,
      branchSize,
    }
  }
  return undefined
}

export { isTeeId }
