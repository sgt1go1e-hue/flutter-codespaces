import { useMemo, useState } from 'react'
import {
  NITROGEN_PIPE_TYPES,
  nitrogenInnerDiameter,
  nitrogenSizesForPipeType,
} from '../data/nitrogenPipes'
import {
  cylinderUsableLiters,
  pipeVolumeLiters,
  requiredCylinderCount,
  requiredNitrogenLiters,
  simulateCascadeFill,
  type CascadeResult,
} from '../lib/nitrogenCalc'

interface Props {
  onClose: () => void
}

type InputMode = 'diameterLength' | 'volumeDirect'

const CUSTOM_SIZE = '__custom__'

interface PipeRow {
  id: string
  pipeTypeId?: string
  sizeCode?: string
  customDiameterMm?: number
  lengthM?: number
}

let rowSeq = 0
function makeRow(): PipeRow {
  rowSeq += 1
  return { id: `row_${rowSeq}` }
}

function rowInnerDiameter(row: PipeRow): number | undefined {
  if (row.sizeCode === CUSTOM_SIZE) return row.customDiameterMm
  return nitrogenInnerDiameter(row.pipeTypeId, row.sizeCode)
}

function rowVolumeL(row: PipeRow): number | undefined {
  const d = rowInnerDiameter(row)
  if (d == null || d <= 0 || row.lengthM == null || row.lengthM <= 0) return undefined
  return pipeVolumeLiters(d, row.lengthM)
}

const round2 = (x: number) => Math.round(x * 100) / 100
const round0 = (x: number) => Math.round(x)

const CYLINDER_CAPACITY_OPTIONS = [47, 10, 3.4]

