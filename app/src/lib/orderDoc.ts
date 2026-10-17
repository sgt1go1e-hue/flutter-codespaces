// 発注書 / 見積もり依頼書に載せる明細行の組み立て。
//
// 既存のBOM集計(lib/bom.ts)には手を入れない。継手・フランジの個数は
// computeBom の結果をそのまま流用し、直管(パイプ)だけは
//   「切り寸法の一覧 → 定尺の必要本数(stockCount.ts)」
// に置き換えてこちら側で集計し直す(発注は切り出し本数ではなく定尺の
// 本数で行うため)。単価・金額・メーカーは一切扱わない。

import type { Segment } from '../types'
import type { Effective } from './inheritance'
import type { CutResult } from './cutlength'
import type { Bom } from './bom'
import { getPipeType, nominalOf } from '../data/masters'
import { calcStockCount, DEFAULT_KERF_MM } from './stockCount'

/** 帳票の種類。宛先欄・日付欄の見出しと文面だけが変わる。 */
export type OrderDocKind = 'order' | 'quote'

/** 帳票ごとの文言。見た目(字間)はCSSのletter-spacingで付ける。 */
export const ORDER_DOC_TEXT: Record<
  OrderDocKind,
  {
    title: string
    /** 宛先の下に置く1行リード文 */
    lead: string
    /** 発行日のラベル */
    dateLabel: string
    /** 書類番号の接頭辞 */
    docNoPrefix: string
    /** 書類番号のラベル */
    docNoLabel: string
    /** 明細表の直下に置く注記1行 */
    note: string
    /** 希望日欄のラベル */
    wantDateLabel: string
  }
> = {
  order: {
    title: '発注書',
    lead: '下記の通り発注いたしますので、よろしくお願い申し上げます。',
    dateLabel: '発注年月日',
    docNoPrefix: 'ORD',
    docNoLabel: '発注書No.',
    note: '※本発注書に金額は記載しておりません。価格については別途ご確認をお願いいたします。',
    wantDateLabel: '納品希望日',
  },
  quote: {
    title: '御見積依頼書',
    lead: '下記の通りお見積りをお願いいたします。',
    dateLabel: '見積依頼年月日',
    docNoPrefix: 'EST',
    docNoLabel: '見積依頼書No.',
    note: '※数量は現場変更により前後する場合がございます。あらかじめご了承ください。',
    wantDateLabel: 'ご回答希望日',
  },
}

