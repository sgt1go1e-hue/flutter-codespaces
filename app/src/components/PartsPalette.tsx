import { useRef } from 'react'
import { partsPalette } from '../data/parts'

interface Props {
  /** チップのドラッグ開始（partId と開始位置の画面座標を渡す） */
  onDragStart: (partId: string, clientX: number, clientY: number) => void
  /** ドラッグ中のパーツ id（ハイライト用） */
  draggingId: string | null
}

// 動きが「横スクロール」か「上へドラッグ」かを判定するまでの移動量(px)
const GESTURE_THRESHOLD = 10

/**
 * 画面下部に常設するパーツパレット。
 * チップを配管上へドラッグ&ドロップして特殊部材（フランジ等）を配置する。
 * 定義は data/parts.ts の partsPalette 配列。増やせば同じ仕組みで他部材も追加できる。
 */
export function PartsPalette({ onDragStart, draggingId }: Props) {
  // 押した瞬間はまだ「ドラッグ配置」か「横スクロールで他の候補を見る」か分からないため、
  // 動きを見てから判定する（横に動けばスクロールに任せ、上下に動けばドラッグ開始）。
  // これをしないと、チップに触れた時点で即ドラッグ扱いになり画面外の候補まで
  // 横スクロールでたどり着けなくなる。
  const gestureRef = useRef<{
    pointerId: number
    partId: string
    startX: number
    startY: number
    decided: boolean
  } | null>(null)

  function handlePointerDown(e: React.PointerEvent, partId: string) {
    gestureRef.current = {
      pointerId: e.pointerId,
      partId,
      startX: e.clientX,
      startY: e.clientY,
      decided: false,
    }
    window.addEventListener('pointermove', handleWindowMove)
    window.addEventListener('pointerup', handleWindowUp)
  }

  function handleWindowMove(e: PointerEvent) {
    const g = gestureRef.current
    if (!g || g.decided || e.pointerId !== g.pointerId) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (Math.abs(dy) > GESTURE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
      // 上下方向の動き = 配管上へドラッグしようとしている
      g.decided = true
      cleanup()
      onDragStart(g.partId, e.clientX, e.clientY)
    } else if (Math.abs(dx) > GESTURE_THRESHOLD) {
      // 横方向の動き = パレットの横スクロールとみなし、ブラウザの既定動作に任せる
      g.decided = true
      cleanup()
    }
  }

  function handleWindowUp() {
    cleanup()
  }

  function cleanup() {
    gestureRef.current = null
    window.removeEventListener('pointermove', handleWindowMove)
    window.removeEventListener('pointerup', handleWindowUp)
  }

  return (
    <div className="palette">
      <span className="palette-title">パーツ</span>
      <div className="palette-items">
        {partsPalette.map((p) => (
          <button
            key={p.id}
            className={`palette-chip${draggingId === p.id ? ' dragging' : ''}`}
            onPointerDown={(e) => handlePointerDown(e, p.id)}
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
