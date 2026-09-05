import { DEFAULT_MENU_ORDER, MENU_ITEM_LABELS, type MenuItemId } from '../lib/menuOrder'

interface Props {
  order: MenuItemId[]
  onChange: (order: MenuItemId[]) => void
  onClose: () => void
}

function move(order: MenuItemId[], index: number, dir: -1 | 1): MenuItemId[] {
  const target = index + dir
  if (target < 0 || target >= order.length) return order
  const next = [...order]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * 画面下段メニューの並び替え設定。「配管アイソメ図」のタイトル表示は
 * 常に固定位置のため対象外（ここには出さない）。ドラッグ&ドロップは
 * タッチ環境での誤操作(スクロールとの競合等)が起きやすいため、確実に
 * 操作できる上下移動ボタン方式にしている。
 */
export function MenuOrderModal({ order, onChange, onClose }: Props) {
  return (
    <div className="disclaimer-overlay" onClick={onClose}>
      <div className="disclaimer-card" onClick={(e) => e.stopPropagation()}>
        <div className="disclaimer-header">メニューの並び替え</div>
        <div className="disclaimer-body">
          <p className="panel-hint">
            画面下段メニューの表示順を変更できます（機能・見た目は変わりません）。
          </p>
          <ul className="menu-order-list">
            {order.map((id, i) => (
              <li key={id} className="menu-order-row">
                <span className="menu-order-label">{MENU_ITEM_LABELS[id]}</span>
                <span className="menu-order-buttons">
                  <button
                    type="button"
                    onClick={() => onChange(move(order, i, -1))}
                    disabled={i === 0}
                    aria-label="上へ（左へ）"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(move(order, i, 1))}
                    disabled={i === order.length - 1}
                    aria-label="下へ（右へ）"
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="menu-order-actions">
          <button className="menu-order-reset" onClick={() => onChange(DEFAULT_MENU_ORDER)}>
            初期順序に戻す
          </button>
          <button className="disclaimer-close" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
