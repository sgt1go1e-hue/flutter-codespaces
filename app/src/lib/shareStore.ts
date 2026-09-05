import type { SegmentNote, SharePermission } from './shareFile'

// 共有(インポート)で受け取った図面だけが持つ追加情報（権限・メモ）の永続化。
// 通常のローカル図面(常にフル編集)にはこのキー自体を作らない。
export interface ShareMeta {
  permission: SharePermission
  notes: SegmentNote[]
}

const shareKey = (id: string) => `piping-iso:share:${id}`

export function loadShareMeta(id: string): ShareMeta | null {
  try {
    const raw = localStorage.getItem(shareKey(id))
    return raw ? (JSON.parse(raw) as ShareMeta) : null
  } catch {
    return null
  }
}

export function saveShareMeta(id: string, meta: ShareMeta) {
  try {
    localStorage.setItem(shareKey(id), JSON.stringify(meta))
  } catch {
    // 保存失敗（容量超過など）は無視する
  }
}

export function deleteShareMeta(id: string) {
  try {
    localStorage.removeItem(shareKey(id))
  } catch {
    // 削除失敗は無視する
  }
}
