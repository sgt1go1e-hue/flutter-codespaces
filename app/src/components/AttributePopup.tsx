import type { Segment } from '../types'
import { distance } from '../lib/isometric'
import {
  fittings,
  pipeTypes,
  sizesForPipeType,
  getSizeInfo,
} from '../data/masters'

interface Props {
  segment: Segment
  onChange: (patch: Partial<Segment>) => void
  onClose: () => void
}

/**
 * 「寸法・属性を入力」で開くポップアップ（ボトムシート）。
 * 管種 / サイズ(呼び径) / 継手(始点側・終点側) をマスタから選択する。
 */
export function AttributePopup({ segment, onChange, onClose }: Props) {
  const length = Math.round(distance(segment.start, segment.end))
  const sizes = sizesForPipeType(segment.pipeType)
  const od = getSizeInfo(segment.size)?.od

  // 管種を変えたとき、そのサイズが新しい管種に無ければサイズをリセット
  function onPipeTypeChange(pipeType: string) {
    const available = sizesForPipeType(pipeType).map((s) => s.code)
    const patch: Partial<Segment> = { pipeType }
    if (segment.size && !available.includes(segment.size)) {
      patch.size = undefined
    }
    onChange(patch)
  }

  return (
    <>
      <div className="sheet-overlay" onPointerDown={onClose} />
      <div className="attr-sheet" onPointerDown={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <span>セグメント属性</span>
          <button className="sheet-close" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="sheet-body">
          <div className="attr-row">
            <span className="attr-label">角度 / 長さ</span>
            <span className="attr-value">
              {segment.angle}° / {length} px
            </span>
          </div>

          <label className="field">
            <span className="field-label">管種</span>
            <select
              value={segment.pipeType ?? ''}
              onChange={(e) => onPipeTypeChange(e.target.value)}
            >
              <option value="">— 未選択 —</option>
              {pipeTypes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">
              サイズ（呼び径）
              {od != null && <span className="field-note">外径 {od} mm</span>}
            </span>
            <select
              value={segment.size ?? ''}
              onChange={(e) => onChange({ size: e.target.value || undefined })}
            >
              <option value="">— 未選択 —</option>
              {sizes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">継手（始点側）</span>
            <select
              value={segment.startFitting ?? ''}
              onChange={(e) =>
                onChange({ startFitting: e.target.value || undefined })
              }
            >
              <option value="">— 未選択 —</option>
              {fittings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">継手（終点側）</span>
            <select
              value={segment.endFitting ?? ''}
              onChange={(e) =>
                onChange({ endFitting: e.target.value || undefined })
              }
            >
              <option value="">— 未選択 —</option>
              {fittings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <p className="sheet-note">
            切断寸法の自動計算はフェーズ3、継手の集計・CSV出力はフェーズ4で対応します。
          </p>
        </div>
      </div>
    </>
  )
}
