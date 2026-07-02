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

interface Props {
  segment: Segment | null
  effective?: Effective
  inheritedPipeType?: string
  inheritedSize?: string
  cut?: CutResult
  /** 線を選択していないときに編集する「作図設定」 */
  defaults: DrawDefaults
  onDefaultsChange: (patch: Partial<DrawDefaults>) => void
  open: boolean
  onToggle: () => void
  onChange: (patch: Partial<Segment>) => void
  onDelete: () => void
}

/**
 * 描画エリア下部に常設する属性パネル。
 * - 線を選択していないとき: 「作図設定」＝これから描く線に適用する 管種/サイズ/接続方法 を編集。
 * - 線を選択しているとき: そのセグメントの属性を編集。
 * どちらもポップアップ無しでその場編集でき、現在値をヘッダに常時表示する。
 */
export function AttributePanel({
  segment,
  effective,
  inheritedPipeType,
  inheritedSize,
  cut,
  defaults,
  onDefaultsChange,
  open,
  onToggle,
  onChange,
  onDelete,
}: Props) {
  const has = segment != null

  // ---- ヘッダーのサマリ ----
  const headerSummary = has
    ? renderSegSummary()
    : renderDefaultsSummary()

  function renderSegSummary() {
    const effPipe = segment!.pipeType ?? inheritedPipeType
    const pipeShort = effPipe ? (getPipeType(effPipe)?.short ?? effPipe) : '—'
    const sizeText = segment!.size ?? inheritedSize ?? '—'
    const fittingName = effective
      ? (getFitting(effective.fitting)?.name ?? effective.fitting)
      : '—'
    return (
      <>
        <b>{pipeShort}</b>
        <b>{sizeText}</b>
        <span className="sum-fit">{fittingName}</span>
      </>
    )
  }

  function renderDefaultsSummary() {
    const pipeShort = defaults.pipeType
      ? (getPipeType(defaults.pipeType)?.short ?? defaults.pipeType)
      : '未設定'
    const sizeText = defaults.size ?? '未設定'
    return (
      <>
        <span className="sum-mode">作図設定</span>
        <b>{pipeShort}</b>
        <b>{sizeText}</b>
      </>
    )
  }

  return (
    <section className={`attr-panel${open ? ' open' : ''}`}>
      <button className="panel-header" onClick={onToggle}>
        <span className="panel-caret">{open ? '▼' : '▲'}</span>
        <span className="panel-summary">{headerSummary}</span>
        {has && (
          <span
            className="panel-delete"
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            削除
          </span>
        )}
      </button>

      {open && (
        <div className="panel-body">
          {has && segment ? (
            <SegmentEditor
              segment={segment}
              effective={effective}
              inheritedPipeType={inheritedPipeType}
              inheritedSize={inheritedSize}
              cut={cut}
              onChange={onChange}
            />
          ) : (
            <DefaultsEditor defaults={defaults} onChange={onDefaultsChange} />
          )}
        </div>
      )}
    </section>
  )
}

/** 線を選択していないときの「作図設定」エディタ（これから描く線に適用） */
function DefaultsEditor({
  defaults,
  onChange,
}: {
  defaults: DrawDefaults
  onChange: (patch: Partial<DrawDefaults>) => void
}) {
  const sizes = sizesForPipeType(defaults.pipeType)
  const od = getSizeInfo(defaults.size)?.od
  return (
    <>
      <p className="panel-hint">
        これから描く線に適用する初期値です（線の選択は不要）。
      </p>
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
      <p className="panel-hint">
        線を長押しすると、その線を個別に編集できます。
      </p>
    </>
  )
}

/** 選択中セグメントの属性エディタ */
function SegmentEditor({
  segment,
  effective,
  inheritedPipeType,
  inheritedSize,
  cut,
  onChange,
}: {
  segment: Segment
  effective?: Effective
  inheritedPipeType?: string
  inheritedSize?: string
  cut?: CutResult
  onChange: (patch: Partial<Segment>) => void
}) {
  const effPipe = segment.pipeType ?? inheritedPipeType
  const sizes = sizesForPipeType(effPipe)
  const od = getSizeInfo(segment.size ?? inheritedSize)?.od

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
    <>
      <div className="panel-grid">
        <label className="field">
          <span className="field-label">管種</span>
          <select
            value={segment.pipeType ?? ''}
            onChange={(e) => onPipeTypeChange(e.target.value)}
          >
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

        <label className="field">
          <span className="field-label">芯々寸法(mm)</span>
          <input
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
                  startFlange: (e.target.value || undefined) as
                    | 'double'
                    | 'single'
                    | undefined,
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
                  endFlange: (e.target.value || undefined) as
                    | 'double'
                    | 'single'
                    | undefined,
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
    </>
  )
}
