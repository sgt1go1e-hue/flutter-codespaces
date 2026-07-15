import pipesJson from './pipes.json'
import fittingsJson from './fittings.json'

// --- 型定義 ---
export interface PipeType {
  id: string
  name: string
  short: string
  sizes: string[]
}

export interface SizeInfo {
  code: string
  label: string
  od: number
}

// 継手の計算方式
export type FittingCalc = 'centerMinus' | 'overall' | 'endDepth' | 'none'
// dims の値: エルボ/キャップ=数値, チーズ={run,branch}, レジューサー={H,od1,od2}
export type TeeDim = { run: number; branch: number }
export type ReducerDim = { H: number; od1: number | null; od2: number | null }
export type DimValue = number | TeeDim | ReducerDim

export interface Fitting {
  id: string
  name: string
  short: string
  calc: FittingCalc
  source: string | null
  drawingNo: string | null
  /** キー: 単一=呼び径A(例"25") / 径違いチーズ="ラン_枝" / レジューサー="大径_小径" */
  dims: Record<string, DimValue>
}

// --- マスタデータ ---
export const pipeTypes = pipesJson.pipeTypes as PipeType[]
export const sizeList = pipesJson.sizeList as SizeInfo[]
export const fittings = fittingsJson.fittings as Fitting[]

/** 呼び径コード("25A"或いは塩ビの"VP25")→ 呼称の数値(25)。 */
export function nominalOf(sizeCode?: string): number | null {
  if (!sizeCode) return null
  const m = /^(\d+)A$/.exec(sizeCode) ?? /^VP(\d+)$/.exec(sizeCode)
  return m ? Number(m[1]) : null
}

/** 外径(OD, mm)を呼び径コードから取得 */
export function odOf(sizeCode?: string): number | undefined {
  return getSizeInfo(sizeCode)?.od
}

// --- 接続方法（接合方法）マスタ ---
export interface ConnectionMethod {
  id: string
  name: string
}

export const connectionMethods: ConnectionMethod[] = [
  { id: 'weld', name: '溶接' },
  { id: 'thread', name: 'ねじ込み' },
  { id: 'socket', name: '差込（ソケット）' },
  { id: 'flange', name: 'フランジ接合' },
]

export function getConnectionMethod(id?: string): ConnectionMethod | undefined {
  return connectionMethods.find((c) => c.id === id)
}

/** 継手マスタの source(例: "inoc_SUS304_buttweld")から接続方法(溶接/ねじ込み等)を推定する */
export function connectionLabelForSource(source?: string | null): string {
  if (!source) return '—'
  if (source.includes('buttweld')) return '溶接'
  if (source.includes('thread')) return 'ねじ込み'
  if (source.includes('socket')) return '差込（ソケット）'
  return '—'
}

/** セグメントの接続方法(connection)からフランジの品名を決める。ねじ込み以外は溶接フランジ扱い */
export function flangeLabelForConnection(connection?: string): string {
  return connection === 'thread' ? 'ねじ込みフランジ' : '溶接フランジ'
}

// --- 参照ヘルパー ---
export function getPipeType(id?: string): PipeType | undefined {
  return pipeTypes.find((p) => p.id === id)
}

export function getSizeInfo(code?: string): SizeInfo | undefined {
  return sizeList.find((s) => s.code === code)
}

export function getFitting(id?: string): Fitting | undefined {
  return fittings.find((f) => f.id === id)
}

/** ある管種で使える呼び径の一覧（管種未選択なら全サイズ） */
export function sizesForPipeType(pipeTypeId?: string): SizeInfo[] {
  const pt = getPipeType(pipeTypeId)
  if (!pt) return sizeList
  return pt.sizes
    .map((code) => getSizeInfo(code))
    .filter((s): s is SizeInfo => !!s)
}

/** 鋼管サイズ列で1段小さい呼び径コードを返す（無ければ元のまま） */
export function nextSmallerSize(code?: string): string | undefined {
  if (!code) return undefined
  const steel = getPipeType('sgp')?.sizes ?? []
  const i = steel.indexOf(code)
  if (i > 0) return steel[i - 1]
  return code
}

/**
 * レジューサーを置くときの既定の小径を返す。呼び径の並び上「1段小さい」
 * サイズ（nextSmallerSize）は、実際のレジューサー規格には存在しない組み合わせ
 * のことがある（例: 100A→90A は規格に無い）。その場合、取り出し寸法(H)が
 * 0として扱われてしまい、芯々寸法の自動計算が壊れる。そのため、レジューサー
 * の実カタログ(fittings.json)に実在する組み合わせのうち、最も大径寄り
 * （＝最も一般的な1段落とし）の小径を優先して選ぶ。
 */
export function nextReducerSize(largeCode?: string): string | undefined {
  const largeN = nominalOf(largeCode)
  if (largeN == null) return nextSmallerSize(largeCode)
  const dims = getFitting('reducer_concentric')?.dims ?? {}
  let best: number | undefined
  for (const key of Object.keys(dims)) {
    const [l, s] = key.split('_').map(Number)
    if (l === largeN && (best == null || s > best)) best = s
  }
  return best != null ? `${best}A` : nextSmallerSize(largeCode)
}

/** レジューサーの大径_小径キー（2つの呼び径コードから、大→小の順で組む） */
export function reducerKey(sizeCodeA?: string, sizeCodeB?: string): string | undefined {
  const a = nominalOf(sizeCodeA)
  const b = nominalOf(sizeCodeB)
  if (a == null || b == null) return undefined
  const large = Math.max(a, b)
  const small = Math.min(a, b)
  return `${large}_${small}`
}
