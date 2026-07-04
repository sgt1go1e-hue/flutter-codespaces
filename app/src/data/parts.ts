// パーツパレットの定義。
// 特殊部材（フランジ、将来はストレーナー・バルブ等）を
// ドラッグ&ドロップで配置するための汎用構造。
// ここに定義を追加すれば、同じ仕組みで別の部材を増やせる。

export type FlangeType = 'double' | 'single'

export interface PartDef {
  id: string
  name: string
  /** パレットのチップに表示する短いアイコン/記号 */
  icon: string
  /**
   * ドロップ時の動作。
   * - flange: フランジを配置する。
   *   'double'（両フランジ）は配置点で前後に分割、
   *   'single'（片フランジ）は分割せず終端としてマークする。
   * （将来: 独立配置部材の 'placeInline' などを追加予定）
   */
  action:
    | { type: 'flange'; flange: FlangeType }
    | { type: 'reducer'; reducer: 'concentric' | 'eccentric' }
}

export const partsPalette: PartDef[] = [
  {
    id: 'flange-double',
    name: '両フランジ',
    icon: 'FLG',
    action: { type: 'flange', flange: 'double' },
  },
  {
    id: 'flange-single',
    name: '片フランジ',
    icon: 'FLG',
    action: { type: 'flange', flange: 'single' },
  },
  {
    id: 'reducer-concentric',
    name: '同心レジューサー',
    icon: 'RED',
    action: { type: 'reducer', reducer: 'concentric' },
  },
  {
    id: 'reducer-eccentric',
    name: '偏心レジューサー',
    icon: 'RED',
    action: { type: 'reducer', reducer: 'eccentric' },
  },
  // 例: 今後こう増やせる（未実装のプレースホルダは追加しない）
  // { id: 'valve', name: 'バルブ', icon: 'VLV', action: { type: 'placeInline', ... } },
]

export function getPart(id: string): PartDef | undefined {
  return partsPalette.find((p) => p.id === id)
}
