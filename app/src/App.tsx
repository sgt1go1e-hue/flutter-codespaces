import { useEffect, useMemo, useRef, useState } from 'react'
import { DrawingCanvas } from './components/DrawingCanvas'
import { SegmentActionMenu } from './components/SegmentActionMenu'
import { AttributePopup } from './components/AttributePopup'
import { PartsPalette } from './components/PartsPalette'
import { useLocalStorage } from './hooks/useLocalStorage'
import {
  distanceToSegment,
  projectOnSegment,
  samePoint,
} from './lib/isometric'
import type { Point } from './types'
import { computeCrossoverGaps } from './lib/crossover'
import { computeAllCut } from './lib/cutlength'
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

// 両フランジ: 対象セグメントを投影点で前後2本に分割する。
// A(上流) は元の属性を保持、B(下流) は A を親にして継承。接合ノードの両側にフランジを付ける。
function splitForDoubleFlange(
  segments: Segment[],
  targetId: string,
  dropPoint: Point,
): Segment[] {
  const target = segments.find((s) => s.id === targetId)
  if (!target) return segments
  const { point: P, t } = projectOnSegment(dropPoint, target.start, target.end)

  // 端点に極端に近い場合は分割せず、その端にフランジを付けるだけ
  if (t < 0.02) {
    return segments.map((s) =>
      s.id === targetId ? { ...s, startFlange: 'double' } : s,
    )
  }
  if (t > 0.98) {
    return segments.map((s) =>
      s.id === targetId ? { ...s, endFlange: 'double' } : s,
    )
  }

  const bId = makeId()
  const A: Segment = { ...target, end: P, endFlange: 'double' }
  const B: Segment = {
    id: bId,
    start: P,
    end: target.end,
    angle: target.angle,
    parentId: target.id,
    startFlange: 'double',
    connection: 'flange',
    endFitting: target.endFitting,
    // pipeType/size は持たせない → A から継承
  }
  // A は終点側の継手を B へ譲る（終点はもう B の終点）
  A.endFitting = undefined
  A.connection = target.connection ?? 'flange'

  const result: Segment[] = []
  for (const s of segments) {
    if (s.id === targetId) {
      result.push(A)
      continue
    }
    // 元セグメントの子のうち、下流(B)側に接続しているものは B を親に付け替える
    if (s.parentId === targetId) {
      const dA = distanceToSegment(s.start, A.start, A.end)
      const dB = distanceToSegment(s.start, B.start, B.end)
      result.push(dB < dA ? { ...s, parentId: bId } : s)
      continue
    }
    result.push(s)
  }
  const idx = result.findIndex((s) => s.id === targetId)
  result.splice(idx + 1, 0, B)
  return result
}

// 片フランジ: 分割せず、ドロップ位置に近い端を終端フランジとしてマークする。
function markSingleFlange(
  segments: Segment[],
  targetId: string,
  dropPoint: Point,
): Segment[] {
  const target = segments.find((s) => s.id === targetId)
  if (!target) return segments
  const { t } = projectOnSegment(dropPoint, target.start, target.end)
  const at = t < 0.5 ? 'startFlange' : 'endFlange'
  return segments.map((s) =>
    s.id === targetId
      ? { ...s, [at]: 'single', connection: s.connection ?? 'flange' }
      : s,
  )
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
  // 各区間の切断（加工）寸法
  const cutById = useMemo(
    () => computeAllCut(segments, effectiveById),
    [segments, effectiveById],
  )

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
    if (part?.action.type !== 'flange') return
    const targetId = best.id
    const dropPoint = p
    if (part.action.flange === 'double') {
      setSegments((prev) => splitForDoubleFlange(prev, targetId, dropPoint))
    } else {
      setSegments((prev) => markSingleFlange(prev, targetId, dropPoint))
    }
    // 分割後は選択状態をリセット（前後が別データになるため）
    setSelectedId(null)
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
          cutById={cutById}
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
            cut={cutById[selected.id]}
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
