// ホーム画面の各ツールを、使う人だけが表示するようにするための設定。
// 「使わない機能が増えてくると邪魔」という声を受けて追加。オフにしても
// 機能自体は消えず、いつでも設定画面からオンに戻せる（表示のON/OFFのみで、
// データや計算ロジックには一切影響しない）。

export type FeatureId = 'quickCalc' | 'nitrogenCalc' | 'supportDrawing'

export const FEATURE_ORDER: FeatureId[] = ['quickCalc', 'nitrogenCalc', 'supportDrawing']

export const FEATURE_LABELS: Record<FeatureId, { title: string; sub: string }> = {
  quickCalc: { title: 'クイック計算', sub: '図面を描かずに、芯引きの寸法だけをすぐ計算する機能' },
  nitrogenCalc: { title: '窒素計算', sub: '気密試験に必要な窒素量を計算する機能' },
  supportDrawing: { title: 'サポート架台図面', sub: '吊り架台(サポート)の図面を作る機能' },
}

export type EnabledFeatures = Record<FeatureId, boolean>

export const DEFAULT_ENABLED_FEATURES: EnabledFeatures = {
  quickCalc: true,
  nitrogenCalc: true,
  supportDrawing: true,
}

/** 保存されている設定を検証・補修する（未知のキーは無視し、無いキーは既定値を補う）。 */
export function sanitizeEnabledFeatures(value: unknown): EnabledFeatures {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const out = { ...DEFAULT_ENABLED_FEATURES }
  for (const id of FEATURE_ORDER) {
    if (typeof raw[id] === 'boolean') out[id] = raw[id] as boolean
  }
  return out
}
