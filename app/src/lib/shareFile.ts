import type { Segment } from '../types'

// 図面共有(権限付きファイル共有)機能。サーバーは使わず、図面データ一式＋
// 権限情報を1つのJSONファイルに詰めて、端末標準の共有機能(LINE・AirDrop・
// メール等)やアプリ内の「開く」でやり取りする。権限による制御はあくまで
// アプリ側のUI制限であり、ファイル自体の改ざん防止までは行わない
// （現場の運用を想定した性善説ベースの機能）。

/**
 * 共有時の権限レベル。
 * - view: 開いて見られるが一切編集できない
 * - annotate: 図面の構成・寸法は変更できないが、線ごとにメモを追加できる
 * - dimensions: 継手・構成は固定したまま、芯々/芯先の寸法値だけ編集できる（既定）
 * - full: 制限なし（通常の編集と同じ）
 */
export type SharePermission = 'view' | 'annotate' | 'dimensions' | 'full'

export const SHARE_PERMISSIONS: SharePermission[] = ['view', 'annotate', 'dimensions', 'full']

export const SHARE_PERMISSION_LABELS: Record<SharePermission, string> = {
  view: '閲覧のみ',
  annotate: '注記のみ',
  dimensions: '寸法のみ編集可',
  full: 'フル編集',
}

export const SHARE_PERMISSION_DESCRIPTIONS: Record<SharePermission, string> = {
  view: '開いて見られるだけで、一切編集できません。',
  annotate: '図面の構成・寸法は変更できませんが、線ごとにメモを追加できます。',
  dimensions: '継手の種類や配管の構成は固定したまま、芯々/芯先の寸法値だけ入力・変更できます。',
  full: '制限なく、通常の編集と同じように操作できます。',
}

export const DEFAULT_SHARE_PERMISSION: SharePermission = 'dimensions'

// 特定の区間(線)に紐づくメモ。「注記のみ」権限で使う簡易フィードバック用。
export interface SegmentNote {
  id: string
  segmentId: string
  text: string
  createdAt: string
}

export function makeNoteId(): string {
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

const SHARE_FILE_KIND = 'piping-iso-share'
const SHARE_FILE_VERSION = 1

export interface ShareFilePayload {
  kind: typeof SHARE_FILE_KIND
  version: number
  permission: SharePermission
  segments: Segment[]
  notes: SegmentNote[]
  exportedAt: string
  /** 送り主が付けていた図面名（あれば）。受信側の一覧表示に使う。 */
  drawingName?: string
}

export function buildShareFile(
  segments: Segment[],
  permission: SharePermission,
  notes: SegmentNote[],
  drawingName?: string,
): ShareFilePayload {
  return {
    kind: SHARE_FILE_KIND,
    version: SHARE_FILE_VERSION,
    permission,
    segments,
    notes,
    exportedAt: new Date().toISOString(),
    drawingName,
  }
}

export function serializeShareFile(file: ShareFilePayload): string {
  return JSON.stringify(file, null, 2)
}

/** 受信したファイルの内容を検証しつつ読み込む。不正なファイルは null を返す。 */
export function parseShareFile(text: string): ShareFilePayload | null {
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object') return null
    if (raw.kind !== SHARE_FILE_KIND) return null
    if (!Array.isArray(raw.segments)) return null
    const permission: SharePermission = SHARE_PERMISSIONS.includes(raw.permission)
      ? raw.permission
      : DEFAULT_SHARE_PERMISSION
    const notes: SegmentNote[] = Array.isArray(raw.notes)
      ? raw.notes.filter(
          (n: unknown): n is SegmentNote =>
            !!n &&
            typeof n === 'object' &&
            typeof (n as SegmentNote).id === 'string' &&
            typeof (n as SegmentNote).segmentId === 'string' &&
            typeof (n as SegmentNote).text === 'string',
        )
      : []
    return {
      kind: SHARE_FILE_KIND,
      version: typeof raw.version === 'number' ? raw.version : SHARE_FILE_VERSION,
      permission,
      segments: raw.segments as Segment[],
      notes,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
      drawingName: typeof raw.drawingName === 'string' ? raw.drawingName : undefined,
    }
  } catch {
    return null
  }
}

/** 共有ファイルのファイル名（拡張子はJSONとして扱えるよう .json のままにする）。 */
export function shareFileName(drawingName?: string): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace('T', '_')
    .replace(':', '')
  const base = drawingName ? drawingName.replace(/[\\/:*?"<>|]/g, '_') : '配管図面'
  return `${base}_共有_${stamp}.pipeiso.json`
}
