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
// 見た目は導入前の「過去の図面」リストのままで、各カードに進捗ステータス色
// (白/赤/緑/青、意味は自由)のドットと、フォルダ移動用のプルダウンを追加した。
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
  const folderName = folderId == null ? '未分類' : (folders.find((f) => f.id === folderId)?.name ?? '（不明なフォルダ）')
  const sorted = drawings
    .filter((d) => d.folderId === folderId)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="launcher">
      <button className="launcher-back" onClick={onBack}>
        ← フォルダ一覧
      </button>
      <div className="launcher-title-row">
        <div className="launcher-title">{folderName}</div>
        {folderId != null && onEditFolderColors && (
          <button className="launcher-action" onClick={onEditFolderColors}>
            このフォルダの色設定
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="panel-hint">このフォルダにはまだ図面がありません。</p>
      ) : (
        <ul className="launcher-list">
          {sorted.map((d) => (
            <li key={d.id} className="launcher-row-group">
              <div className="launcher-row">
                <button className="launcher-item" onClick={() => onOpen(d.id)}>
                  <span className="launcher-item-date">
                    {d.name || formatDateTime(d.updatedAt)}
                  </span>
                  <span className="launcher-item-count">
                    {d.name ? `${formatDateTime(d.updatedAt)} ・ ` : ''}
                    {d.segCount}セグメント
                  </span>
                </button>
                <button
                  className="launcher-action"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRename(d.id, d.name ?? '')
                  }}
                >
                  名前
                </button>
                <button
                  className="launcher-action danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(d.id)
                  }}
                >
                  削除
                </button>
              </div>
              <div className="launcher-row-sub">
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
                  className="launcher-move-select"
                  value={d.folderId ?? ''}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
