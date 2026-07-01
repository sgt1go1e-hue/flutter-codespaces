interface Props {
  /** メニューを表示する画面座標(px) */
  x: number
  y: number
  onDelete: () => void
  onEditAttributes: () => void
  onClose: () => void
}

/**
 * ロングタップで選択したセグメントの近くに出る小さなアクションメニュー。
 * 背景オーバーレイをタップすると閉じる（= 選択解除）。
 */
export function SegmentActionMenu({
  x,
  y,
  onDelete,
  onEditAttributes,
  onClose,
}: Props) {
  return (
    <>
      {/* メニュー外タップで閉じるための全面オーバーレイ */}
      <div
        className="menu-overlay"
        onPointerDown={(e) => {
          e.stopPropagation()
          onClose()
        }}
      />
      <div
        className="action-menu"
        style={{ left: x, top: y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className="menu-item"
          onClick={(e) => {
            e.stopPropagation()
            onEditAttributes()
          }}
        >
          寸法・属性を入力
        </button>
        <button
          className="menu-item danger"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          削除
        </button>
      </div>
    </>
  )
}
