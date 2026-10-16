// クイック計算の「引しろ表」用。継手マスタ(fittings.json)をそのまま読み、
// 接続方式ごとの継手一覧・サイズ一覧・表示用の寸法を組み立てる。
// 数値はマスタの値をそのまま出す(作図・芯引きと同じ値)。
import { fittings, type Fitting, type DimValue } from '../data/masters'
import type { ConnectionKind } from './takeout'

export interface FittingGroup {
  kind: ConnectionKind
  label: string
  /** 出典の表示名 */
  maker: string
}

export const FITTING_GROUPS: FittingGroup[] = [
  { kind: 'buttweld', label: '溶接', maker: 'イノック SUS304 突合せ溶接' },
  { kind: 'thread', label: 'ねじ込み', maker: 'JIS B2301 ねじ込み式（桑名・リケン）' },
  { kind: 'socket', label: '差込', maker: '日本ジョイント 差込溶接 SCH80' },
  { kind: 'vp_dv', label: '塩ビDV', maker: '積水 エスロン DV継手' },
  { kind: 'vp_ts', label: '塩ビTS', maker: 'クボタケミックス TS継手' },
]

export function groupOfSource(source?: string | null): ConnectionKind | undefined {
  if (!source) return undefined
  if (source.includes('buttweld')) return 'buttweld'
  if (source.includes('socket')) return 'socket'
  if (source.includes('thread')) return 'thread'
  if (source.includes('_dv_')) return 'vp_dv'
  if (source.includes('_ts_')) return 'vp_ts'
  return undefined
}

// よく使う順（ロングをショートより先に）
const ORDER = ['elbow90_long', 'elbow90_short', 'elbow45_long', 'elbow45_short']

export function fittingsOfGroup(kind: ConnectionKind): Fitting[] {
  const rank = (f: Fitting) => {
    const i = ORDER.indexOf(f.id)
    return i < 0 ? ORDER.length : i
  }
  return fittings
    .filter((f) => groupOfSource(f.source) === kind && Object.keys(f.dims).length > 0)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => f)
}

/** 継手のボタン用の短い名前（接続方式の注記は外し、同径/径違いは残す） */
export function fittingChipLabel(f: Fitting): string {
  return f.name.replace(/（([^）]*)）/g, (_m, inner: string) => {
    if (/^(ロング|ショート)$/.test(inner)) return `（${inner}）`
    if (inner.includes('同径')) return '（同径）'
    if (inner.includes('径違い')) return '（径違い）'
    if (inner.startsWith('LL')) return ''
    if (inner.startsWith('LT')) return ''
    return ''
  })
}

/** 絵の種類 */
export type FittingShape = 'elbow90' | 'elbow45' | 'tee' | 'reducer' | 'cap' | 'wye45' | 'wye90'

export function shapeOf(f: Fitting): FittingShape {
  if (f.id.startsWith('elbow45')) return 'elbow45'
  if (f.id.startsWith('elbow90')) return 'elbow90'
  if (f.id.startsWith('tee')) return 'tee'
  if (f.id.startsWith('y45')) return 'wye45'
  if (f.id.startsWith('y90')) return 'wye90'
  if (f.id === 'cap') return 'cap'
  return 'reducer'
}

const INCH: Record<string, string> = {
  '10': '3/8B',
  '15': '1/2B',
  '20': '3/4B',
  '25': '1B',
  '32': '1-1/4B',
  '40': '1-1/2B',
  '50': '2B',
  '65': '2-1/2B',
  '80': '3B',
  '90': '3-1/2B',
  '100': '4B',
  '125': '5B',
  '150': '6B',
  '200': '8B',
  '250': '10B',
  '300': '12B',
  '350': '14B',
  '400': '16B',
  '450': '18B',
  '500': '20B',
  '550': '22B',
  '600': '24B',
}

const isVp = (kind?: ConnectionKind) => kind === 'vp_dv' || kind === 'vp_ts'

/** 呼び径の数値("40")→表示("40A" / 塩ビは "VP40") */
export function nominalLabel(n: string, kind?: ConnectionKind): string {
  return isVp(kind) ? `VP${n}` : `${n}A`
}

/** インチ表記(鋼管のみ)。無ければ空文字 */
export function inchLabel(n: string, kind?: ConnectionKind): string {
  return isVp(kind) ? '' : (INCH[n] ?? '')
}

/** dimsのキー("40" / "40_25")を表示用に("40A" / "40A×25A") */
export function dimKeyLabel(key: string, kind?: ConnectionKind): string {
  return key
    .split('_')
    .map((n) => nominalLabel(n, kind))
    .join('×')
}

export interface DimRow {
  label: string
  value: string
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : String(n))

/** 寸法1件を「名前: 値」の並びにする（表と絵の両方で使う） */
export function dimRows(f: Fitting, value: DimValue | undefined): DimRow[] {
  if (value == null) return []
  if (typeof value === 'number') {
    return [{ label: f.id === 'cap' ? '高さ' : '引しろ', value: fmt(value) }]
  }
  if ('run' in value) {
    return [
      { label: 'ラン', value: fmt(value.run) },
      { label: '枝', value: fmt(value.branch) },
    ]
  }
  if ('near' in value) {
    return [
      { label: '下流', value: fmt(value.near) },
      { label: '上流', value: fmt(value.far) },
      { label: '枝', value: fmt(value.branch) },
    ]
  }
  return [{ label: '面間H', value: fmt(value.H) }]
}

/** 表の見出し（全行同じ並びになる） */
export function dimHeaders(f: Fitting): string[] {
  const first = Object.values(f.dims)[0]
  return dimRows(f, first).map((r) => r.label)
}
