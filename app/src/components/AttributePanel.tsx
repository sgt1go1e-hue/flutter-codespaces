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
            <span className="field-label">切断長さ</span>
            <div className="cut-value">{cut?.cut != null ? `${cut.cut} mm` : '—'}</div>
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
