import { useMemo, useState } from 'react'
import {
  pipeTypes,
  sizesForPipeType,
  getSizeInfo,
  connectionMethods,
} from '../data/masters'
import type { RoundMode } from '../lib/cutlength'
import {
  computeQuickCut,
  type QuickCalcInput,
  type QuickEndInput,
  type QuickFittingKind,
} from '../lib/quickCalc'
import {
  initialCalcState,
  calcCurrentTotal,
  calcStateFromValue,
  calcPressDigit,
  calcPressDoubleZero,
  calcPressDot,
  calcPressOp,
  calcPressSign,
  calcPressClear,
  calcPressBackspace,
  calcEvaluate,
  type CalcState,
} from '../lib/calcExpr'

interface Props {
  onClose: () => void
}

const END_KIND_OPTIONS: { value: QuickFittingKind; label: string }[] = [
  { value: 'free', label: 'フリー端（継手なし）' },
  { value: 'elbow90_long', label: '90°エルボ（ロング）' },
  { value: 'elbow90_short', label: '90°エルボ（ショート）' },
  { value: 'elbow45', label: '45°エルボ' },
  { value: 'tee', label: 'チーズ（ラン）' },
  { value: 'reducer_concentric', label: '同心レジューサー' },
  { value: 'reducer_eccentric', label: '偏心レジューサー' },
  { value: 'flange', label: 'フランジ' },
]

const needsCounterpart = (k: QuickFittingKind) =>
  k === 'tee' || k === 'reducer_concentric' || k === 'reducer_eccentric'

function defaultEnd(): QuickEndInput {
  return { kind: 'free', basis: 'center' }
}

interface HistoryEntry {
  id: string
  summary: string
  cut: number
}

