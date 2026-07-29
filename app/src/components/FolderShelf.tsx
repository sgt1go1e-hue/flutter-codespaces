import { useRef } from 'react'
import type { DrawingMeta, FolderMeta } from '../lib/drawingStore'

interface Props {
  folders: FolderMeta[]
  drawings: DrawingMeta[]
  onOpenFolder: (folderId: string | null) => void
  onCreateFolder: () => void
  onRenameFolder: (id: string) => void
  onDeleteFolder: (id: string) => void
  onCreate: () => void
  onQuickCalc: () => void
  onImportFile: (file: File) => void
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

// アプリを開いた直後に見せる、現場・案件フォルダの棚。フォルダ名＋最終更新日の
// カードを最終更新が新しい順に並べる（1階層のみ・サブフォルダなし）。「未分類」も
// 1つのフォルダ的な扱いで常に先頭に出す（新規作成した図面は必ずここに入る）。
// フォルダをタップすると、その中の図面一覧(DrawingLauncher)へ遷移する。
export function FolderShelf({
  folders,
  drawings,
  onOpenFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onCreate,
  onQuickCalc,
  onImportFile,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const unclassifiedUpdatedAt = drawings
    .filter((d) => d.folderId == null)
    .reduce((max, d) => Math.max(max, d.updatedAt), 0)
  const sortedFolders = [...folders].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="launcher">
      <div className="launcher-title">配管アイソメ図</div>
      <button className="launcher-new" onClick={onCreate}>
        ＋ 新規作成
      </button>
      <button className="launcher-quickcalc" onClick={onQuickCalc}>
        🧮 クイック計算（芯引き）
      </button>
      <button className="launcher-import" onClick={() => fileInputRef.current?.click()}>
        📥 共有ファイルを開く
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.pipeiso.json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onImportFile(file)
          e.target.value = ''
        }}
      />

      <div className="folder-shelf-header">
        <span className="launcher-sub">現場・案件フォルダ</span>
        <button className="folder-add-btn" onClick={onCreateFolder}>
          ＋ フォルダ
        </button>
      </div>
      <div className="folder-shelf">
        <button className="folder-card" onClick={() => onOpenFolder(null)}>
          <span className="folder-card-name">未分類</span>
          <span className="folder-card-date">
            {unclassifiedUpdatedAt ? formatDate(unclassifiedUpdatedAt) : '—'}
          </span>
        </button>
        {sortedFolders.map((f) => (
          <div className="folder-card-wrap" key={f.id}>
            <button className="folder-card" onClick={() => onOpenFolder(f.id)}>
              <span className="folder-card-name">{f.name}</span>
              <span className="folder-card-date">{formatDate(f.updatedAt)}</span>
            </button>
            <div className="folder-card-actions">
              <button
                className="launcher-action"
                onClick={(e) => {
                  e.stopPropagation()
                  onRenameFolder(f.id)
                }}
              >
                名前
              </button>
              <button
                className="launcher-action danger"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteFolder(f.id)
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
