import type { DrawingMeta } from '../lib/drawingStore'

interface Props {
  drawings: DrawingMeta[]
  onCreate: () => void
  onOpen: (id: string) => void
  onRename: (id: string, currentName: string) => void
  onDelete: (id: string) => void
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

// アプリを開いた直後、および図面画面から「過去の図面」で戻ってきたときに表示する
// 起点画面。名前を付けずに自動保存された過去の図面から選ぶか、新規作成する。
// 一覧の各項目は名前変更・削除もできる。
export function DrawingLauncher({ drawings, onCreate, onOpen, onRename, onDelete }: Props) {
  const sorted = [...drawings].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <div className="launcher">
      <div className="launcher-title">配管アイソメ図</div>
      <button className="launcher-new" onClick={onCreate}>
        ＋ 新規作成
      </button>

      {sorted.length > 0 && (
        <>
          <div className="launcher-sub">過去の図面</div>
          <ul className="launcher-list">
            {sorted.map((d) => (
              <li key={d.id} className="launcher-row">
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
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
