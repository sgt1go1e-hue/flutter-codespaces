import { useEffect, useRef } from 'react'
import type { Segment } from '../types'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'
import {
  fittings,
  pipeTypes,
  sizesForPipeType,
  getSizeInfo,
  getPipeType,
  getFitting,
  connectionMethods,
} from '../data/masters'

export interface DrawDefaults {
  pipeType?: string
  size?: string
  connection?: string
}

function roleLabel(role: string): string {
  switch (role) {
    case 'free':
      return 'フリー端'
    case 'straight':
      return '直管'
    case 'elbow':
      return 'エルボ'
    case 'reducer':
      return 'レジューサー'
    case 'tee-run':
      return 'チーズ・ラン'
    case 'tee-branch':
      return 'チーズ・枝'
    default:
      return role
  }
}

// ============================================================
// 寸法・属性パネル（線を選択したときに表示）
// ============================================================
interface SegmentPanelProps {
  segment: Segment
  effective?: Effective
  inheritedPipeType?: string
  inheritedSize?: string
  cut?: CutResult
  onChange: (patch: Partial<Segment>) => void
  onDelete: () => void
}

export function SegmentPanel({
  segment,
  effective,
  inheritedPipeType,
  inheritedSize,
  cut,
  onChange,
  onDelete,
}: SegmentPanelProps) {
  const dimRef = useRef<HTMLInputElement>(null)

  // 別の線を選ぶたびに芯々寸法欄へフォーカス（連続入力を最短タップに）
  useEffect(() => {
    dimRef.current?.focus()
    dimRef.current?.select()
  }, [segment.id])

  const effPipe = segment.pipeType ?? inheritedPipeType
  const sizes = sizesForPipeType(effPipe)
  const od = getSizeInfo(segment.size ?? inheritedSize)?.od
  const effFittingId = effective?.fitting
  const isReducer =
    effFittingId === 'reducer_concentric' || effFittingId === 'reducer_eccentric'
  const needsCounterpart =
    isReducer || effFittingId === 'tee_reducing'

  const pipeShort = effPipe ? (getPipeType(effPipe)?.short ?? effPipe) : '—'
  const sizeText = segment.size ?? inheritedSize ?? '—'
  const fittingName = effective
    ? (getFitting(effective.fitting)?.name ?? effective.fitting)
    : '—'

  const pipeEmpty = inheritedPipeType
    ? `継承（${getPipeType(inheritedPipeType)?.short ?? inheritedPipeType}）`
    : '未設定'
  const sizeEmpty = inheritedSize ? `継承（${inheritedSize}）` : '未設定'
  const fittingEmpty = effective
    ? `自動（${getFitting(effective.fitting)?.name ?? effective.fitting}）`
    : '自動'

  function onPipeTypeChange(pipeType: string) {
    const available = sizesForPipeType(pipeType || inheritedPipeType).map((s) => s.code)
    const patch: Partial<Segment> = { pipeType: pipeType || undefined }
    if (segment.size && !available.includes(segment.size)) patch.size = undefined
    onChange(patch)
  }

  return (
    <section className="attr-panel open">
      <div className="panel-header static">
        <span className="panel-summary">
          <b>{pipeShort}</b>
          <b>{sizeText}</b>
          <span className="sum-fit">{fittingName}</span>
        </span>
        <span className="panel-delete" role="button" onClick={onDelete}>
          削除
        </span>
      </div>
      <div className="panel-body">
        <div className="panel-grid">
          <label className="field dim-field">
            <span className="field-label">芯々寸法(mm)</span>
            <input
              ref={dimRef}
              className="num-input"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="例: 1200"
              value={segment.centerLength ?? ''}
              onChange={(e) =>
                onChange({
                  centerLength: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </label>

          <div className="field cut-field">
            <span className="field-label">
              切り寸法{cut && cut.status !== 'none' && (
                <span className="field-note">{cut.mode}</span>
              )}
            </span>
            <div
              className={`cut-value${cut?.status === 'over' ? ' over' : ''}${cut?.status === 'zero' ? ' zero' : ''}`}
            >
              {cut?.needsCounterpart
                ? '要相手径'
                : cut?.status === 'ok'
                  ? `${cut.cut} mm`
                  : cut?.status === 'zero'
                    ? 'パイプ0mm（継手直結）'
                    : cut?.status === 'over'
                      ? '継手が収まりません'
                      : '—'}
            </div>
          </div>

          <label className="field">
            <span className="field-label">管種</span>
            <select value={segment.pipeType ?? ''} onChange={(e) => onPipeTypeChange(e.target.value)}>
              <option value="">{pipeEmpty}</option>
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
            <select
              value={segment.size ?? ''}
              onChange={(e) => onChange({ size: e.target.value || undefined })}
            >
              <option value="">{sizeEmpty}</option>
              {sizes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">継手</span>
            <select
              value={segment.fitting ?? ''}
              onChange={(e) => onChange({ fitting: e.target.value || undefined })}
            >
              <option value="">{fittingEmpty}</option>
              {fittings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">接続方法</span>
            <select
              value={segment.connection ?? ''}
              onChange={(e) => onChange({ connection: e.target.value || undefined })}
            >
              <option value="">未設定</option>
              {connectionMethods.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* レジューサー / 径違いチーズ: 相手径・合わせ面 */}
        {needsCounterpart && (
          <div className="panel-grid reducer-grid">
            <label className="field">
              <span className="field-label">
                相手径
                <span className="field-note">隣接から自動判定</span>
              </span>
              <select
                value={segment.reducerSize ?? ''}
                onChange={(e) => onChange({ reducerSize: e.target.value || undefined })}
              >
                <option value="">
                  {cut?.autoCounterpart ? `自動（${cut.autoCounterpart}）` : '— 選択 —'}
                </option>
                {sizes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {effFittingId === 'reducer_eccentric' && (
              <label className="field">
                <span className="field-label">合わせ面（必須）</span>
                <select
                  value={segment.reducerAlign ?? ''}
                  onChange={(e) =>
                    onChange({
                      reducerAlign: (e.target.value || undefined) as
                        | 'top'
                        | 'bottom'
                        | undefined,
                    })
                  }
                >
                  <option value="">— 選択 —</option>
                  <option value="top">上面合わせ（TOP）</option>
                  <option value="bottom">下面合わせ（BOTTOM）</option>
                </select>
              </label>
            )}
          </div>
        )}

        {/* 端ごとの差引/フリー端の内訳 */}
        {cut && !cut.needsCounterpart && (
          <div className="end-breakdown">
            <div className="end-row">
              <span>始点側（{roleLabel(cut.startRole)}）</span>
              <span>
                {cut.startAllow > 0
                  ? `− ${cut.startAllow} mm`
                  : cut.startConnected
                    ? '差引なし'
                    : '芯出し基準'}
              </span>
            </div>
            <div className="end-row">
              <span>終点側（{roleLabel(cut.endRole)}）</span>
              <span>
                {cut.endAllow > 0
                  ? `− ${cut.endAllow} mm`
                  : cut.endConnected
                    ? '差引なし'
                    : '芯出し基準'}
              </span>
            </div>
          </div>
        )}

        {cut?.status === 'over' && (
          <p className="cut-warn danger">
            継手が収まりません（芯々寸法が不足）。芯々寸法を大きくするか継手を見直してください。
          </p>
        )}
        {cut?.status === 'zero' && (
          <p className="cut-hint">
            パイプ長さ0mm（継手同士が直結）。BOM のパイプ材にはカウントされません。
          </p>
        )}

        {cut?.needsCounterpart && (
          <p className="cut-warn">相手径を選択すると加工寸法を計算します。</p>
        )}

        {/* 偏心レジューサーの芯ズレ表示 */}
        {cut?.eccentric && !cut.needsCounterpart && (
          <div className="ecc-box">
            {cut.eccentric.alignNeeded ? (
              <p className="cut-warn">合わせ面（上面／下面）を選択してください。</p>
            ) : cut.eccentric.offset != null ? (
              <>
                <div className="ecc-line">
                  芯ズレ: <b>{cut.eccentric.offset} mm</b>（
                  {cut.eccentric.align === 'top' ? '上面合わせ' : '下面合わせ'}）
                </div>
                <p className="ecc-note">
                  レジューサー基準面から {cut.eccentric.offset}mm{' '}
                  {cut.eccentric.align === 'top' ? '下' : '上'}に芯がズレています（
                  {cut.eccentric.large}→{cut.eccentric.small}）。下流の立上り／立下り
                  高さ確認の参考にしてください（図の見た目は変わりません）。
                </p>
              </>
            ) : null}
          </div>
        )}

        <details className="panel-more">
          <summary>フランジ（始点 / 終点）</summary>
          <div className="panel-grid">
            <label className="field">
              <span className="field-label">始点側</span>
              <select
                value={segment.startFlange ?? ''}
                onChange={(e) =>
                  onChange({
                    startFlange: (e.target.value || undefined) as 'double' | 'single' | undefined,
                  })
                }
              >
                <option value="">なし</option>
                <option value="double">両フランジ</option>
                <option value="single">片フランジ</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">終点側</span>
              <select
                value={segment.endFlange ?? ''}
                onChange={(e) =>
                  onChange({
                    endFlange: (e.target.value || undefined) as 'double' | 'single' | undefined,
                  })
                }
              >
                <option value="">なし</option>
                <option value="double">両フランジ</option>
                <option value="single">片フランジ</option>
              </select>
            </label>
          </div>
        </details>
      </div>
    </section>
  )
}

// ============================================================
// 作図設定バー（独立して開閉。これから描く線の初期値）
// ============================================================
interface DrawSettingsPanelProps {
  defaults: DrawDefaults
  onChange: (patch: Partial<DrawDefaults>) => void
  open: boolean
  onToggle: () => void
}

export function DrawSettingsPanel({ defaults, onChange, open, onToggle }: DrawSettingsPanelProps) {
  const sizes = sizesForPipeType(defaults.pipeType)
  const od = getSizeInfo(defaults.size)?.od
  const pipeShort = defaults.pipeType
    ? (getPipeType(defaults.pipeType)?.short ?? defaults.pipeType)
    : '未設定'

  return (
    <section className={`attr-panel settings${open ? ' open' : ''}`}>
      <button className="panel-header" onClick={onToggle}>
        <span className="panel-caret">{open ? '▼' : '▲'}</span>
        <span className="panel-summary">
          <span className="sum-mode">作図設定</span>
          <b>{pipeShort}</b>
          <b>{defaults.size ?? '未設定'}</b>
        </span>
      </button>
      {open && (
        <div className="panel-body">
          <p className="panel-hint">これから描く線に適用する初期値です（線の選択は不要）。</p>
          <div className="panel-grid">
            <label className="field">
              <span className="field-label">管種</span>
              <select
                value={defaults.pipeType ?? ''}
                onChange={(e) => onChange({ pipeType: e.target.value || undefined })}
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
              <select
                value={defaults.size ?? ''}
                onChange={(e) => onChange({ size: e.target.value || undefined })}
              >
                <option value="">未設定</option>
                {sizes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">接続方法</span>
              <select
                value={defaults.connection ?? ''}
                onChange={(e) => onChange({ connection: e.target.value || undefined })}
              >
                <option value="">未設定</option>
                {connectionMethods.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </section>
  )
}
