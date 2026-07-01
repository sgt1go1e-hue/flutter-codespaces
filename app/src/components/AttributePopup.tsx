import type { Segment } from '../types'
import { distance } from '../lib/isometric'

interface Props {
  segment: Segment
  onClose: () => void
}

/**
 * 「寸法・属性を入力」で開くポップアップ（ボトムシート）。
 *
 * フェーズ2で 管種 / サイズ / 継手 の選択 UI を実装予定。
 * ここではロングタップ→メニュー→属性入力への導線を確認できるよう、
 * セグメント情報とプレースホルダを表示する。
 */
export function AttributePopup({ segment, onClose }: Props) {
  const length = Math.round(distance(segment.start, segment.end))
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
            <span className="attr-label">角度</span>
            <span className="attr-value">{segment.angle}°</span>
          </div>
          <div className="attr-row">
            <span className="attr-label">図面上の長さ</span>
            <span className="attr-value">{length} px</span>
          </div>
          <hr />
          <div className="attr-row placeholder">
            <span className="attr-label">管種</span>
            <span className="attr-value">— フェーズ2で選択 —</span>
          </div>
          <div className="attr-row placeholder">
            <span className="attr-label">サイズ（呼び径）</span>
            <span className="attr-value">— フェーズ2で選択 —</span>
          </div>
          <div className="attr-row placeholder">
            <span className="attr-label">継手</span>
            <span className="attr-value">— フェーズ2で選択 —</span>
          </div>
        </div>
      </div>
    </>
  )
}
