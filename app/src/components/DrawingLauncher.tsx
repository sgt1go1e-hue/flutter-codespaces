import { useState } from 'react'
import type { DrawingMeta, FolderMeta, StatusColor } from '../lib/drawingStore'

interface Props {
  drawings: DrawingMeta[]
  folders: FolderMeta[]
  /** 表示するフォルダ(null=未分類)。このフォルダに属する図面だけを一覧する。 */
  folderId: string | null
  onBack: () => void
  onOpen: (id: string) => void
  onRename: (id: string, currentName: string) => void
  onDelete: (id: string) => void
  onMoveToFolder: (id: string, folderId: string | null) => void
  onSetStatusColor: (id: string, color: StatusColor) => void
  /**
   * このフォルダの配管ライン色分け(系統)既定値を編集する画面を開く。
   * 未分類(folderId=null)はフォルダの既定値を持たないため表示しない。
   */
  onEditFolderColors?: () => void
}

const STATUS_COLORS: StatusColor[] = ['white', 'red', 'green', 'blue']
const STATUS_COLOR_LABEL: Record<StatusColor, string> = {
  white: '白（未設定）',
  red: '赤',
  green: '緑',
  blue: '青',
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// フォルダ棚(FolderShelf)でフォルダをタップした後に見せる、その中の図面一覧。
// 進捗ステータス色(白/赤/緑/青、意味は自由)はカード左端の縦帯で表す。
// 名前の変更・削除は、誤タップを避けるためカード内のメニューへ入れてある。
export function DrawingLauncher({
  drawings,
  folders,
  folderId,
  onBack,
  onOpen,
  onRename,
  onDelete,
  onMoveToFolder,
  onSetStatusColor,
  onEditFolderColors,
}: Props) {
  const [menuId, setMenuId] = useState<string | null>(null)
  const folderName =
    folderId == null ? '未分類' : (folders.find((f) => f.id === folderId)?.name ?? '（不明なフォルダ）')
  const sorted = drawings
    .filter((d) => d.folderId === folderId)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="home home-list-screen">
      <header className="home-header">
        <div className="home-header-row">
          <button type="button" className="home-back" onClick={onBack}>
            ← フォルダ一覧
          </button>
          {folderId != null && onEditFolderColors && (
            <button type="button" className="home-gear" aria-label="このフォルダの色設定" onClick={onEditFolderColors}>
              色設定
            </button>
          )}
        </div>
        <h1 className="home-brand home-brand-folder">{folderName}</h1>
      </header>

      <div className="home-body">
        {sorted.length === 0 ? (
          <p className="home-empty">このフォルダにはまだ図面がありません。</p>
        ) : (
          <ul className="home-drawing-list">
            {sorted.map((d) => (
              <li key={d.id} className={`home-drawing-card status-${d.statusColor}`}>
                <span className="home-drawing-band" aria-hidden="true" />
                <div className="home-drawing-body">
                  <button type="button" className="home-drawing-main" onClick={() => onOpen(d.id)}>
                    <span className="home-drawing-name">
                      {d.name || formatDateTime(d.updatedAt)}
                    </span>
                    <span className="home-drawing-meta">
                      {d.name ? `${formatDateTime(d.updatedAt)} ・ ` : ''}
                      {d.segCount}セグメント
                    </span>
                  </button>
                  <div className="home-drawing-sub">
                    <span className="status-dot-row">
                      {STATUS_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`status-dot status-dot-${c}${d.statusColor === c ? ' active' : ''}`}
                          aria-label={STATUS_COLOR_LABEL[c]}
                          title={STATUS_COLOR_LABEL[c]}
                          onClick={() => onSetStatusColor(d.id, c)}
                        />
                      ))}
                    </span>
                    <select
                      className="home-move-select"
                      value={d.folderId ?? ''}
                      aria-label="フォルダを移動"
                      onChange={(e) => onMoveToFolder(d.id, e.target.value || null)}
                    >
                      <option value="">未分類</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="home-folder-menu-btn"
                  aria-label="この図面のメニュー"
                  onClick={() => setMenuId((cur) => (cur === d.id ? null : d.id))}
                >
                  ⋯
                </button>
                {menuId === d.id && (
                  <>
                    <button
                      type="button"
                      className="home-menu-backdrop"
                      aria-label="閉じる"
                      onClick={() => setMenuId(null)}
                    />
                    <div className="home-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuId(null)
                          onRename(d.id, d.name ?? '')
                        }}
                      >
                        名前を変更
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          setMenuId(null)
                          onDelete(d.id)
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
