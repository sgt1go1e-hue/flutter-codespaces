import { useEffect, useMemo, useRef, useState } from 'react'
import { DrawingCanvas } from './components/DrawingCanvas'
import { SegmentPanel, DrawSettingsPanel } from './components/AttributePanel'
import { PartsPalette } from './components/PartsPalette'
import { DisclaimerModal } from './components/DisclaimerModal'
import { BomModal } from './components/BomModal'
import { computeBom } from './lib/bom'
import { useLocalStorage } from './hooks/useLocalStorage'
import {
  distanceToSegment,
  projectOnSegment,
  samePoint,
} from './lib/isometric'
import type { Point } from './types'
import { computeCrossoverGaps } from './lib/crossover'
import { normalizeBranchSplits } from './lib/branching'
import { computeAllCut } from './lib/cutlength'
import {
  buildSegmentMap,
  computeEffective,
  inheritedPipeType,
  inheritedSize,
} from './lib/inheritance'
import { getPart } from './data/parts'
import { sizesForPipeType, nextSmallerSize } from './data/masters'
import type { Segment } from './types'

const STORAGE_KEY = 'piping-iso:segments'
// パーツをドロップしたとき、対象セグメントを拾うヒット距離(px)
const DROP_HIT = 28
// 免責事項の版。文面を更新して再同意を求めたい場合はこの数値を上げる。
const CONSENT_VERSION = 1

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
    // pipeType/size/fitting は持たせない → A から継承・自動
  }
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

