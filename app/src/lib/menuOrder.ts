// 画面下段メニューバーの項目定義と並び順。
// 「配管アイソメ図」のアプリタイトルは固定表示のためここには含めない。
export type MenuItemId =
  | 'undo'
  | 'eraser'
  | 'clearAll'
  | 'bom'
  | 'share'
  | 'quickCalc'
  | 'newDrawing'
  | 'openLauncher'
  | 'disclaimer'
  | 'theme'

// 既定の並び順（現場で使用頻度の高い「元に戻す・消しゴム・全消去」を
// 左側＝親指の届きやすい位置にまとめる）。並び替え設定の「初期順序に戻す」
// もこの並びに戻す。
export const DEFAULT_MENU_ORDER: MenuItemId[] = [
  'undo',
  'eraser',
  'clearAll',
  'bom',
  'share',
  'quickCalc',
  'newDrawing',
  'openLauncher',
  'disclaimer',
  'theme',
]

// 並び替え設定画面に表示する項目名（実際のボタンの見た目・機能はApp.tsx側）
export const MENU_ITEM_LABELS: Record<MenuItemId, string> = {
  undo: '元に戻す',
  eraser: '消しゴム',
  clearAll: '全消去',
  bom: '集計・拾い出し',
  share: '共有',
  quickCalc: 'クイック計算',
  newDrawing: '新規作成',
  openLauncher: '過去の図面',
  disclaimer: '免責',
  theme: 'テーマ切替（明るい/暗い画面）',
}

/**
 * 保存されている並び順データを検証・補修する。
 * 未知のidは除外し、将来項目が追加/削除された場合に備え、既定順に
 * 存在するのに保存データに無いidは末尾に補って必ず全項目が揃うようにする。
 */
export function sanitizeMenuOrder(order: unknown): MenuItemId[] {
  const known = new Set<string>(DEFAULT_MENU_ORDER)
  const valid: MenuItemId[] = Array.isArray(order)
    ? order.filter((id): id is MenuItemId => typeof id === 'string' && known.has(id))
    : []
  const seen = new Set(valid)
  const missing = DEFAULT_MENU_ORDER.filter((id) => !seen.has(id))
  return [...valid, ...missing]
}
