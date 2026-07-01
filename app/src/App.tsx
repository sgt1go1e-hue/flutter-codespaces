import { useMemo, useState } from 'react'
import { DrawingCanvas } from './components/DrawingCanvas'
import { SegmentActionMenu } from './components/SegmentActionMenu'
import { AttributePopup } from './components/AttributePopup'
import { useLocalStorage } from './hooks/useLocalStorage'
import type { Segment } from './types'

const STORAGE_KEY = 'piping-iso:segments'

function makeId(): string {
  return `seg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export default function App() {
  // 図面（セグメント配列）を localStorage に自動保存
  const [segments, setSegments] = useLocalStorage<Segment[]>(STORAGE_KEY, [])
  // 選択・メニュー・属性ポップアップの状態（永続化しない）
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [attrOpen, setAttrOpen] = useState(false)

  const selected = useMemo(
    () => segments.find((s) => s.id === selectedId) ?? null,
    [segments, selectedId],
  )

  function addSegment(seg: Omit<Segment, 'id'>) {
    setSegments((prev) => [...prev, { ...seg, id: makeId() }])
  }

  // ロングタップでセグメント選択 → アクションメニューを表示
  function handleLongPress(id: string, clientX: number, clientY: number) {
    setSelectedId(id)
    setMenu({ x: clientX, y: clientY })
    setAttrOpen(false)
  }

  function closeSelection() {
    setSelectedId(null)
    setMenu(null)
    setAttrOpen(false)
  }

  function deleteSelected() {
    if (!selectedId) return
    if (confirm('このセグメントを削除しますか？')) {
      setSegments((prev) => prev.filter((s) => s.id !== selectedId))
    }
    closeSelection()
  }

  function undo() {
    setSegments((prev) => prev.slice(0, -1))
    closeSelection()
  }

  function clearAll() {
    if (segments.length === 0) return
    if (confirm('図面をすべて消去しますか？')) {
      setSegments([])
      closeSelection()
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">配管アイソメ図</div>
        <div className="tools">
          <button onClick={undo} disabled={segments.length === 0}>
            元に戻す
          </button>
          <button onClick={clearAll} disabled={segments.length === 0}>
            全消去
          </button>
        </div>
      </header>

      <main className="stage">
        <DrawingCanvas
          segments={segments}
          selectedId={selectedId}
          onAddSegment={addSegment}
          onLongPressSegment={handleLongPress}
        />

        {/* ロングタップで開くアクションメニュー */}
        {menu && selected && !attrOpen && (
          <SegmentActionMenu
            x={menu.x}
            y={menu.y}
            onEditAttributes={() => {
              setMenu(null)
              setAttrOpen(true)
            }}
            onDelete={deleteSelected}
            onClose={closeSelection}
          />
        )}

        {/* 「寸法・属性を入力」で開くポップアップ */}
        {attrOpen && selected && (
          <AttributePopup segment={selected} onClose={closeSelection} />
        )}
      </main>

      <footer className="statusbar">
        <span className="hint">
          指でドラッグして線を描画（アイソメ角に自動スナップ）／線を長押しで選択・メニュー表示
        </span>
        <span className="count">セグメント数: {segments.length}</span>
      </footer>
    </div>
  )
}
