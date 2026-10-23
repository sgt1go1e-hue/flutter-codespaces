import type { HangerDesign } from '../features/support/hangerDesign'

// サポート架台図面の複数ファイル管理。drawingStore.tsと同じ考え方
// （一覧はメタデータのみ`piping-iso:support:index`、実データ(保存した架台の配列)は
// `piping-iso:support:doc:<id>`）で、フォルダ(現場・案件)はdrawingStore.tsの
// FolderMeta/loadFolders/saveFolders をそのまま共用する(図面とサポート架台を
// 同じ現場フォルダにまとめて入れたい、という要望のため)。

export interface SupportDoc {
  id: string
  createdAt: number
  updatedAt: number
  /** ユーザーが付けた任意の名前。未設定なら一覧では更新日時を表示する。 */
  name?: string
  /** 所属する現場・案件フォルダのid（drawingStore.tsのFolderMetaと共通）。未分類はnull。 */
  folderId: string | null
  /** 保存した架台の台数（一覧のプレビュー表示用）。 */
  count: number
}

const INDEX_KEY = 'piping-iso:support:index'
const docKey = (id: string) => `piping-iso:support:doc:${id}`

export function makeSupportDocId(): string {
  return `sup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function loadSupportIndex(): SupportDoc[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<Partial<SupportDoc> & { id: string; createdAt: number; updatedAt: number }>
    return parsed.map((m) => ({
      ...m,
      folderId: m.folderId ?? null,
      count: m.count ?? 0,
    }))
  } catch {
    return []
  }
}

export function saveSupportIndex(list: SupportDoc[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list))
  } catch {
    // 保存失敗（容量超過など）は無視する
  }
}

export function loadSupportSheet(id: string): HangerDesign[] {
  try {
    const raw = localStorage.getItem(docKey(id))
    return raw ? (JSON.parse(raw) as HangerDesign[]) : []
  } catch {
    return []
  }
}

export function saveSupportSheet(id: string, sheet: HangerDesign[]) {
  try {
    localStorage.setItem(docKey(id), JSON.stringify(sheet))
  } catch {
    // 保存失敗（容量超過など）は無視する
  }
}

/** サポート架台ファイル本体のストレージを削除する（一覧(index)からの削除は呼び出し側で行う）。 */
export function deleteSupportSheet(id: string) {
  try {
    localStorage.removeItem(docKey(id))
  } catch {
    // 削除失敗は無視する
  }
}
