// パーツパレットの定義。
// 特殊部材（フランジ、将来はストレーナー・バルブ等）を
// ドラッグ&ドロップで配置するための汎用構造。
// ここに定義を追加すれば、同じ仕組みで別の部材を増やせる。

export interface PartDef {
  id: string
  name: string
  /** パレットのチップに表示する短いアイコン/記号 */
  icon: string
  /**
   * ドロップ時の動作。
   * - setConnection: 対象セグメントの「接続方法」を value に設定する
   * （将来: 独立した配置部材を追加する 'placeInline' などを追加予定）
   */
  action: { type: 'setConnection'; value: string }
}

export const partsPalette: PartDef[] = [
  {
    id: 'flange',
    name: 'フランジ',
    icon: 'FLG',
    action: { type: 'setConnection', value: 'flange' },
  },
  // 例: 今後こう増やせる（未実装のプレースホルダは追加しない）
  // { id: 'valve', name: 'バルブ', icon: 'VLV', action: { type: 'placeInline', ... } },
  // { id: 'strainer', name: 'ストレーナー', icon: 'STR', action: { ... } },
]

export function getPart(id: string): PartDef | undefined {
  return partsPalette.find((p) => p.id === id)
}
