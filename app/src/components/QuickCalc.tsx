import { useEffect, useMemo, useRef, useState } from 'react'
import { pipeTypes, sizesForPipeType, getSizeInfo, connectionMethods, nominalOf, type DimValue } from '../data/masters'
import type { RoundMode } from '../lib/cutlength'
import {
  computeQuickCut,
  computeOffset45,
  isRiserEnd,
  type OffsetEnd,
  connectionKindOf,
  quickEndAllowance,
  type QuickCalcInput,
  type QuickEndInput,
  type QuickFittingKind,
} from '../lib/quickCalc'
import {
  initialCalcState,
  calcCurrentTotal,
  calcStateFromValue,
  calcEvaluate,
  type CalcState,
} from '../lib/calcExpr'
import {
  FITTING_GROUPS,
  fittingsOfGroup,
  fittingChipLabel,
  shapeOf,
  dimKeyLabel,
  nominalLabel,
  dimRows,
  dimHeaders,
  inchLabel,
} from '../lib/fittingTable'
import type { ConnectionKind } from '../lib/takeout'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSwipeDismiss } from '../hooks/useSwipeDismiss'
import { socketDepth } from '../data/socketDepths'
import { CalcKeypad } from './CalcKeypad'
import { DrumWheel } from './DrumWheel'
import { QuickCalcRecords, addRecord, type QcRecord, type QcFile } from './QuickCalcRecords'
import { hasFullAccess } from '../lib/subscription'
import { StraightDiagram, OffsetDiagram, FittingFigure } from './QuickCalcDiagrams'

interface Props {
  onClose: () => void
  /** 職長プランの機能を使おうとしたとき、購入案内を出す（App.tsx の requirePaid） */
  onRequirePaid: (action: () => void) => void
}

type Tab = 'straight' | 'offset' | 'table'

const TABS: { id: Tab; label: string }[] = [
  { id: 'straight', label: '芯引き' },
  { id: 'offset', label: '45°振り' },
  { id: 'table', label: '引しろ表' },
]

const END_KIND_OPTIONS: { value: QuickFittingKind; label: string }[] = [
  { value: 'free', label: 'なし' },
  { value: 'elbow90_long', label: '90°L' },
  { value: 'elbow90_short', label: '90°S' },
  { value: 'elbow45', label: '45°' },
  { value: 'tee', label: 'T メイン' },
  { value: 'tee_branch', label: 'T 枝' },
  { value: 'flange', label: 'フランジ' },
]

const needsCounterpart = (k: QuickFittingKind) => k === 'tee' || k === 'tee_branch'

interface Prefs {
  tab: Tab
  pipeType?: string
  size?: string
  connection?: string
  vpSeries?: 'dv' | 'ts'
  roundMode: RoundMode
  rawMode: boolean
  left: QuickEndInput
  right: QuickEndInput
  offsetGiven: 'offset' | 'travel' | 'cut'
  /** 45°振りの下側(s1)・上側(s2)の継手。立て管から振るときは90°エルボ */
  offsetEnd1?: OffsetEnd
  offsetEnd2?: OffsetEnd
  tableGroup?: ConnectionKind
  tableFitting?: string
  tableKey?: string
  /** 記録の保存先(現場ファイルのid)。無ければメモ */
  currentFileId?: string
}

const DEFAULT_PREFS: Prefs = {
  tab: 'straight',
  pipeType: 'sgp',
  connection: 'weld',
  size: '25A',
  roundMode: 'round',
  rawMode: false,
  left: { kind: 'elbow90_long', basis: 'center' },
  right: { kind: 'elbow90_long', basis: 'center' },
  offsetGiven: 'offset',
}

// 前回の管種・サイズ・継手を覚えておき、開いたらすぐ寸法を打てるようにする
const PREFS_KEY = 'quickcalc.prefs.v1'
// 記録(旧「履歴」)。キーは以前のままにして、これまでの履歴をそのまま引き継ぐ
const HISTORY_KEY = 'quickcalc.history.v1'
const FILES_KEY = 'quickcalc.files.v1'

const fmt = (n: number | undefined) => (n == null ? '—' : String(Math.round(n * 10) / 10))

