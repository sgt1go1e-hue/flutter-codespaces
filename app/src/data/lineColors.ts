// 配管ライン色分け(系統)機能で使う固定カラーパレット。
// 色そのものに「給水=青」のような意味は持たせず、ユーザーが現場ごとに
// 自由な系統名(ラベル)を割り当てる。ラベルの対応表は別途
// フォルダ単位/図面単位で持つ(drawingStore.ts・App.tsx側)。
// 既存の状態色(選択=amber、確定=sky blue、未確定=gray、現場溶接マーク=red系)
// と紛らわしくならないよう、それらとは別系統の色相を選んでいる。
export interface LineColorDef {
  id: string
  hex: string
}

export const LINE_COLOR_PALETTE: LineColorDef[] = [
  { id: 'c1', hex: '#e11d48' }, // 赤(rose)
  { id: 'c2', hex: '#16a34a' }, // 緑
  { id: 'c3', hex: '#7c3aed' }, // 紫
  { id: 'c4', hex: '#db2777' }, // ピンク
  { id: 'c5', hex: '#0d9488' }, // 青緑(teal)
  { id: 'c6', hex: '#92400e' }, // 茶
]

export function lineColorHex(colorId?: string): string | undefined {
  return LINE_COLOR_PALETTE.find((c) => c.id === colorId)?.hex
}
