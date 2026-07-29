// 現合(現物合わせ)区間の注記表示ロジック。DrawingCanvas.tsx(画面)と
// PrintIsometric.tsx(PDF/印刷)の両方から同じ整形ルールを使う。
// あくまで表示専用で、切り寸法・BOM等の計算結果には一切関与しない。

/** 修飾語のプリセット(自由入力も別途許可する。これはあくまで選択肢の目安)。 */
export const GEN_GOU_QUALIFIER_PRESETS = ['現合', '約', '実測', '現場合わせ']

/**
 * 現合区間の寸法表示テキストを組み立てる。修飾語・概算寸法のどちらも
 * 未入力でも、現合であること自体は必ず分かるよう「現合」を既定表示にする。
 */
export function genGouLabelText(qualifier: string | undefined, dimension: number | undefined): string {
  const q = (qualifier ?? '').trim()
  const hasDim = dimension != null
  if (q && hasDim) return `${q} ${dimension}`
  if (q) return q
  if (hasDim) return `${dimension}`
  return '現合'
}
