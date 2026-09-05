import { useState } from 'react'
import type { Segment } from '../types'
import {
  buildShareFile,
  serializeShareFile,
  shareFileName,
  SHARE_PERMISSIONS,
  SHARE_PERMISSION_LABELS,
  SHARE_PERMISSION_DESCRIPTIONS,
  type SharePermission,
  type SegmentNote,
} from '../lib/shareFile'

interface Props {
  segments: Segment[]
  notes: SegmentNote[]
  /** 送り返し(既に共有で受け取った図面)のときは、その権限を初期選択にする */
  initialPermission?: SharePermission
  drawingName?: string
  onClose: () => void
}

// 図面を共有(エクスポート)するモーダル。権限レベルを選び、図面データ一式＋
// 権限情報を1つのJSONファイルにまとめて、端末標準の共有シート(LINE・
// AirDrop・メール等)へ渡す。共有APIが使えない環境ではファイルのダウンロード
// にフォールバックする(サーバーは一切使わない)。
export function ShareExportModal({
  segments,
  notes,
  initialPermission,
  drawingName,
  onClose,
}: Props) {
  const [permission, setPermission] = useState<SharePermission>(
    initialPermission ?? 'dimensions',
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function share() {
    setError(null)
    setBusy(true)
    try {
      const file = buildShareFile(segments, permission, notes, drawingName)
      const text = serializeShareFile(file)
      const filename = shareFileName(drawingName)
      const blob = new Blob([text], { type: 'application/json' })
      const shareFile = new File([blob], filename, { type: 'application/json' })

      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean
        share?: (data: { files: File[]; title?: string }) => Promise<void>
      }
      if (nav.canShare?.({ files: [shareFile] }) && nav.share) {
        await nav.share({ files: [shareFile], title: filename })
        onClose()
        return
      }
      // 共有APIが使えない(または対象外の)環境は通常のダウンロードにフォールバック。
      // ダウンロードしたファイルをLINE・メール等へ手動で添付して送れる。
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      onClose()
    } catch (e) {
      // ユーザーが共有シートをキャンセルした場合(AbortError)はエラー扱いにしない
      if (e instanceof Error && e.name === 'AbortError') {
        setBusy(false)
        return
      }
      setError('共有ファイルの作成に失敗しました。もう一度お試しください。')
      setBusy(false)
    }
  }

  return (
    <div className="share-modal-backdrop" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <h2>図面を共有</h2>
        <p className="share-modal-desc">
          相手に許可する権限レベルを選んでください。共有ファイルはLINE・AirDrop・メール等、端末標準の方法で送れます（サーバーは使用しません）。
        </p>

        <div className="share-permission-options">
          {SHARE_PERMISSIONS.map((p) => (
            <label
              key={p}
              className={`share-permission-option${permission === p ? ' active' : ''}`}
            >
              <input
                type="radio"
                name="share-permission"
                value={p}
                checked={permission === p}
                onChange={() => setPermission(p)}
              />
              <span>
                <span className="share-permission-option-title">
                  {SHARE_PERMISSION_LABELS[p]}
                </span>
                <span className="share-permission-option-desc">
                  {SHARE_PERMISSION_DESCRIPTIONS[p]}
                </span>
              </span>
            </label>
          ))}
        </div>

        {error && <p className="share-modal-error">{error}</p>}

        <div className="share-modal-actions">
          <button type="button" className="share-modal-cancel" onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="button" className="share-modal-submit" onClick={share} disabled={busy}>
            共有する
          </button>
        </div>
      </div>
    </div>
  )
}
