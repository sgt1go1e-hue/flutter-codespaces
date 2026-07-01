import { partsPalette } from '../data/parts'

interface Props {
  /** チップのドラッグ開始（partId と開始位置の画面座標を渡す） */
  onDragStart: (partId: string, clientX: number, clientY: number) => void
  /** ドラッグ中のパーツ id（ハイライト用） */
  draggingId: string | null
}

/**
 * 画面下部に常設するパーツパレット。
 * チップを配管上へドラッグ&ドロップして特殊部材（フランジ等）を配置する。
 * 定義は data/parts.ts の partsPalette 配列。増やせば同じ仕組みで他部材も追加できる。
 */
export function PartsPalette({ onDragStart, draggingId }: Props) {
  return (
    <div className="palette">
      <span className="palette-title">パーツ</span>
      <div className="palette-items">
        {partsPalette.map((p) => (
          <button
            key={p.id}
            className={`palette-chip${draggingId === p.id ? ' dragging' : ''}`}
            // ドラッグはパレット側の pointerdown で開始する。
            // キャンバスには pointerdown が渡らないため、ロングタップ判定とは競合しない。
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onDragStart(p.id, e.clientX, e.clientY)
            }}
          >
            <span className="chip-icon">{p.icon}</span>
            <span className="chip-name">{p.name}</span>
          </button>
        ))}
        <span className="palette-hint">↑ 配管上へドラッグして配置</span>
      </div>
    </div>
  )
}