// 電卓の各キーの当たり判定を大きめに（手袋操作を想定）
function KeyButton({
  label,
  onClick,
  variant,
  gridColumn,
  gridRow,
}: {
  label: string
  onClick: () => void
  variant?: 'op' | 'equal' | 'clear'
  gridColumn?: string
  gridRow?: string
}) {
  const style =
    gridColumn || gridRow
      ? { gridColumn: gridColumn, gridRow: gridRow }
      : undefined
  return (
    <button
      type="button"
      className={`qc-key${variant ? ` qc-key-${variant}` : ''}`}
      style={style}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function EndFittingEditor({
  label,
  end,
  onChange,
  sizes,
  ownSize,
  isFree,
}: {
  label: string
  end: QuickEndInput
  onChange: (patch: Partial<QuickEndInput>) => void
  sizes: { code: string; label: string }[]
  ownSize?: string
  isFree: boolean
}) {
  return (
    <div className="qc-end">
      <div className="field-label">{label}</div>
      <select
        value={end.kind}
        onChange={(e) => onChange({ kind: e.target.value as QuickFittingKind })}
      >
        {END_KIND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {needsCounterpart(end.kind) && (
        <select
          value={end.counterpartSize ?? ownSize ?? ''}
          onChange={(e) => onChange({ counterpartSize: e.target.value || undefined })}
        >
          <option value="">相手径を選択</option>
          {sizes.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}（相手径）
            </option>
          ))}
        </select>
      )}

      {end.kind === 'flange' && (
        <div className="field">
          <span className="field-note">フランジ引きしろ(mm)</span>
          <input
            className="num-input"
            type="number"
            inputMode="decimal"
            value={end.flangeAllow ?? ''}
            onChange={(e) =>
              onChange({ flangeAllow: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
        </div>
      )}

      {!isFree && (
        <div className="round-toggle qc-basis-toggle">
          <button
            type="button"
            className={end.basis === 'center' ? 'active' : ''}
            onClick={() => onChange({ basis: 'center' })}
          >
            芯々基準
          </button>
          <button
            type="button"
            className={end.basis === 'face' ? 'active' : ''}
            onClick={() => onChange({ basis: 'face' })}
          >
            芯先（端面）基準
          </button>
        </div>
      )}
      {isFree && <p className="field-note">フリー端は自動的に端面基準になります</p>}
    </div>
  )
}

export function QuickCalc({ onClose }: Props) {
  const [pipeType, setPipeType] = useState<string | undefined>(undefined)
  const [size, setSize] = useState<string | undefined>(undefined)
  const [connection, setConnection] = useState<string | undefined>(undefined)
  const [vpSeries, setVpSeries] = useState<'dv' | 'ts' | undefined>(undefined)
  const [roundMode, setRoundMode] = useState<RoundMode>('round')
  const [rawMode, setRawMode] = useState(false) // 「そのまま」＝丸めなし表示
  const [left, setLeft] = useState<QuickEndInput>(defaultEnd())
  const [right, setRight] = useState<QuickEndInput>(defaultEnd())
  const [calc, setCalc] = useState<CalcState>(initialCalcState)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  const sizes = sizesForPipeType(pipeType)
  const od = getSizeInfo(size)?.od

  const overall = calcCurrentTotal(calc)

  const input: QuickCalcInput = useMemo(
    () => ({
      pipeType,
      size,
      connection,
      vpSeries,
      overall,
      roundMode,
      left,
      right,
    }),
    [pipeType, size, connection, vpSeries, overall, roundMode, left, right],
  )

  const result = useMemo(() => computeQuickCut(input), [input])

  const displayCut =
    result.status === 'ok'
      ? rawMode && result.rawCut != null
        ? result.rawCut
        : result.cut
      : undefined

  function updateLeft(patch: Partial<QuickEndInput>) {
    setLeft((prev) => ({ ...prev, ...patch }))
  }
  function updateRight(patch: Partial<QuickEndInput>) {
    setRight((prev) => ({ ...prev, ...patch }))
  }

  function pressDigit(d: string) {
    setCalc((s) => calcPressDigit(s, d))
  }
  function pressOp(op: '+' | '-') {
    setCalc((s) => calcPressOp(s, op))
  }
  function pressEqual() {
    setCalc((s) => {
      const { value, error } = calcEvaluate(s)
      if (error) return { ...s, error }
      if (value == null) return s
      return calcStateFromValue(value)
    })
  }

  function recordHistory() {
    if (result.status !== 'ok' || result.cut == null) return
    const pipeLabel = pipeTypes.find((p) => p.id === pipeType)?.short ?? '—'
    const summary = `${pipeLabel} ${size ?? '—'} / 全体${overall ?? '—'}mm`
    setHistory((h) =>
      [{ id: `${Date.now()}`, summary, cut: result.cut! }, ...h].slice(0, 8),
    )
  }

  return (
    <div className="qc-screen">
      <header className="topbar">
        <div className="title">クイック計算（芯引き）</div>
        <div className="tools">
          <button onClick={onClose}>作図に戻る</button>
        </div>
      </header>

      <div className="qc-body">
        <div
          className={`qc-result${result.status === 'over' || result.error ? ' over' : ''}${result.status === 'zero' ? ' zero' : ''}`}
        >
          {result.error ? (
            <div className="qc-result-error">{result.error}</div>
          ) : result.status === 'zero' ? (
            <div className="qc-result-value zero">パイプ0mm（継手直結）</div>
          ) : displayCut != null ? (
            <>
              <div className="qc-result-label">切り寸法</div>
              <div className="qc-result-value">{displayCut} mm</div>
            </>
          ) : (
            <div className="qc-result-placeholder">サイズと全体寸法を入力してください</div>
          )}
          <div className="qc-result-sub">
            <span>控え s1: {result.startAllow} mm</span>
            <span>控え s2: {result.endAllow} mm</span>
          </div>
        </div>

        <div className="panel-grid qc-config">
          <label className="field">
            <span className="field-label">管種</span>
            <select
              value={pipeType ?? ''}
              onChange={(e) => {
                const v = e.target.value || undefined
                setPipeType(v)
                setSize(undefined)
                if (v !== 'vp') setVpSeries(undefined)
              }}
            >
              <option value="">未設定</option>
              {pipeTypes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">
              サイズ{od != null && <span className="field-note">⌀{od}</span>}
            </span>
            <select value={size ?? ''} onChange={(e) => setSize(e.target.value || undefined)}>
              <option value="">未設定</option>
              {sizes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {pipeType === 'vp' ? (
            <label className="field">
              <span className="field-label">継手タイプ</span>
              <select
                value={vpSeries ?? ''}
                onChange={(e) => setVpSeries((e.target.value || undefined) as 'dv' | 'ts' | undefined)}
              >
                <option value="">未設定（自動でDV継手）</option>
                <option value="dv">DV継手（排水）</option>
                <option value="ts">TS継手（給水）</option>
              </select>
            </label>
          ) : (
            <label className="field">
              <span className="field-label">接続方法</span>
              <select
                value={connection ?? ''}
                onChange={(e) => setConnection(e.target.value || undefined)}
              >
                <option value="">未設定</option>
                {connectionMethods.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="qc-ends">
          <EndFittingEditor
            label="左端"
            end={left}
            onChange={updateLeft}
            sizes={sizes}
            ownSize={size}
            isFree={left.kind === 'free'}
          />
          <EndFittingEditor
            label="右端"
            end={right}
            onChange={updateRight}
            sizes={sizes}
            ownSize={size}
            isFree={right.kind === 'free'}
          />
        </div>

        <div className="field">
          <span className="field-label">切り寸法の丸め</span>
          <div className="round-toggle">
            <button
              className={!rawMode && roundMode === 'round' ? 'active' : ''}
              onClick={() => {
                setRawMode(false)
                setRoundMode('round')
              }}
            >
              四捨五入
            </button>
            <button
              className={!rawMode && roundMode === 'floor' ? 'active' : ''}
              onClick={() => {
                setRawMode(false)
                setRoundMode('floor')
              }}
            >
              切り捨て
            </button>
            <button className={rawMode ? 'active' : ''} onClick={() => setRawMode(true)}>
              そのまま
            </button>
          </div>
        </div>

        <div className="qc-overall">
          <div className="field-label">
            全体寸法(mm)
            {calc.error && <span className="qc-calc-error">{calc.error}</span>}
          </div>
          <div className="qc-overall-display">{calc.display || '0'}</div>
        </div>

        <div className="qc-keypad">
          <KeyButton label="7" onClick={() => pressDigit('7')} gridColumn="1" gridRow="1" />
          <KeyButton label="8" onClick={() => pressDigit('8')} gridColumn="2" gridRow="1" />
          <KeyButton label="9" onClick={() => pressDigit('9')} gridColumn="3" gridRow="1" />
          <KeyButton
            label="＋"
            variant="op"
            onClick={() => pressOp('+')}
            gridColumn="4"
            gridRow="1"
          />

          <KeyButton label="4" onClick={() => pressDigit('4')} gridColumn="1" gridRow="2" />
          <KeyButton label="5" onClick={() => pressDigit('5')} gridColumn="2" gridRow="2" />
          <KeyButton label="6" onClick={() => pressDigit('6')} gridColumn="3" gridRow="2" />
          <KeyButton
            label="－"
            variant="op"
            onClick={() => pressOp('-')}
            gridColumn="4"
            gridRow="2"
          />

          <KeyButton label="1" onClick={() => pressDigit('1')} gridColumn="1" gridRow="3" />
          <KeyButton label="2" onClick={() => pressDigit('2')} gridColumn="2" gridRow="3" />
          <KeyButton label="3" onClick={() => pressDigit('3')} gridColumn="3" gridRow="3" />
          <KeyButton
            label="±"
            variant="op"
            onClick={() => setCalc((s) => calcPressSign(s))}
            gridColumn="4"
            gridRow="3"
          />

          <KeyButton label="0" onClick={() => pressDigit('0')} gridColumn="1" gridRow="4" />
          <KeyButton
            label="00"
            onClick={() => setCalc((s) => calcPressDoubleZero(s))}
            gridColumn="2"
            gridRow="4"
          />
          <KeyButton
            label="."
            onClick={() => setCalc((s) => calcPressDot(s))}
            gridColumn="3"
            gridRow="4"
          />
          <KeyButton
            label="＝"
            variant="equal"
            onClick={() => {
              pressEqual()
              recordHistory()
            }}
            gridColumn="4"
            gridRow="4 / span 2"
          />

          <KeyButton
            label="C"
            variant="clear"
            onClick={() => setCalc(calcPressClear())}
            gridColumn="1"
            gridRow="5"
          />
          <KeyButton
            label="BS"
            variant="clear"
            onClick={() => setCalc((s) => calcPressBackspace(s))}
            gridColumn="2 / span 2"
            gridRow="5"
          />
        </div>

        {history.length > 0 && (
          <div className="qc-history">
            <div className="field-label">履歴（この画面を開いている間のみ）</div>
            {history.map((h) => (
              <div key={h.id} className="qc-history-row">
                <span>{h.summary}</span>
                <b>{h.cut} mm</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
