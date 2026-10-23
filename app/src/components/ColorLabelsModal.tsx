import { LINE_COLOR_PALETTE } from '../data/lineColors'

interface Props {
  title: string
  hint: string
  labels: Record<string, string>
  onChange: (colorId: string, label: string) => void
  onClose: () => void
}

/**
 * 配管ライン色分け(系統)の色↔系統名対応表を、パレットの色ぶんまとめて
 * 編集する画面。図面の詳細パネル(その図面だけのローカル対応表)、
 * フォルダの一覧画面(そのフォルダの既定対応表)の両方から、それぞれの
 * 対応表を渡して同じ見た目で使う。
 */
export function ColorLabelsModal({ title, hint, labels, onChange, onClose }: Props) {
  return (
    <div className="disclaimer-overlay" onClick={onClose}>
      <div className="disclaimer-card" onClick={(e) => e.stopPropagation()}>
        <div className="disclaimer-header">{title}</div>
        <div className="disclaimer-body">
          <p className="panel-hint">{hint}</p>
          <ul className="color-labels-list">
            {LINE_COLOR_PALETTE.map((c) => (
              <li key={c.id} className="color-labels-row">
                <span className="color-swatch color-swatch-static" style={{ background: c.hex }} />
                <input
                  type="text"
                  className="num-input"
                  placeholder="系統名（例: 給水）未入力なら色のみ"
                  value={labels[c.id] ?? ''}
                  onChange={(e) => onChange(c.id, e.target.value)}
                />
              </li>
            ))}
          </ul>
        </div>
        <div className="menu-order-actions">
          <button className="disclaimer-close" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