/** 書類番号。日付＋連番の形式(例: ORD-20260901-01)。 */
export function makeDocNo(kind: OrderDocKind, d: Date = new Date(), serial = 1): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${ORDER_DOC_TEXT[kind].docNoPrefix}-${y}${m}${day}-${String(serial).padStart(2, '0')}`
}

/** 帳票の入力項目(ユーザーが都度入れるもの)。 */
export interface OrderDocMeta {
  /** 宛先(取引先名)。「御中」は帳票側で付ける。 */
  toName: string
  /** 現場名。既定はフォルダ名を入れておく。 */
  siteName: string
  /** 発注書=納品希望日 / 見積依頼書=ご回答希望日。'YYYY-MM-DD' か自由文。 */
  wantDate: string
  /** 発注書のみ: 納品場所。 */
  deliverTo: string
  /** 備考(帳票全体への申し送り)。 */
  note: string
}

export const EMPTY_ORDER_DOC_META: OrderDocMeta = {
  toName: '',
  siteName: '',
  wantDate: '',
  deliverTo: '',
  note: '',
}

/** 直管の調達属性。区間に個別設定が無いときは配管設定(既定)の値を使う。 */
export interface PipeProcurementDefaults {
  pipeColor?: 'white' | 'black'
  pipeThread?: 'threaded' | 'plain'
  pipeStockMm?: number
}

/** 帳票の明細1行。列は 品名・仕様 / サイズ / 数量 / 備考 の4つだけ。 */
export interface OrderDocRow {
  category: 'pipe' | 'fitting' | 'flange'
  /** 品名・仕様 */
  name: string
  /** サイズ(呼び径) */
  size: string
  /** 数量(単位つきの表示文字列) */
  qty: string
  /** 備考 */
  note: string
}

export const PIPE_COLOR_LABEL: Record<'white' | 'black', string> = {
  white: '白',
  black: '黒',
}
export const PIPE_THREAD_LABEL: Record<'threaded' | 'plain', string> = {
  threaded: 'ねじ付',
  plain: 'ねじ無し',
}

/** ねじ付は定尺4m固定(ねじ切り済みの流通品が4mのため)。 */
export const THREADED_STOCK_MM = 4000
/** 定尺の既定値。未設定のときはこれで本数を数える。 */
export const DEFAULT_STOCK_MM = 4000

/**
 * 区間の実効的な調達属性を決める。ねじ付が選ばれている場合、定尺は
 * 4m固定で上書きする(選択UI側でも固定表示にするが、データが古い等で
 * 食い違っても帳票側で必ず揃うようにする)。
 */
export function resolveProcurement(
  s: Segment,
  base: PipeProcurementDefaults,
): { color?: 'white' | 'black'; thread?: 'threaded' | 'plain'; stockMm: number } {
  const color = s.pipeColor ?? base.pipeColor
  const thread = s.pipeThread ?? base.pipeThread
  const stockMm =
    thread === 'threaded'
      ? THREADED_STOCK_MM
      : (s.pipeStockMm ?? base.pipeStockMm ?? DEFAULT_STOCK_MM)
  return { color, thread, stockMm }
}

/** 直管の集計単位。品名＋色＋ねじ加工＋サイズ＋定尺長ごとに1グループ。 */
export interface OrderPipeGroup {
  pipeType?: string
  /** 品名(管種のフルネーム。無ければ短縮名) */
  pipeName: string
  size?: string
  color?: 'white' | 'black'
  thread?: 'threaded' | 'plain'
  stockMm: number
  /** 切り出す寸法の一覧(mm)。大きい順。 */
  cuts: number[]
  /** 切り出しの合計長さ(mm) */
  totalMm: number
  /** 必要な定尺の本数(First-Fit Decreasing による詰め込み結果) */
  stockCount: number
}

const round1 = (x: number) => Math.round(x * 10) / 10

/** 「SGP 配管用炭素鋼鋼管（白・ねじ付）」のような品名・仕様の文字列を作る。 */
export function pipeSpecLabel(g: OrderPipeGroup): string {
  const quals: string[] = []
  if (g.color) quals.push(PIPE_COLOR_LABEL[g.color])
  if (g.thread) quals.push(PIPE_THREAD_LABEL[g.thread])
  return quals.length > 0 ? `${g.pipeName}（${quals.join('・')}）` : g.pipeName
}

/**
 * 直管を「品名＋色＋ねじ加工＋サイズ＋定尺長」ごとにまとめ、定尺の必要
 * 本数を求める。切り寸法(cutById)は既存の計算結果をそのまま読むだけで、
 * ここでは寸法計算を一切行わない。
 */
export function computeOrderPipeGroups(
  segments: Segment[],
  effById: Record<string, Effective>,
  cutById: Record<string, CutResult>,
  base: PipeProcurementDefaults,
  kerfMm: number = DEFAULT_KERF_MM,
): OrderPipeGroup[] {
  const map = new Map<string, OrderPipeGroup>()
  for (const s of segments) {
    const c = cutById[s.id]
    if (!c || c.status !== 'ok' || c.cut == null) continue
    const eff = effById[s.id]
    const { color, thread, stockMm } = resolveProcurement(s, base)
    const key = `${eff?.pipeType ?? ''}|${eff?.size ?? ''}|${color ?? ''}|${thread ?? ''}|${stockMm}`
    let g = map.get(key)
    if (!g) {
      g = {
        pipeType: eff?.pipeType,
        pipeName: eff?.pipeType
          ? (getPipeType(eff.pipeType)?.name ?? getPipeType(eff.pipeType)?.short ?? eff.pipeType)
          : '—',
        size: eff?.size,
        color,
        thread,
        stockMm,
        cuts: [],
        totalMm: 0,
        stockCount: 0,
      }
      map.set(key, g)
    }
    g.cuts.push(c.cut)
    g.totalMm += c.cut
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.cuts.sort((a, b) => b - a)
    g.stockCount = calcStockCount(g.cuts, g.stockMm, kerfMm)
  }
  // 呼び径の大きい順(現場の拾い順)
  return groups.sort(
    (a, b) =>
      (nominalOf(b.size) ?? 0) - (nominalOf(a.size) ?? 0) ||
      a.pipeName.localeCompare(b.pipeName),
  )
}

/**
 * 帳票の明細行(直管→継手→フランジの順)を作る。
 * 継手・フランジは computeBom の結果をそのまま使う(個数カウントは変更しない)。
 */
export function buildOrderDocRows(
  bom: Bom,
  pipeGroups: OrderPipeGroup[],
): OrderDocRow[] {
  const rows: OrderDocRow[] = []
  for (const g of pipeGroups) {
    const stockM = round1(g.stockMm / 1000)
    rows.push({
      category: 'pipe',
      name: pipeSpecLabel(g),
      size: g.size ?? '—',
      qty: `${g.stockCount}本`,
      // 「本数」は定尺の本数。加工側が確認できるよう、切り出しの内訳も残す。
      note: `定尺 ${stockM}m ／ 切り出し ${g.cuts.length}本・計 ${round1(g.totalMm / 1000)}m`,
    })
  }
  for (const f of bom.fittings) {
    rows.push({
      category: 'fitting',
      name: f.label,
      size: f.size,
      qty: `${f.count}個`,
      note: f.connection === '—' ? '' : f.connection,
    })
  }
  for (const f of bom.flanges) {
    rows.push({
      category: 'flange',
      name: f.label,
      size: f.size,
      qty: `${f.count}枚`,
      note: f.connection === '—' ? '' : f.connection,
    })
  }
  return rows
}

/** 'YYYY-MM-DD' を「2026年8月11日」にする。空や解釈できない値はそのまま返す。 */
export function formatDocDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return value
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
}