function Chips<T extends string>({
  options,
  value,
  onPick,
  className,
  scroll,
}: {
  options: { value: T; label: string }[]
  value: T | undefined
  onPick: (v: T) => void
  className?: string
  /** 1行で横スクロールにする（選択中のボタンが見える位置まで自動で寄せる） */
  scroll?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scroll) return
    const box = ref.current
    const active = box?.querySelector<HTMLElement>('.qc-chip.active')
    if (!box || !active) return
    box.scrollLeft = active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2
  }, [scroll, value])
  return (
    <div
      ref={ref}
      className={`qc-chips${scroll ? ' scroll' : ''}${className ? ` ${className}` : ''}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`qc-chip${o.value === value ? ' active' : ''}`}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function QuickCalc({ onClose, onRequirePaid }: Props) {
  const [stored, setStored] = useLocalStorage<Partial<Prefs>>(PREFS_KEY, {})
  const prefs: Prefs = { ...DEFAULT_PREFS, ...stored }
  const setPrefs = (patch: Partial<Prefs>) => setStored((prev) => ({ ...prev, ...patch }))
  const { tab, pipeType, size, connection, vpSeries, roundMode, rawMode, left, right } = prefs

  const [records, setRecords] = useLocalStorage<QcRecord[]>(HISTORY_KEY, [])
  const [files, setFiles] = useLocalStorage<QcFile[]>(FILES_KEY, [])
  // 記録は無料版でもメモ5件まで。メモ30件・現場ファイルは職長プラン(無料期間中を含む)
  const recordsUnlocked = hasFullAccess()
  const currentFileId =
    recordsUnlocked && files.some((f) => f.id === prefs.currentFileId) ? prefs.currentFileId : undefined
  // 芯引きは a(全体芯々) と L(切り寸) のどちらからでも計算できる。入力中の方を field で持つ
  const [straightField, setStraightField] = useState<'a' | 'L'>('a')
  const [calcA, setCalcA] = useState<CalcState>(initialCalcState)
  const [calcL, setCalcL] = useState<CalcState>(initialCalcState)
  const calcStraight = straightField === 'a' ? calcA : calcL
  const setCalcStraight = straightField === 'a' ? setCalcA : setCalcL
  const [calcOffset, setCalcOffset] = useState<CalcState>(initialCalcState)
  const [selectedEnd, setSelectedEnd] = useState<'left' | 'right'>('left')
  // テンキーは寸法の枠をタップしたときだけ下から出す
  const [keypadOpen, setKeypadOpen] = useState(false)
  // 初めて開いたときは、管種・接続・サイズを選んでもらうためドラムを開いておく
  const [specOpen, setSpecOpen] = useState(!stored.size)

  const sizes = sizesForPipeType(pipeType)
  const od = getSizeInfo(size)?.od
  const pipeShort = pipeTypes.find((p) => p.id === pipeType)?.short
  const connLabel =
    pipeType === 'vp'
      ? vpSeries === 'ts'
        ? 'TS継手'
        : 'DV継手'
      : (connectionMethods.find((c) => c.id === connection)?.name ?? '突合せ溶接')

  // ---- 芯引き ----
  const base: QuickCalcInput = { pipeType, size, connection, vpSeries, overall: undefined, roundMode, left, right }
  // 控え(s1/s2)は寸法と無関係に決まるので、先に求めておく(Lから逆算するときに使う)
  const allows = computeQuickCut(base)
  const givenA = calcCurrentTotal(calcA)
  const givenL = calcCurrentTotal(calcL)
  const overall =
    straightField === 'a'
      ? givenA
      : givenL != null
        ? Math.round((givenL + allows.startAllow + allows.endAllow) * 10) / 10
        : undefined
  const result = computeQuickCut({ ...base, overall })
  const straightCut =
    straightField === 'L'
      ? givenL
      : result.status === 'ok'
        ? rawMode && result.rawCut != null
          ? result.rawCut
          : result.cut
        : undefined

  function pickStraightField(f: 'a' | 'L') {
    setKeypadOpen(true)
    setSpecOpen(false)
    if (f === straightField) return
    // 切り替えたら、今出ている値を入力の初期値にする(続けて足し引きできるように)
    if (f === 'L' && straightCut != null) setCalcL(calcStateFromValue(straightCut))
    if (f === 'a' && overall != null) setCalcA(calcStateFromValue(overall))
    setStraightField(f)
  }

  // ---- 45°振り ----
  const offsetValue = calcCurrentTotal(calcOffset)
  const offsetResult = useMemo(
    () =>
      computeOffset45({
        pipeType,
        size,
        connection,
        vpSeries,
        given: prefs.offsetGiven,
        value: offsetValue,
        roundMode,
        end1: prefs.offsetEnd1,
        end2: prefs.offsetEnd2,
      }),
    [pipeType, size, connection, vpSeries, prefs.offsetGiven, offsetValue, roundMode, prefs.offsetEnd1, prefs.offsetEnd2],
  )
  const riser1 = isRiserEnd(prefs.offsetEnd1)
  const riser2 = isRiserEnd(prefs.offsetEnd2)
  // 水平の長さの呼び方: 45°エルボの端はツラ、立て管の端は芯
  const faceLabel = riser1 && riser2 ? '芯〜芯' : riser1 || riser2 ? '芯〜ツラ' : 'ツラ〜ツラ'
  const offsetCut =
    offsetResult.status === 'ok'
      ? rawMode && offsetResult.rawCut != null
        ? offsetResult.rawCut
        : offsetResult.cut
      : undefined

  function pickOffsetField(g: 'offset' | 'travel' | 'cut') {
    setKeypadOpen(true)
    setSpecOpen(false)
    if (g === prefs.offsetGiven) return
    // 切り替えたら、今出ている値を入力の初期値にする
    const cur = g === 'offset' ? offsetResult.offset : g === 'travel' ? offsetResult.travel : offsetCut
    setCalcOffset(cur != null ? calcStateFromValue(cur) : initialCalcState)
    setPrefs({ offsetGiven: g })
  }

  // 図の継手の太さの比に使う実寸。「管の端から測る」でも継手そのものの引しろで描く
  function endReal(e: QuickEndInput): { a: number; od: number } | undefined {
    if (od == null) return undefined
    const mm = quickEndAllowance({ ...e, basis: 'center' }, size, pipeType, vpSeries, connection).mm
    return mm > 0 ? { a: mm, od } : undefined
  }

  const end = selectedEnd === 'left' ? left : right
  function updateEnd(patch: Partial<QuickEndInput>) {
    const key = selectedEnd
    setStored((prev) => {
      const cur = { ...DEFAULT_PREFS, ...prev }[key]
      return { ...prev, [key]: { ...cur, ...patch } }
    })
  }

  // 管種を変えたら、同じ呼び径(25A→VP25など)があればそれに合わせ、無ければ先頭にする
  function changePipeType(v: string) {
    const list = sizesForPipeType(v)
    const n = nominalOf(size)
    const same = list.find((x) => x.code === size) ?? list.find((x) => nominalOf(x.code) === n)
    setPrefs({
      pipeType: v,
      size: (same ?? list[0])?.code,
      ...(v === 'vp' ? {} : { vpSeries: undefined }),
    })
  }

  function addHistory(summary: string, cut: number) {
    setRecords((list) =>
      addRecord(list, { id: `${Date.now()}`, at: Date.now(), summary, cut, fileId: currentFileId }),
    )
  }

  function specText() {
    return `${size ?? 'サイズ?'} ${pipeShort ?? ''}`.trim()
  }

  function pressEqualStraight() {
    setCalcStraight((s) => {
      const { value, error } = calcEvaluate(s)
      if (error) return { ...s, error }
      if (value == null) return s
      return calcStateFromValue(value)
    })
    if (straightCut != null) {
      const ends = `${END_KIND_OPTIONS.find((o) => o.value === left.kind)?.label}〜${END_KIND_OPTIONS.find((o) => o.value === right.kind)?.label}`
      addHistory(`芯引き ${specText()} ${ends} a${fmt(overall)}${straightField === 'L' ? '(Lから)' : ''}`, straightCut)
    }
  }

  function pressEqualOffset() {
    setCalcOffset((s) => {
      const { value, error } = calcEvaluate(s)
      if (error) return { ...s, error }
      if (value == null) return s
      return calcStateFromValue(value)
    })
    if (offsetCut != null) {
      addHistory(
        `45°振り ${specText()} b${fmt(offsetResult.offset)} c${fmt(offsetResult.travel)} ${faceLabel}${fmt(offsetResult.faceToFace)}${riser1 || riser2 ? ' 立て' : ''}${prefs.offsetGiven === 'cut' ? '(Lから)' : ''}`,
        offsetCut,
      )
    }
  }

  // ---- 引しろ表 ----
  const specKind = connectionKindOf(pipeType, vpSeries, connection)
  const tableGroup = prefs.tableGroup ?? specKind
  const groupFittings = fittingsOfGroup(tableGroup)
  const tableFitting =
    groupFittings.find((f) => f.id === prefs.tableFitting) ?? groupFittings[0]
  const tableKeys = tableFitting ? Object.keys(tableFitting.dims) : []
  // サイズ未選択なら、芯引きで選んでいるサイズに合わせる
  const specNominal = String(nominalOf(size) ?? '')
  const tableKey =
    prefs.tableKey && tableKeys.includes(prefs.tableKey)
      ? prefs.tableKey
      : (tableKeys.find((k) => k === specNominal || k.startsWith(`${specNominal}_`)) ?? tableKeys[0])
  // 径違い("40_25")は、大きい方→小さい方の2段で選ぶ（組み合わせが多く1列だと探しにくい）
  const isPair = tableKeys.some((k) => k.includes('_'))
  const pairFirsts = isPair ? [...new Set(tableKeys.map((k) => k.split('_')[0]))] : []
  const pairFirst = tableKey?.split('_')[0]
  const pairSeconds = isPair ? tableKeys.filter((k) => k.split('_')[0] === pairFirst) : []
  const tableRows = tableFitting && tableKey ? dimRows(tableFitting, tableFitting.dims[tableKey]) : []
  const tableInch = tableKey && !tableKey.includes('_') ? inchLabel(tableKey, tableGroup) : ''
  // 管の入り代(ねじ込み・塩ビのエルボ・T)。径違いTの枝は枝の呼び径で引く
  const tableIns = (() => {
    if (!tableFitting || !tableKey) return undefined
    const shape = shapeOf(tableFitting)
    if (shape !== 'elbow90' && shape !== 'elbow45' && shape !== 'tee') return undefined
    const [n1, n2] = tableKey.split('_')
    const main = socketDepth(tableGroup, n1)
    if (main == null) return undefined
    return { main, branch: shape === 'tee' ? socketDepth(tableGroup, n2 ?? n1) : undefined }
  })()
  const jump = tableFitting && tableKey ? planJump(tableFitting.id, tableKey, tableGroup, pipeType) : undefined

  // 引しろ表で見ている継手・サイズを、芯引きの左端にそのまま入れて計算を始める
  function jumpToStraight() {
    if (!jump) return
    setPrefs({
      tab: 'straight',
      pipeType: jump.pipeType,
      connection: jump.connection ?? connection,
      vpSeries: jump.vpSeries,
      size: jump.size,
      left: { ...left, ...jump.end },
    })
    setSelectedEnd('left')
    setSpecOpen(false)
    setStraightField('a')
    setKeypadOpen(true)
  }

  const roundToggle = (
    <div className="qc-round">
      <button
        className={!rawMode && roundMode === 'round' ? 'active' : ''}
        onClick={() => setPrefs({ rawMode: false, roundMode: 'round' })}
      >
        四捨五入
      </button>
      <button
        className={!rawMode && roundMode === 'floor' ? 'active' : ''}
        onClick={() => setPrefs({ rawMode: false, roundMode: 'floor' })}
      >
        切り捨て
      </button>
      <button className={rawMode ? 'active' : ''} onClick={() => setPrefs({ rawMode: true })}>
        小数
      </button>
    </div>
  )

  const historyBlock = (
    <QuickCalcRecords
      locked={!recordsUnlocked}
      onUnlock={() => onRequirePaid(() => {})}
      records={records}
      setRecords={setRecords}
      files={files}
      setFiles={setFiles}
      currentFileId={currentFileId}
      setCurrentFileId={(id) => setStored((prev) => ({ ...prev, currentFileId: id }))}
    />
  )

  return (
    <div className="qc-screen">
      <header className="topbar">
        <div className="title">クイック計算</div>
        <div className="tools">
          <button onClick={onClose}>作図に戻る</button>
        </div>
      </header>

      <nav className="qc-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            onClick={() => {
              setPrefs({ tab: t.id })
              setKeypadOpen(false)
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className={`qc-body${keypadOpen && tab !== 'table' ? ' with-sheet' : ''}`}>
        {tab !== 'table' && (
          <div className="qc-spec">
            <button type="button" className="qc-spec-bar" onClick={() => setSpecOpen((o) => !o)}>
              <span className="qc-spec-main">
                【{size ?? 'サイズを選ぶ'}
                {pipeShort ? ` ${pipeShort}` : ''}】
              </span>
              <span className="qc-spec-sub">
                {connLabel}
                {od != null && ` ⌀${od}`}
              </span>
              <span className="qc-spec-caret">{specOpen ? '▲' : '▼'}</span>
            </button>
            {specOpen && (
              <div className="qc-spec-panel">
                <div className="qc-drums">
                  <DrumWheel
                    label="管種"
                    items={pipeTypes.map((p) => ({ value: p.id, label: p.short }))}
                    value={pipeType}
                    onChange={changePipeType}
                  />
                  {pipeType === 'vp' ? (
                    <DrumWheel
                      label="継手"
                      items={[
                        { value: 'dv', label: 'DV 排水' },
                        { value: 'ts', label: 'TS 給水' },
                      ]}
                      value={vpSeries ?? 'dv'}
                      onChange={(v) => setPrefs({ vpSeries: v as 'dv' | 'ts' })}
                    />
                  ) : (
                    <DrumWheel
                      label="接続"
                      items={connectionMethods.map((c) => ({
                        value: c.id,
                        label: c.name,
                      }))}
                      value={connection ?? 'weld'}
                      onChange={(v) => setPrefs({ connection: v })}
                    />
                  )}
                  <DrumWheel
                    label="サイズ"
                    items={sizes.map((s) => ({ value: s.code, label: s.label }))}
                    value={size}
                    onChange={(v) => setPrefs({ size: v })}
                  />
                </div>
                <button type="button" className="qc-spec-done" onClick={() => setSpecOpen(false)}>
                  決定
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'straight' && (
          <>
            <div className="qc-figure-card">
              <StraightDiagram
                joint={connectionKindOf(pipeType, vpSeries, connection)}
                leftReal={endReal(left)}
                rightReal={endReal(right)}
                leftKind={left.kind}
                rightKind={right.kind}
                leftFace={left.basis === 'face'}
                rightFace={right.basis === 'face'}
                selected={selectedEnd}
                onSelect={setSelectedEnd}
                overallText={overall != null ? fmt(overall) : '?'}
                s1Text={fmt(result.startAllow)}
                s2Text={fmt(result.endAllow)}
                cutText={straightCut != null ? fmt(straightCut) : result.status === 'zero' ? '0' : '?'}
                cutState={straightCut != null ? 'ok' : result.status === 'over' ? 'bad' : 'none'}
                field={straightField}
                onField={pickStraightField}
              />
              <div className="qc-figure-hint">枠をタップで a・L を入力／左右をタップで継手を選ぶ</div>
            </div>

            <div className="qc-end-editor">
              <div className="qc-end-tabs">
                <button
                  type="button"
                  className={selectedEnd === 'left' ? 'active' : ''}
                  onClick={() => setSelectedEnd('left')}
                >
                  左端 s1
                </button>
                <button
                  type="button"
                  className={selectedEnd === 'right' ? 'active' : ''}
                  onClick={() => setSelectedEnd('right')}
                >
                  右端 s2
                </button>
              </div>
              <Chips
                options={END_KIND_OPTIONS}
                value={end.kind}
                onPick={(v) => updateEnd({ kind: v })}
              />
              {end.kind !== 'free' && (
                <div className="qc-round qc-basis">
                  <button
                    className={end.basis === 'center' ? 'active' : ''}
                    onClick={() => updateEnd({ basis: 'center' })}
                  >
                    継手の芯から測る
                  </button>
                  <button
                    className={end.basis === 'face' ? 'active' : ''}
                    onClick={() => updateEnd({ basis: 'face' })}
                  >
                    管の端から測る
                  </button>
                </div>
              )}
              {end.kind === 'tee' && pipeType === 'vp' && (vpSeries ?? 'dv') === 'dv' && end.basis === 'center' && (
                <div className="qc-round qc-basis">
                  <button
                    className={end.dvMainSide !== 'far' ? 'active' : ''}
                    onClick={() => updateEnd({ dvMainSide: 'near' })}
                  >
                    DT 下流側（Z1）
                  </button>
                  <button
                    className={end.dvMainSide === 'far' ? 'active' : ''}
                    onClick={() => updateEnd({ dvMainSide: 'far' })}
                  >
                    DT 上流側（Z2）
                  </button>
                </div>
              )}
              {needsCounterpart(end.kind) && (
                <DrumWheel
                  label={end.kind === 'tee' ? '枝のサイズ' : 'メインのサイズ'}
                  rows={3}
                  items={sizes.map((x) => ({ value: x.code, label: x.label }))}
                  value={end.counterpartSize ?? size}
                  onChange={(v) => updateEnd({ counterpartSize: v })}
                />
              )}
              {end.kind === 'flange' && (
                <label className="qc-inline-field">
                  <span>フランジ引きしろ(mm)</span>
                  <input
                    className="num-input"
                    type="number"
                    inputMode="decimal"
                    value={end.flangeAllow ?? ''}
                    onChange={(e) =>
                      updateEnd({ flangeAllow: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                  />
                </label>
              )}
            </div>

            {(result.startMissing || result.endMissing) && (
              <div className="qc-warn">
                {result.startMissing && result.endMissing ? '両端' : result.startMissing ? '左端' : '右端'}
                の継手は、このサイズの寸法データがありません（控え0で計算しています）
              </div>
            )}

            <div className={`qc-answer${result.status === 'over' && straightField === 'a' ? ' bad' : ''}`}>
              {straightField === 'L' ? (
                <>
                  <div className="qc-answer-row">
                    <span className="qc-answer-label accent">全体 a</span>
                    <span className="qc-answer-value accent">{overall != null ? fmt(overall) : '—'}</span>
                    <span className="qc-answer-unit">mm</span>
                  </div>
                  <div className="qc-answer-formula">
                    a = L {fmt(givenL)} ＋ s1 {fmt(result.startAllow)} ＋ s2 {fmt(result.endAllow)}
                  </div>
                </>
              ) : (
                <>
                  {result.error && !(result.status === 'none' && overall == null && size) ? (
                    <div className="qc-answer-msg">{result.error}</div>
                  ) : result.status === 'zero' ? (
                    <div className="qc-answer-msg zero">管 0mm（継手どうし直結）</div>
                  ) : (
                    <div className="qc-answer-row">
                      <span className="qc-answer-label">切り寸 L</span>
                      <span className="qc-answer-value">{straightCut != null ? fmt(straightCut) : '—'}</span>
                      <span className="qc-answer-unit">mm</span>
                    </div>
                  )}
                  <div className="qc-answer-formula">
                    L = a {fmt(overall)} − s1 {fmt(result.startAllow)} − s2 {fmt(result.endAllow)}
                  </div>
                  {roundToggle}
                </>
              )}
            </div>

            {historyBlock}
          </>
        )}

        {tab === 'offset' && (
          <>
            <div className="qc-figure-card">
              <OffsetDiagram
                joint={connectionKindOf(pipeType, vpSeries, connection)}
                real1={od != null && offsetResult.allow1 > 0 ? { a: offsetResult.allow1, od } : undefined}
                real2={od != null && offsetResult.allow2 > 0 ? { a: offsetResult.allow2, od } : undefined}
                riser1={isRiserEnd(prefs.offsetEnd1)}
                riser2={isRiserEnd(prefs.offsetEnd2)}
                onEnd={(n) => {
                  // 継手をタップするたびに 45°エルボ → 立て90°エルボ → 45°エルボ … と切り替える
                  const key = n === 1 ? 'offsetEnd1' : 'offsetEnd2'
                  const cur = prefs[key]
                  setPrefs({ [key]: isRiserEnd(cur) ? 'elbow45' : 'elbow90_long' })
                }}
                given={prefs.offsetGiven}
                onGiven={pickOffsetField}
                offsetText={fmt(offsetResult.offset) === '—' ? '?' : fmt(offsetResult.offset)}
                travelText={fmt(offsetResult.travel) === '—' ? '?' : fmt(offsetResult.travel)}
                s1Text={fmt(offsetResult.allow1)}
                s2Text={fmt(offsetResult.allow2)}
                cutText={offsetCut != null ? fmt(offsetCut) : offsetResult.status === 'zero' ? '0' : '?'}
                cutState={offsetCut != null ? 'ok' : offsetResult.status === 'over' ? 'bad' : 'none'}
                faceText={offsetResult.faceToFace != null ? fmt(offsetResult.faceToFace) : '?'}
              />
              <div className="qc-figure-hint">枠で b・c・L を入力／継手タップで 45°⇔立て90°</div>
            </div>

            <div className="qc-end-editor qc-offset-ends">
              {([1, 2] as const).map((n) => {
                const key = n === 1 ? 'offsetEnd1' : 'offsetEnd2'
                const opts: { value: OffsetEnd; label: string }[] = [
                  { value: 'elbow45', label: '45°エルボ' },
                  { value: 'elbow90_long', label: specKind === 'buttweld' ? '立て90°L' : '立て90°' },
                  ...(specKind === 'buttweld' ? [{ value: 'elbow90_short' as OffsetEnd, label: '立て90°S' }] : []),
                ]
                return (
                  <div key={n} className="qc-offset-end">
                    <span className="qc-offset-end-label">{n === 1 ? '下 s1' : '上 s2'}</span>
                    <Chips options={opts} value={prefs[key] ?? 'elbow45'} onPick={(v) => setPrefs({ [key]: v })} />
                  </div>
                )
              })}
            </div>

            {(offsetResult.missing1 || offsetResult.missing2) && (
              <div className="qc-warn">
                {offsetResult.missing1 && offsetResult.missing2 ? '両端' : offsetResult.missing1 ? '下側' : '上側'}
                の継手は、このサイズの寸法データがありません（控え0で計算しています）
              </div>
            )}

            <div className={`qc-answer${offsetResult.status === 'over' ? ' bad' : ''}`}>
              {prefs.offsetGiven === 'cut' ? (
                <div className="qc-answer-row">
                  <span className="qc-answer-label accent">オフセット b</span>
                  <span className="qc-answer-value accent">{fmt(offsetResult.offset)}</span>
                  <span className="qc-answer-unit">mm</span>
                </div>
              ) : offsetResult.error && !(offsetResult.status === 'none' && offsetValue == null && size) ? (
                <div className="qc-answer-msg">{offsetResult.error}</div>
              ) : offsetResult.status === 'zero' ? (
                <div className="qc-answer-msg zero">管 0mm（エルボどうし直結）</div>
              ) : (
                <div className="qc-answer-row">
                  <span className="qc-answer-label">切り寸 L</span>
                  <span className="qc-answer-value">{offsetCut != null ? fmt(offsetCut) : '—'}</span>
                  <span className="qc-answer-unit">mm</span>
                </div>
              )}
              <div className="qc-answer-formula">
                {prefs.offsetGiven === 'cut'
                  ? `c = L ${fmt(offsetCut)} ＋ s1 ${fmt(offsetResult.allow1)} ＋ s2 ${fmt(offsetResult.allow2)} = ${fmt(offsetResult.travel)}`
                  : `L = c ${fmt(offsetResult.travel)} − s1 ${fmt(offsetResult.allow1)} − s2 ${fmt(offsetResult.allow2)}`}
              </div>
              {offsetResult.faceToFace != null && (
                <div className="qc-answer-face">
                  <span>{faceLabel}（水平）</span>
                  <b>{fmt(offsetResult.faceToFace)}</b>
                  <span>mm</span>
                  <small>
                    = b {fmt(offsetResult.offset)}
                    {riser1 ? '（下は立て管の芯）' : ` ＋ s1 ${fmt(offsetResult.allow1)}`}
                    {riser2 ? '（上は立て管の芯）' : ` ＋ s2 ${fmt(offsetResult.allow2)}`}
                  </small>
                </div>
              )}
              {prefs.offsetGiven !== 'cut' && roundToggle}
            </div>

            {historyBlock}
          </>
        )}

        {tab === 'table' && (
          <>
            <div className="qc-drums qc-drums-table">
              <DrumWheel
                label="種類"
                rows={3}
                items={FITTING_GROUPS.map((g) => ({ value: g.kind, label: g.label }))}
                value={tableGroup}
                onChange={(v) => setPrefs({ tableGroup: v, tableFitting: undefined, tableKey: undefined })}
              />
              <DrumWheel
                label="継手"
                rows={3}
                className="drum-wide"
                items={groupFittings.map((f) => ({ value: f.id, label: fittingChipLabel(f) }))}
                value={tableFitting?.id}
                onChange={(v) => setPrefs({ tableFitting: v, tableKey: undefined })}
              />
            </div>
            <div className={`qc-drums ${isPair ? 'qc-drums-pair' : 'qc-drums-one'}`}>
              {isPair ? (
                <>
                  <DrumWheel
                    label="メイン（大）"
                    rows={3}
                    items={pairFirsts.map((n) => ({ value: n, label: nominalLabel(n, tableGroup) }))}
                    value={pairFirst}
                    onChange={(n) => setPrefs({ tableKey: tableKeys.find((k) => k.split('_')[0] === n) })}
                  />
                  <DrumWheel
                    label="枝・小径"
                    rows={3}
                    items={pairSeconds.map((k) => ({ value: k, label: nominalLabel(k.split('_')[1], tableGroup) }))}
                    value={tableKey}
                    onChange={(v) => setPrefs({ tableKey: v })}
                  />
                </>
              ) : (
                <DrumWheel
                  label="サイズ"
                  rows={3}
                  items={tableKeys.map((k) => ({ value: k, label: dimKeyLabel(k, tableGroup) }))}
                  value={tableKey}
                  onChange={(v) => setPrefs({ tableKey: v })}
                />
              )}
            </div>

            {tableFitting && tableKey && (
              <div className="qc-figure-card">
                <div className="qc-fig-title">
                  【{dimKeyLabel(tableKey, tableGroup)}
                  {tableInch && ` (${tableInch})`}】
                </div>
                <div className="qc-fig-sub">
                  <span>{fittingChipLabel(tableFitting)}</span>
                </div>
                <FittingFigure
                  shape={shapeOf(tableFitting)}
                  values={tableRows.map((r) => r.value)}
                  joint={tableGroup}
                  mm={figureMm(tableFitting.dims[tableKey], tableKey, tableGroup)}
                  fittingId={tableFitting.id}
                  ins={tableIns}
                />
                <div className="qc-fig-values">
                  {tableRows.map((r) => (
                    <div key={r.label} className="qc-fig-value">
                      <span>{r.label}</span>
                      <b>{r.value}</b>
                      <span>mm</span>
                    </div>
                  ))}
                  {tableIns && (
                    <div className="qc-fig-value ins">
                      <span>入り代</span>
                      <b>
                        {tableIns.branch != null && tableIns.branch !== tableIns.main
                          ? `${tableIns.main}/${tableIns.branch}`
                          : tableIns.main}
                      </b>
                      <span>mm</span>
                    </div>
                  )}
                </div>
                {jump && (
                  <button type="button" className="qc-jump" onClick={jumpToStraight}>
                    この継手で芯引きする →
                  </button>
                )}
                <div className="qc-fig-note">
                  芯（中心）から差込み底・端面までの参考寸法です。メーカーにより異なる場合があるため、現物・カタログと照合してお使いください。
                </div>
              </div>
            )}

            {tableFitting && (
              <div className="qc-table-wrap">
                <table className="qc-table">
                  <thead>
                    <tr>
                      <th>サイズ</th>
                      {dimHeaders(tableFitting).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableKeys.map((k) => (
                      <tr
                        key={k}
                        className={k === tableKey ? 'active' : ''}
                        onClick={() => setPrefs({ tableKey: k })}
                      >
                        <td>{dimKeyLabel(k, tableGroup)}</td>
                        {dimRows(tableFitting, tableFitting.dims[k]).map((r) => (
                          <td key={r.label}>{r.value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {keypadOpen && tab === 'straight' && (
        <KeypadSheet
          tag={straightField}
          tagClass={straightField === 'L' ? 'cut' : ''}
          calc={calcStraight}
          onChange={setCalcStraight}
          onEqual={pressEqualStraight}
          onClose={() => setKeypadOpen(false)}
          answerLabel={straightField === 'a' ? 'L' : 'a'}
          answerValue={straightField === 'a' ? straightCut : overall}
          answerClass={straightField === 'a' ? 'cut' : 'accent'}
        />
      )}
      {keypadOpen && tab === 'offset' && (
        <KeypadSheet
          tag={prefs.offsetGiven === 'offset' ? 'b' : prefs.offsetGiven === 'travel' ? 'c' : 'L'}
          tagClass={prefs.offsetGiven === 'cut' ? 'cut' : ''}
          calc={calcOffset}
          onChange={setCalcOffset}
          onEqual={pressEqualOffset}
          onClose={() => setKeypadOpen(false)}
          answerLabel={prefs.offsetGiven === 'cut' ? 'b' : 'L'}
          answerValue={prefs.offsetGiven === 'cut' ? offsetResult.offset : offsetCut}
          answerClass={prefs.offsetGiven === 'cut' ? 'accent' : 'cut'}
        />
      )}
    </div>
  )
}

/** 寸法の枠をタップしたときに下からせり上がるテンキー。閉じるボタンでしまう */
function KeypadSheet({
  tag,
  tagClass,
  calc,
  onChange,
  onEqual,
  onClose,
  answerLabel,
  answerValue,
  answerClass,
}: {
  tag: string
  tagClass: string
  calc: CalcState
  onChange: (updater: CalcState | ((prev: CalcState) => CalcState)) => void
  onEqual: () => void
  onClose: () => void
  answerLabel: string
  answerValue: number | undefined
  answerClass: string
}) {
  // 下へスライド・＝・閉じるボタンのどれでも、同じように下がって閉じる
  const { dragProps, style, dismiss } = useSwipeDismiss(onClose)
  return (
    <div className="qc-sheet" role="dialog" aria-label={`${tag} を入力`} style={style}>
      {/* 数字キー以外の上の部分をつかんで下へスライドすると閉じる */}
      <div className="qc-sheet-grab" {...dragProps}>
        <div className="qc-sheet-handle" />
        <div className="qc-sheet-head">
          <span className={`qc-overall-tag ${tagClass}`}>{tag}</span>
          <div className="qc-sheet-display">
            {calc.display || '0'}
            {calc.error && <span className="qc-calc-error">{calc.error}</span>}
          </div>
          <button
            type="button"
            className="qc-sheet-close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={dismiss}
          >
            閉じる
          </button>
        </div>
        <div className={`qc-sheet-answer ${answerClass}`}>
          <span>{answerLabel}</span>
          <b>{answerValue != null ? fmt(answerValue) : '—'}</b>
          <span>mm</span>
        </div>
      </div>
      <CalcKeypad
        onChange={onChange}
        onEqual={() => {
          // ＝は入力完了の合図。計算を確定して、テンキーを下げる
          onEqual()
          dismiss()
        }}
      />
    </div>
  )
}


interface JumpPlan {
  pipeType: string
  connection?: string
  vpSeries?: 'dv' | 'ts'
  size: string
  end: QuickEndInput
}

// 引しろ表の継手(id)とサイズキー("40" / "40_25")から、芯引きの設定を組み立てる。
// 芯引きの端で選べる継手(エルボ・T)に限り、設定した結果が同じ継手マスタを
// 参照することを確かめてから返す(レジューサー・キャップ・Y継手などは対象外)。
function planJump(
  fittingId: string,
  key: string,
  group: ConnectionKind,
  currentPipe?: string,
): JumpPlan | undefined {
  const [n1, n2] = key.split('_')
  const isVp = group === 'vp_dv' || group === 'vp_ts'
  const pipeType = isVp ? 'vp' : currentPipe && currentPipe !== 'vp' ? currentPipe : 'sgp'
  const code = (n: string) => (isVp ? `VP${n}` : `${n}A`)
  const connection =
    group === 'thread' ? 'thread' : group === 'socket' ? 'socket' : isVp ? undefined : 'weld'
  const vpSeries = group === 'vp_dv' ? 'dv' : group === 'vp_ts' ? 'ts' : undefined
  const size = code(n1)
  if (!sizesForPipeType(pipeType).some((x) => x.code === size)) return undefined

  const kind: QuickFittingKind | undefined = fittingId.startsWith('elbow90_short')
    ? 'elbow90_short'
    : fittingId.startsWith('elbow90') && !fittingId.includes('_ll_')
      ? 'elbow90_long'
      : fittingId.startsWith('elbow45')
        ? 'elbow45'
        : fittingId.startsWith('tee') || fittingId.startsWith('y90dt')
          ? 'tee'
          : undefined
  if (!kind) return undefined
  const end: QuickEndInput = {
    kind,
    basis: 'center',
    ...(kind === 'tee' ? { counterpartSize: code(n2 ?? n1) } : {}),
  }
  const resolved = quickEndAllowance(end, size, pipeType, vpSeries, connection)
  if (resolved.fittingId !== fittingId) return undefined
  return { pipeType, connection, vpSeries, size, end }
}

// 引しろ表の図を実物の太さの比で描くための寸法(mm)。引しろ・面間と管の外径
function figureMm(
  dim: DimValue | undefined,
  key: string,
  group: ConnectionKind,
): { a: number; b?: number; c?: number; od: number; bod?: number } | undefined {
  const isVp = group === 'vp_dv' || group === 'vp_ts'
  const [n1, n2] = key.split('_')
  const odOf = (n?: string) => (n ? getSizeInfo(isVp ? `VP${n}` : `${n}A`)?.od : undefined)
  const od = odOf(n1)
  if (dim == null || od == null) return undefined
  if (typeof dim === 'number') return { a: dim, od }
  if ('run' in dim) return { a: dim.run, b: dim.branch, od, bod: odOf(n2) ?? od }
  if ('near' in dim) return { a: dim.near, b: dim.far, c: dim.branch, od, bod: odOf(n2) ?? od }
  return { a: dim.H, od: dim.od1 ?? od, bod: dim.od2 ?? odOf(n2) }
}
