import { useRef } from 'react'
import { partsPalette, getPart } from '../data/parts'

interface Props {
  /** チップのドラッグ開始（partId と開始位置の画面座標を渡す） */
  onDragStart: (partId: string, clientX: number, clientY: number) => void
  /** ドラッグ中のパーツ id（ハイライト用） */
  draggingId: string | null
  /** チップをタップして選択したパーツid（配管をタップして配置するのを待っている状態） */
  selectedId: string | null
  /** チップをタップ（動かさず離す）したとき。同じ部材を再タップすると選択解除する想定 */
  onSelect: (partId: string) => void
  /** パレット本体(チップ一覧)を開いているか。既定は閉（キャンバスを広く保つため）。 */
  open: boolean
  /** ヘッダーをタップして開閉を切り替える */
  onToggle: () => void
}

// 動きが「横スクロール」か「上へドラッグ」かを判定するまでの移動量(px)
const GESTURE_THRESHOLD = 10

/**
 * 画面下部に常設するパーツパレット。
 * チップをタップして選択し、配管上のタップした位置に配置する方式(選択→タップ)
 * を基本としつつ、従来からのドラッグ&ドロップ操作も残している。位置決めが
 * シビアなレジューサー等でも、タップは指でドラッグ中の対象を隠さないぶん
 * 狙った場所に置きやすい。定義は data/parts.ts の partsPalette 配列。
 */
export function PartsPalette({ onDragStart, draggingId, selectedId, onSelect, open, onToggle }: Props) {
  // 押した瞬間はまだ「タップ選択」か「ドラッグ配置」か「横スクロールで他の候補を
  // 見る」か分からないため、動きを見てから判定する（横に動けばスクロールに任せ、
  // 上下に動けばドラッグ開始、動かさずに離せばタップ選択）。
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
    const g = gestureRef.current
    // ここまで「ドラッグ」にも「横スクロール」にも判定されていなければ、
    // 動かさずに指を離した=タップ選択。
    if (g && !g.decided) {
      onSelect(g.partId)
    }
    cleanup()
  }

  function cleanup() {
    gestureRef.current = null
    window.removeEventListener('pointermove', handleWindowMove)
    window.removeEventListener('pointerup', handleWindowUp)
  }

  return (
    <div className={`palette${open ? ' open' : ''}`}>
      <button className="panel-header" onClick={onToggle}>
        <span className="panel-caret">{open ? '▼' : '▲'}</span>
        <span className="panel-summary">
          <span className="sum-mode">パーツ</span>
          {!open && selectedId && <span className="sum-none">選択中: {getPart(selectedId)?.name}</span>}
        </span>
      </button>
      {open && (
        <div className="palette-items">
          {partsPalette.map((p) => (
            <button
              key={p.id}
              className={`palette-chip${draggingId === p.id ? ' dragging' : ''}${selectedId === p.id ? ' selected' : ''}`}
              onPointerDown={(e) => handlePointerDown(e, p.id)}
            >
              <span className="chip-icon">{p.icon}</span>
              <span className="chip-name">{p.name}</span>
            </button>
          ))}
          <span className="palette-hint">
            {selectedId ? '↓ 配管をタップして配置（タップで解除）' : 'タップして選択→配管をタップで配置（またはドラッグ）'}
          </span>
        </div>
      )}
    </div>
  )
}