function PipeRowEditor({
  row,
  index,
  onChange,
  onRemove,
  removable,
}: {
  row: PipeRow
  index: number
  onChange: (patch: Partial<PipeRow>) => void
  onRemove: () => void
  removable: boolean
}) {
  const sizes = nitrogenSizesForPipeType(row.pipeTypeId)
  const volume = rowVolumeL(row)
  return (
    <div className="n2-row">
      <div className="n2-row-head">
        <span className="field-label">{index + 1}行目</span>
        {removable && (
          <button type="button" className="n2-row-remove" onClick={onRemove}>
            削除
          </button>
        )}
      </div>
      <div className="panel-grid">
        <label className="field">
          <span className="field-label">配管種別</span>
          <select
            value={row.pipeTypeId ?? ''}
            onChange={(e) => {
              const v = e.target.value || undefined
              onChange({ pipeTypeId: v, sizeCode: undefined, customDiameterMm: undefined })
            }}
          >
            <option value="">未設定</option>
            {NITROGEN_PIPE_TYPES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">呼び径</span>
          <select
            value={row.sizeCode ?? ''}
            onChange={(e) => onChange({ sizeCode: e.target.value || undefined })}
            disabled={!row.pipeTypeId}
          >
            <option value="">未設定</option>
            {sizes.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
            <option value={CUSTOM_SIZE}>その他（内径を直接入力）</option>
          </select>
        </label>
      </div>

      {row.sizeCode === CUSTOM_SIZE && (
        <label className="field">
          <span className="field-label">内径（mm）</span>
          <input
            className="num-input"
            type="number"
            inputMode="decimal"
            value={row.customDiameterMm ?? ''}
            onChange={(e) =>
              onChange({
                customDiameterMm: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
      )}

      <label className="field">
        <span className="field-label">長さ（m）</span>
        <input
          className="num-input"
          type="number"
          inputMode="decimal"
          value={row.lengthM ?? ''}
          onChange={(e) =>
            onChange({ lengthM: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        />
      </label>

      <div className="n2-row-volume">
        内容積: <b>{volume != null ? round2(volume) : '—'} L</b>
      </div>
    </div>
  )
}

interface UsedCylinderRow {
  id: string
  pressureMPa?: number
}

let usedRowSeq = 0
function makeUsedRow(): UsedCylinderRow {
  usedRowSeq += 1
  return { id: `used_${usedRowSeq}` }
}

const DEFAULT_CYLINDER_PHYSICAL_VOLUME_L = 46.7

export function NitrogenCalc({ onClose }: Props) {
  const [mode, setMode] = useState<InputMode>('diameterLength')
  const [rows, setRows] = useState<PipeRow[]>([makeRow()])
  const [directVolumeL, setDirectVolumeL] = useState<number | undefined>(undefined)
  const [testPressureMPa, setTestPressureMPa] = useState<number | undefined>(undefined)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [capacityL, setCapacityL] = useState(47)
  const [fillPressureMPa, setFillPressureMPa] = useState(14.7)
  const [residualPressureMPa, setResidualPressureMPa] = useState(0.5)

  // --- 段階昇圧シミュレーター(カスケード充填計算) ---
  const [showCascade, setShowCascade] = useState(false)
  const [usedCylinders, setUsedCylinders] = useState<UsedCylinderRow[]>([])
  const [cylinderPhysicalVolumeL, setCylinderPhysicalVolumeL] = useState(
    DEFAULT_CYLINDER_PHYSICAL_VOLUME_L,
  )
  const [initialPipePressureMPa, setInitialPipePressureMPa] = useState(0)
  const [cascadeResult, setCascadeResult] = useState<CascadeResult | null>(null)

  function updateUsedCylinder(id: string, pressureMPa: number | undefined) {
    setUsedCylinders((prev) => prev.map((r) => (r.id === id ? { ...r, pressureMPa } : r)))
  }
  function addUsedCylinder() {
    setUsedCylinders((prev) => [...prev, makeUsedRow()])
  }
  function removeUsedCylinder(id: string) {
    setUsedCylinders((prev) => prev.filter((r) => r.id !== id))
  }
  function runCascadeSimulation() {
    if (volumeL == null || volumeL <= 0 || testPressureMPa == null) return
    const usedPressures = usedCylinders
      .map((r) => r.pressureMPa)
      .filter((p): p is number => p != null && p >= 0)
    setCascadeResult(
      simulateCascadeFill({
        pipeVolumeL: volumeL,
        initialPipePressureMPa,
        targetPressureMPa: testPressureMPa,
        usedCylinderPressuresMPa: usedPressures,
        cylinderPhysicalVolumeL,
        freshFillPressureMPa: fillPressureMPa,
      }),
    )
  }

  function updateRow(id: string, patch: Partial<PipeRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function addRow() {
    setRows((prev) => [...prev, makeRow()])
  }
  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev))
  }

  const rowVolumes = useMemo(() => rows.map((r) => rowVolumeL(r)), [rows])
  const totalRowVolume = useMemo(
    () => rowVolumes.reduce<number | undefined>((sum, v) => (v == null ? sum : (sum ?? 0) + v), undefined),
    [rowVolumes],
  )

  const volumeL = mode === 'diameterLength' ? totalRowVolume : directVolumeL

  const usablePerCylinder = useMemo(
    () => cylinderUsableLiters(capacityL, fillPressureMPa, residualPressureMPa),
    [capacityL, fillPressureMPa, residualPressureMPa],
  )

  const requiredL =
    volumeL != null && volumeL > 0 && testPressureMPa != null && testPressureMPa >= 0
      ? requiredNitrogenLiters(volumeL, testPressureMPa)
      : undefined

  const count = requiredL != null ? requiredCylinderCount(requiredL, usablePerCylinder) : undefined

  return (
    <div className="qc-screen">
      <header className="topbar">
        <div className="title">窒素計算（気密試験）</div>
        <div className="tools">
          <button onClick={onClose}>作図に戻る</button>
        </div>
      </header>

      <div className="qc-body">
        <div className="round-toggle">
          <button
            className={mode === 'diameterLength' ? 'active' : ''}
            onClick={() => setMode('diameterLength')}
          >
            口径×長さ入力
          </button>
          <button
            className={mode === 'volumeDirect' ? 'active' : ''}
            onClick={() => setMode('volumeDirect')}
          >
            内容積を直接入力
          </button>
        </div>

        {mode === 'diameterLength' ? (
          <div className="n2-rows">
            {rows.map((row, i) => (
              <PipeRowEditor
                key={row.id}
                row={row}
                index={i}
                onChange={(patch) => updateRow(row.id, patch)}
                onRemove={() => removeRow(row.id)}
                removable={rows.length > 1}
              />
            ))}
            <button type="button" className="n2-add-row" onClick={addRow}>
              ＋ 行を追加
            </button>
            <div className="n2-total-row">
              <span>合計内容積</span>
              <b>{totalRowVolume != null ? round2(totalRowVolume) : '—'} L</b>
            </div>
          </div>
        ) : (
          <label className="field">
            <span className="field-label">配管内容積（L）</span>
            <input
              className="num-input"
              type="number"
              inputMode="decimal"
              value={directVolumeL ?? ''}
              onChange={(e) =>
                setDirectVolumeL(e.target.value === '' ? undefined : Number(e.target.value))
              }
            />
          </label>
        )}

        <label className="field">
          <span className="field-label">試験圧力（MPa、ゲージ圧）</span>
          <input
            className="num-input"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={testPressureMPa ?? ''}
            onChange={(e) =>
              setTestPressureMPa(e.target.value === '' ? undefined : Number(e.target.value))
            }
          />
        </label>

        <div className="n2-panel">
          <button
            type="button"
            className="panel-header"
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            <span className="panel-caret">{advancedOpen ? '▼' : '▲'}</span>
            <span>ボンベ設定（詳細設定・既定値のままでも使えます）</span>
          </button>
          {advancedOpen && (
            <div className="panel-body">
              <label className="field">
                <span className="field-label">ボンベ容量</span>
                <select
                  value={capacityL}
                  onChange={(e) => setCapacityL(Number(e.target.value))}
                >
                  {CYLINDER_CAPACITY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}L
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">充填圧力（MPa）</span>
                <input
                  className="num-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={fillPressureMPa}
                  onChange={(e) => setFillPressureMPa(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">使用停止残圧（MPa）</span>
                <input
                  className="num-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={residualPressureMPa}
                  onChange={(e) => setResidualPressureMPa(Number(e.target.value))}
                />
              </label>
            </div>
          )}
        </div>

        <div className="qc-result">
          {requiredL != null && count != null ? (
            <>
              <div className="qc-result-label">計算上の必要本数</div>
              <div className="qc-result-value">{count} 本</div>
              <p className="n2-recommend">推奨：予備1本を含めて {count + 1}本の準備を</p>
              <div className="qc-result-sub">
                <span>内容積: {round2(volumeL!)} L</span>
                <span>必要窒素量: {round0(requiredL)} L</span>
              </div>
              <div className="n2-formula">Q = V×(10P+1)　※V=内容積(L)、P=試験圧力(MPa)</div>
            </>
          ) : (
            <div className="qc-result-placeholder">
              {mode === 'diameterLength'
                ? '配管種別・呼び径（または内径）・長さと、試験圧力を入力してください'
                : '配管内容積と試験圧力を入力してください'}
            </div>
          )}
        </div>

        <button
          type="button"
          className="n2-add-row"
          onClick={() => setShowCascade((v) => !v)}
        >
          {showCascade ? '段階昇圧シミュレーションを閉じる' : '段階昇圧シミュレーションを見る'}
        </button>

        {showCascade && (
          <div className="n2-panel n2-cascade">
            <div className="panel-body">
              <p className="panel-hint">
                ボンベと配管をつなぐと、両者の圧力が等しくなった時点で流れが止まります。単純な割り算では見えない「等圧で止まって使い切れないボンベ」を考慮し、ボンベを1本ずつ投入したときの到達圧力を計算します。試験圧力が高い場合や配管容積が小さい場合ほど、上の簡易計算より必要本数が増えることがあります。
              </p>

              <label className="field">
                <span className="field-label">配管の初期圧力（MPa、すでに入っている分。無ければ0）</span>
                <input
                  className="num-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={initialPipePressureMPa}
                  onChange={(e) => setInitialPipePressureMPa(Number(e.target.value))}
                />
              </label>

              <label className="field">
                <span className="field-label">ボンベ物理容量（L）※常圧換算量とは別の値です</span>
                <input
                  className="num-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={cylinderPhysicalVolumeL}
                  onChange={(e) => setCylinderPhysicalVolumeL(Number(e.target.value))}
                />
              </label>

              <div className="n2-rows">
                <span className="field-label">手持ちの使いかけボンベの残圧（任意・空でもOK）</span>
                {usedCylinders.map((row, i) => (
                  <div className="n2-row" key={row.id}>
                    <div className="n2-row-head">
                      <span className="field-label">使いかけ{i + 1}</span>
                      <button
                        type="button"
                        className="n2-row-remove"
                        onClick={() => removeUsedCylinder(row.id)}
                      >
                        削除
                      </button>
                    </div>
                    <label className="field">
                      <span className="field-label">残圧（MPa）</span>
                      <input
                        className="num-input"
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        value={row.pressureMPa ?? ''}
                        onChange={(e) =>
                          updateUsedCylinder(
                            row.id,
                            e.target.value === '' ? undefined : Number(e.target.value),
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
                <button type="button" className="n2-add-row" onClick={addUsedCylinder}>
                  ＋ 使いかけボンベを追加
                </button>
              </div>

              <button
                type="button"
                className="n2-run-button"
                onClick={runCascadeSimulation}
                disabled={volumeL == null || volumeL <= 0 || testPressureMPa == null}
              >
                シミュレーション実行
              </button>
              {(volumeL == null || volumeL <= 0 || testPressureMPa == null) && (
                <p className="field-note">
                  上の「内容積」と「試験圧力」を入力すると実行できます
                </p>
              )}

              {cascadeResult && (
                <div className="n2-cascade-result">
                  {cascadeResult.impossible ? (
                    <p className="qc-result-error">
                      目標圧力が新品ボンベの充填圧力以上のため、この方法では到達できません。充填圧力または試験圧力を見直してください。
                    </p>
                  ) : (
                    <>
                      <div className="n2-cascade-table-wrap">
                        <table className="n2-cascade-table">
                          <thead>
                            <tr>
                              <th>番号</th>
                              <th>ボンベ</th>
                              <th>投入前圧力</th>
                              <th>到達圧力</th>
                              <th>目標</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cascadeResult.steps.map((s) => (
                              <tr key={s.index} className={s.reachedTarget ? 'reached' : ''}>
                                <td>{s.index}</td>
                                <td>{s.label}</td>
                                <td>{round2(s.beforePressureMPa)} MPa</td>
                                <td>{round2(s.afterPressureMPa)} MPa</td>
                                <td>{s.reachedTarget ? '到達' : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {cascadeResult.reachedTarget ? (
                        <>
                          <p className="n2-recommend">
                            必要本数（新品換算）：使いかけ{cascadeResult.usedCylinderCount}本 + 新品
                            {cascadeResult.freshCylinderCount}本 = 計{cascadeResult.steps.length}本
                          </p>
                          <p className="field-note">
                            投入順序：{cascadeResult.steps.map((s) => s.label).join(' → ')}
                          </p>
                        </>
                      ) : (
                        <p className="qc-result-error">
                          安全上限（{cascadeResult.steps.length}本）まで計算しても目標に到達しませんでした。入力値をご確認ください。
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <p className="panel-hint n2-disclaimer">
                この計算は等温・理想気体近似です。実際は気温変化や配管形状により若干のズレが生じます。CO2冷媒など高圧・超臨界配管では特にこのシミュレーションを参考にしてください。
              </p>
            </div>
          </div>
        )}

        <p className="panel-hint n2-disclaimer">
          本計算は概算です。実際のボンベ残量・気温により変動します。試験圧力は必ず設計圧力・機器仕様に基づいて設定してください。
        </p>
      </div>
    </div>
  )
}
