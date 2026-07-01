import { useEffect, useMemo, useRef, useState } from 'react'
import { DrawingCanvas } from './components/DrawingCanvas'
import { SegmentActionMenu } from './components/SegmentActionMenu'
import { AttributePopup } from './components/AttributePopup'
import { PartsPalette } from './components/PartsPalette'
import { useLocalStorage } from './hooks/useLocalStorage'
import { distanceToSegment, samePoint } from './lib/isometric'
import { computeCrossoverGaps } from './lib/crossover'
import {
  buildSegmentMap,
  computeEffective,
  inheritedPipeType,
  inheritedSize,
} from './lib/inheritance'
import { getPart } from './data/parts'
import type { Segment } from './types'

const STORAGE_KEY = 'piping-iso:segments'
// パーツをドロップしたとき、対象セグメントを拾うヒット距離(px)
const DROP_HIT = 28

function makeId(): string {
  return `seg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export default function App() {
  const [segments, setSegments] = useLocalStorage<Segment[]>(STORAGE_KEY, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [attrOpen, setAttrOpen] = useState(false)
  // パーツパレットからのドラッグ状態（画面座標で ghost を追従表示）
  const [partDrag, setPartDrag] = useState<{
    partId: string
    x: number
    y: number
  } | null>(null)

  const stageRef = useRef<HTMLElement>(null)

  const selected = useMemo(
    () => segments.find((s) => s.id === selectedId) ?? null,
    [segments, selectedId],
  )

  // 実効属性（継承後）と、またぎ表示の途切れ位置をまとめて計算
  const effectiveById = useMemo(() => computeEffective(segments), [segments])
  const crossoverGaps = useMemo(() => computeCrossoverGaps(segments), [segments])
  const byId = useMemo(() => buildSegmentMap(segments), [segments])

  // 新規セグメントの親（上流）を、始点が接続している既存セグメントから決定する
  function findParentId(start: Segment['start']): string | undefined {
    const ends = segments.filter((s) => samePoint(s.end, start))
    if (ends.length) return ends[ends.length - 1].id
    const starts = segments.filter((s) => samePoint(s.start, start))
    if (starts.length) return starts[starts.length - 1].id
    // 中間分岐（チーズ）: 既存セグメントの途中に始点が乗っている場合
    const onLine = segments.filter(
      (s) => distanceToSegment(start, s.start, s.end) < 1.5,
    )
    if (onLine.length) return onLine[onLine.length - 1].id
    return undefined
  }

  function addSegment(seg: Omit<Segment, 'id'>) {
    const parentId = findParentId(seg.start)
    setSegments((prev) => [...prev, { ...seg, id: makeId(), parentId }])
  }

  function updateSelected(patch: Partial<Segment>) {
    if (!selectedId) return
    setSegments((prev) =>
      prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)),
    )
  }

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

  // --- パーツ ドラッグ&ドロップ ---
  function dropPart(partId: string, clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = { x: clientX - rect.left, y: clientY - rect.top }
    let best: Segment | null = null
    let bestDist = DROP_HIT
    for (const s of segments) {
      const d = distanceToSegment(p, s.start, s.end)
      if (d <= bestDist) {
        bestDist = d
        best = s
      }
    }
    if (!best) return
    const part = getPart(partId)
    if (part?.action.type === 'setConnection') {
      const value = part.action.value
      const targetId = best.id
      setSegments((prev) =>
        prev.map((s) => (s.id === targetId ? { ...s, connection: value } : s)),
      )
    }
  }
  // 最新の dropPart / segments を参照するための ref
  const dropRef = useRef(dropPart)
  dropRef.current = dropPart

  useEffect(() => {
    if (!partDrag) return
    const onMove = (e: PointerEvent) =>
      setPartDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
    const onUp = (e: PointerEvent) => {
      const d = partDrag
      if (d) dropRef.current(d.partId, e.clientX, e.clientY)
      setPartDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // partDrag の開始/終了でのみ再バインド
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partDrag?.partId])

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

      <main className="stage" ref={stageRef}>
        <DrawingCanvas
          segments={segments}
          selectedId={selectedId}
          onAddSegment={addSegment}
          onLongPressSegment={handleLongPress}
          effectiveById={effectiveById}
          crossoverGaps={crossoverGaps}
          inputDisabled={partDrag !== null}
        />

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

        {attrOpen && selected && (
          <AttributePopup
            segment={selected}
            inheritedPipeType={inheritedPipeType(selected, byId)}
            inheritedSize={inheritedSize(selected, byId)}
            onChange={updateSelected}
            onClose={closeSelection}
          />
        )}

        {/* ドラッグ中のパーツ ghost */}
        {partDrag && (
          <div
            className="part-ghost"
            style={{ left: partDrag.x, top: partDrag.y }}
          >
            {getPart(partDrag.partId)?.icon}
          </div>
        )}
      </main>

      <PartsPalette
        onDragStart={(partId, x, y) => setPartDrag({ partId, x, y })}
        draggingId={partDrag?.partId ?? null}
      />

      <footer className="statusbar">
        <span className="hint">
          ドラッグで描画（グリッド交点間・アイソメ角に自動スナップ）／線を長押しで選択
        </span>
        <span className="count">セグメント数: {segments.length}</span>
      </footer>
    </div>
  )
}
