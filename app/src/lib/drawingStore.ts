import type { FieldWeldMark, Segment } from '../types'

function makeMarkId(): string {
  return `wm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 旧形式のマーク1件を現行形式へ揃える(向きは flipped(真偽) → rotation(度))。 */
type LegacyMark = Partial<FieldWeldMark> & { t: number; flipped?: boolean }
function normalizeMark(m: LegacyMark): FieldWeldMark {
  const { flipped, ...rest } = m
  return {
    id: rest.id ?? makeMarkId(),
    t: rest.t,
    // 旧: flipped=trueで三角が反対を向いていた → 180°回した状態に相当する。
    rotation: rest.rotation ?? (flipped ? 180 : 0),
    offsetX: rest.offsetX,
    offsetY: rest.offsetY,
  }
}

/**
 * 現場溶接マークの旧バージョンのデータを現行形式へ移行する。
 *  - 単数(fieldWeldMark) → 配列(fieldWeldMarks)
 *  - 向きの持ち方 flipped(反転の真偽) → rotation(90°刻みの角度)
 * 読み込むたびに通すことで自己修復させる(normalizeDrawingMetaと同じ考え方)。
 * 現行形式のデータはそのまま素通しする。
 */
function normalizeSegment(s: Segment): Segment {
  const { fieldWeldMark: legacy, ...rest } = s as Segment & { fieldWeldMark?: LegacyMark }
  const marks = s.fieldWeldMarks ?? (legacy ? [legacy as LegacyMark] : undefined)
  if (!marks) return legacy ? (rest as Segment) : s
  return { ...(rest as Segment), fieldWeldMarks: marks.map((m) => normalizeMark(m as LegacyMark)) }
}

// 複数図面(ファイル)管理: 図面ごとに id を振り、セグメント本体は
// `piping-iso:drawing:<id>` に、一覧(名前は付けず更新日時とセグメント数のみ)は
// `piping-iso:index` に保存する。すべて自動保存（保存操作は不要）。
//
// 現場・案件フォルダ(1階層のみ)と、図面ごとの進捗ステータス色を追加。
// どちらもホーム画面（過去の図面一覧）の整理用の表示専用メタデータで、
// アイソメ図の計算結果には一切関与しない。
export type StatusColor = 'white' | 'red' | 'green' | 'blue'

export interface DrawingMeta {
  id: string
  createdAt: number
  updatedAt: number
  segCount: number
  /** ユーザーが付けた任意の名前。未設定なら一覧では更新日時を表示する。 */
  name?: string
  /** 所属する現場・案件フォルダのid。未分類はnull。 */
  folderId: string | null
  /** 進捗ステータス色（意味は固定しない・ユーザー自由）。既定は'white'(未設定扱い)。 */
  statusColor: StatusColor
}

/** 現場・案件フォルダ（1階層のみ・サブフォルダなし）。 */
export interface FolderMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /**
   * 配管ライン色分け(系統)の既定対応表(colorId → 系統名)。このフォルダに
   * 属する図面を開いたとき、その図面がまだ自分自身の対応表を保存して
   * いなければ、ここを初期値として使う(以後は図面側で独立して編集でき、
   * 図面側の変更はこのフォルダの既定には反映しない)。未設定/空なら
   * ラベルなし(色のみ)から始まる。
   */
  colorLabels?: Record<string, string>
}

const INDEX_KEY = 'piping-iso:index'
const FOLDER_INDEX_KEY = 'piping-iso:folders'
// 旧バージョン(単一図面のみ)が使っていたキー。移行後は使用しない。
const LEGACY_KEY = 'piping-iso:segments'
const drawingKey = (id: string) => `piping-iso:drawing:${id}`

export function makeDrawingId(): string {
  return `dwg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function makeFolderId(): string {
  return `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * フォルダ機能・ステータス色の導入前に保存された図面データには
 * folderId/statusColorが存在しない。読み込み時に必ずここを通すことで、
 * 古いデータも「未分類・白ステータス」として正しく扱えるようにする
 * (明示的な一括マイグレーションではなく、読み込むたびに自己修復する形)。
 */
function normalizeDrawingMeta(m: Partial<DrawingMeta> & { id: string; createdAt: number; updatedAt: number; segCount: number }): DrawingMeta {
  return {
    ...m,
    folderId: m.folderId ?? null,
    statusColor: m.statusColor ?? 'white',
  }
}

export function loadIndex(): DrawingMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<Partial<DrawingMeta> & { id: string; createdAt: number; updatedAt: number; segCount: number }>
    return parsed.map(normalizeDrawingMeta)
  } catch {
    return []
  }
}

export function saveIndex(list: DrawingMeta[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list))
  } catch {
    // 保存失敗（容量超過など）は無視する
  }
}

export function loadFolders(): FolderMeta[] {
  try {
    const raw = localStorage.getItem(FOLDER_INDEX_KEY)
    return raw ? (JSON.parse(raw) as FolderMeta[]) : []
  } catch {
    return []
  }
}

export function saveFolders(list: FolderMeta[]) {
  try {
    localStorage.setItem(FOLDER_INDEX_KEY, JSON.stringify(list))
  } catch {
    // 保存失敗（容量超過など）は無視する
  }
}

export function loadDrawingSegments(id: string): Segment[] {
  try {
    const raw = localStorage.getItem(drawingKey(id))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Segment[]
    return parsed.map(normalizeSegment)
  } catch {
    return []
  }
}

export function saveDrawingSegments(id: string, segments: Segment[]) {
  try {
    localStorage.setItem(drawingKey(id), JSON.stringify(segments))
  } catch {
    // 保存失敗（容量超過など）は無視する
  }
}

const drawingColorLabelsKey = (id: string) => `piping-iso:drawing:${id}:colorLabels`

/**
 * この図面自身が保存した色分け(系統)ラベルの対応表。セグメント本体
 * (drawingKey)とは別のキーに持たせる(既存の図面データ形式・後方互換を
 * 崩さないため)。
 * 戻り値がnullなのは「この図面はまだ一度も保存したことがない」ことを表す
 * (呼び出し側はこの場合、所属フォルダの既定値にフォールバックする)。
 * 一度保存された後は、中身が空オブジェクトであっても(=全て削除された)
 * nullを返さず、その空の状態をそのまま尊重する。
 */
export function loadDrawingColorLabels(id: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(drawingColorLabelsKey(id))
    return raw ? (JSON.parse(raw) as Record<string, string>) : null
  } catch {
    return null
  }
}

export function saveDrawingColorLabels(id: string, labels: Record<string, string>) {
  try {
    localStorage.setItem(drawingColorLabelsKey(id), JSON.stringify(labels))
  } catch {
    // 保存失敗（容量超過など）は無視する
  }
}

/** 図面本体のストレージを削除する（一覧(index)からの削除は呼び出し側で行う）。 */
export function deleteDrawingSegments(id: string) {
  try {
    localStorage.removeItem(drawingKey(id))
    localStorage.removeItem(drawingColorLabelsKey(id))
  } catch {
    // 削除失敗は無視する
  }
}

/**
 * 旧バージョン（単一図面のみ・`piping-iso:segments` に直接保存）からの移行。
 * 一覧が未生成で、旧キーにデータが残っていれば1件の図面として登録する。
 */
export function migrateLegacyDrawing(): DrawingMeta[] {
  const index = loadIndex()
  if (index.length > 0) return index
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return index
    const segments = JSON.parse(raw) as Segment[]
    if (!Array.isArray(segments) || segments.length === 0) return index
    const id = makeDrawingId()
    const now = Date.now()
    saveDrawingSegments(id, segments)
    const meta: DrawingMeta = {
      id,
      createdAt: now,
      updatedAt: now,
      segCount: segments.length,
      folderId: null,
      statusColor: 'white',
    }
    saveIndex([meta])
    localStorage.removeItem(LEGACY_KEY)
    return [meta]
  } catch {
    return index
  }
}
