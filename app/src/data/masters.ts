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

export interface Fitting {
  id: string
  name: string
  short: string
  /** 呼び径コード -> 中心〜端面寸法(mm)。センターマイナス寸法。 */
  centerToFace: Record<string, number>
}

// --- マスタデータ ---
export const pipeTypes = pipesJson.pipeTypes as PipeType[]
export const sizeList = pipesJson.sizeList as SizeInfo[]
export const fittings = fittingsJson.fittings as Fitting[]

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

/** 継手の中心〜端面寸法(mm)を取得（未登録サイズは undefined） */
export function centerToFace(fittingId?: string, sizeCode?: string): number | undefined {
  if (!fittingId || !sizeCode) return undefined
  const f = getFitting(fittingId)
  if (!f) return undefined
  return f.centerToFace[sizeCode]
}
