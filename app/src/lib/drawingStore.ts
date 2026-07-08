import type { Segment } from '../types'

// 複数図面(ファイル)管理: 図面ごとに id を振り、セグメント本体は
// `piping-iso:drawing:<id>` に、一覧(名前は付けず更新日時とセグメント数のみ)は
// `piping-iso:index` に保存する。すべて自動保存（保存操作は不要）。
export interface DrawingMeta {
  id: string
  createdAt: number
  updatedAt: number
  segCount: number
}

const INDEX_KEY = 'piping-iso:index'
// 旧バージョン(単一図面のみ)が使っていたキー。移行後は使用しない。
const LEGACY_KEY = 'piping-iso:segments'
const drawingKey = (id: string) => `piping-iso:drawing:${id}`

export function makeDrawingId(): string {
  return `dwg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function loadIndex(): DrawingMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    return raw ? (JSON.parse(raw) as DrawingMeta[]) : []
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

export function loadDrawingSegments(id: string): Segment[] {
  try {
    const raw = localStorage.getItem(drawingKey(id))
    return raw ? (JSON.parse(raw) as Segment[]) : []
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
    }
    saveIndex([meta])
    localStorage.removeItem(LEGACY_KEY)
    return [meta]
  } catch {
    return index
  }
}