// レジューサー: ドロップ位置でセグメントを前後に分割し、下流(B)を1段小さいサイズにする。
// A(上流)は元サイズを保持、B(下流)は小径＋レジューサー継手＋相手径=A径。交点以外にも挿入可。
function splitForReducer(
  segments: Segment[],
  targetId: string,
  dropPoint: Point,
  kind: 'concentric' | 'eccentric',
  largeSize: string | undefined,
  smallSize: string | undefined,
): Segment[] {
  const target = segments.find((s) => s.id === targetId)
  if (!target) return segments
  const { point: P, t } = projectOnSegment(dropPoint, target.start, target.end)
  if (t < 0.02 || t > 0.98) return segments // 端に寄りすぎは無視

  const bId = makeId()
  const A: Segment = { ...target, end: P }
  const B: Segment = {
    id: bId,
    start: P,
    end: target.end,
    angle: target.angle,
    parentId: target.id,
    size: smallSize,
    fitting: `reducer_${kind}`,
    reducerSize: largeSize,
  }
  const result: Segment[] = []
  for (const s of segments) {
    if (s.id === targetId) {
      result.push(A)
      continue
    }
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
  // 「作図設定」バーの開閉（寸法入力とは独立。既定は畳んだ状態で割り込まない）
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 免責事項への同意記録（版＋同意日時を端末に保存）
  const [consent, setConsent] = useLocalStorage<{
    version?: number
    agreedAt?: string
  }>('piping-iso:consent', {})
  // 免責事項の再確認モーダル（設定からいつでも表示）
  const [reviewDisclaimer, setReviewDisclaimer] = useState(false)
  // 材料集計(BOM)モーダルの表示
  const [showBom, setShowBom] = useState(false)
  const needConsent = consent.version !== CONSENT_VERSION
  // これから描く線に適用する初期設定（線を選択せず通常画面で入力）
  const [defaults, setDefaults] = useLocalStorage<{
    pipeType?: string
    size?: string
    connection?: string
    /** 切り寸法の丸め方（既定=四捨五入）。継手寸法には適用しない。 */
    roundMode?: 'round' | 'floor'
  }>('piping-iso:defaults', {})
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
    () => computeAllCut(segments, effectiveById, defaults.roundMode ?? 'round'),
    [segments, effectiveById, defaults.roundMode],
  )
  // 材料集計(BOM)。モーダルを開いたときに使う。
  const bom = useMemo(
    () => computeBom(segments, effectiveById, cutById),
    [segments, effectiveById, cutById],
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
    const applied: Segment = { ...seg, id: makeId(), parentId }
    // 接続方法は継承対象外なので、全ての新規線に初期設定を適用
    if (defaults.connection) applied.connection = defaults.connection
    // 管種・サイズはルート(接続元なし)にのみ付与。続きの線は上流から継承。
    if (!parentId) {
      if (defaults.pipeType) applied.pipeType = defaults.pipeType
      if (defaults.size) applied.size = defaults.size
    }
    // 追加後、分岐点で貫通している本管を自動分割（奥側を独立して寸法入力可能に）
    setSegments((prev) => normalizeBranchSplits([...prev, applied], makeId))
  }

  // 作図設定（defaults）の更新。管種変更時はサイズ整合をとる。
  function updateDefaults(patch: Partial<typeof defaults>) {
    setDefaults((d) => {
      const next = { ...d, ...patch }
      if ('pipeType' in patch) {
        const avail = sizesForPipeType(next.pipeType).map((s) => s.code)
        if (next.size && !avail.includes(next.size)) next.size = undefined
      }
      return next
    })
  }

  function updateSelected(patch: Partial<Segment>) {
    if (!selectedId) return
    setSegments((prev) =>
      prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)),
    )
  }

  // タップで選択（寸法パネルが自動で出る。作図設定は開かない）。
  function handleSelect(id: string) {
    setSelectedId(id)
  }

  function closeSelection() {
    setSelectedId(null)
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

  function agreeDisclaimer() {
    setConsent({ version: CONSENT_VERSION, agreedAt: new Date().toISOString() })
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
    if (!part) return
    const targetId = best.id
    const dropPoint = p
    if (part.action.type === 'flange') {
      if (part.action.flange === 'double') {
        setSegments((prev) => splitForDoubleFlange(prev, targetId, dropPoint))
      } else {
        setSegments((prev) => markSingleFlange(prev, targetId, dropPoint))
      }
    } else if (part.action.type === 'reducer') {
      const kind = part.action.reducer
      const large = effectiveById[targetId]?.size
      const small = nextSmallerSize(large)
      setSegments((prev) =>
        splitForReducer(prev, targetId, dropPoint, kind, large, small),
      )
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
          <button
            className="primary"
            onClick={() => setShowBom(true)}
            disabled={segments.length === 0}
          >
            集計・拾い出し
          </button>
          <button onClick={() => setReviewDisclaimer(true)}>免責</button>
        </div>
      </header>

      <main className="stage" ref={stageRef}>
        <DrawingCanvas
          segments={segments}
          selectedId={selectedId}
          onAddSegment={addSegment}
          onSelectSegment={handleSelect}
          onBackgroundTap={closeSelection}
          effectiveById={effectiveById}
          crossoverGaps={crossoverGaps}
          cutById={cutById}
          inputDisabled={partDrag !== null}
        />

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

      {/* 寸法・属性の編集パネル（線を選択したときだけ表示。作図設定とは独立） */}
      {selected && (
        <SegmentPanel
          segment={selected}
          effective={effectiveById[selected.id]}
          inheritedPipeType={inheritedPipeType(selected, byId)}
          inheritedSize={inheritedSize(selected, byId)}
          cut={cutById[selected.id]}
          roundMode={defaults.roundMode ?? 'round'}
          onRoundModeChange={(mode) => updateDefaults({ roundMode: mode })}
          onChange={updateSelected}
          onDelete={deleteSelected}
        />
      )}

      {/* 作図設定バー（独立して開閉。選択・寸法入力では自動で開かない） */}
      <DrawSettingsPanel
        defaults={defaults}
        onChange={updateDefaults}
        open={settingsOpen}
        onToggle={() => setSettingsOpen((v) => !v)}
      />

      <PartsPalette
        onDragStart={(partId, x, y) => setPartDrag({ partId, x, y })}
        draggingId={partDrag?.partId ?? null}
      />

      <footer className="statusbar">
        <span className="hint">
          ドラッグで描画／線をタップで選択（寸法・属性を編集）
        </span>
        <span className="count">セグメント数: {segments.length}</span>
      </footer>

      {/* 材料集計(BOM) */}
      {showBom && <BomModal bom={bom} onClose={() => setShowBom(false)} />}

      {/* 初回同意（同意するまで他操作をブロック） */}
      {needConsent && (
        <DisclaimerModal mode="consent" onAgree={agreeDisclaimer} />
      )}
      {/* 設定からの再確認（同意済みのときのみ） */}
      {!needConsent && reviewDisclaimer && (
        <DisclaimerModal
          mode="review"
          agreedAt={consent.agreedAt}
          onAgree={() => setReviewDisclaimer(false)}
          onClose={() => setReviewDisclaimer(false)}
        />
      )}
    </div>
  )
}
