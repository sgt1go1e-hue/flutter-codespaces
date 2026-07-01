import { useMemo } from 'react'
import { DrawingCanvas } from './components/DrawingCanvas'
import { useLocalStorage } from './hooks/useLocalStorage'
import { distance } from './lib/isometric'
import type { Segment } from './types'

const STORAGE_KEY = 'piping-iso:segments'

function makeId(): string {
  return `seg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export default function App() {
  // 図面（セグメント配列）を localStorage に自動保存
  const [segments, setSegments] = useLocalStorage<Segment[]>(STORAGE_KEY, [])
  // 選択状態は永続化不要なので通常の派生管理（localStorage には入れない）
  const [selectedId, setSelectedId] = useLocalStorage<string | null>(
    'piping-iso:selected',
    null,
  )

  const selected = useMemo(
    () => segments.find((s) => s.id === selectedId) ?? null,
    [segments, selectedId],
  )

  function addSegment(seg: Omit<Segment, 'id'>) {
    setSegments((prev) => [...prev, { ...seg, id: makeId() }])
  }

  function deleteSelected() {
    if (!selectedId) return
    setSegments((prev) => prev.filter((s) => s.id !== selectedId))
    setSelectedId(null)
  }

  function undo() {
    setSegments((prev) => prev.slice(0, -1))
    setSelectedId(null)
  }

  function clearAll() {
    if (segments.length === 0) return
    if (confirm('図面をすべて消去しますか？')) {
      setSegments([])
      setSelectedId(null)
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
          <button onClick={deleteSelected} disabled={!selectedId}>
            選択削除
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
          onSelect={setSelectedId}
        />
      </main>

      <footer className="statusbar">
        {selected ? (
          <span>
            選択中: 角度 {selected.angle}° / 長さ{' '}
            {Math.round(distance(selected.start, selected.end))} px
            <span className="hint">（属性設定はフェーズ2で追加予定）</span>
          </span>
        ) : (
          <span className="hint">
            指でドラッグして線を描画（アイソメ角に自動スナップ）／線をタップで選択
          </span>
        )}
        <span className="count">セグメント数: {segments.length}</span>
      </footer>
    </div>
  )
}
