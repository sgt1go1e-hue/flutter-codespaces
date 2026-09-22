// 気密試験(窒素加圧)用ボンベ本数計算タブで使う、配管の内径テーブル。
// 切り寸法計算(pipes.json/masters.ts)とは完全に独立したデータで、
// ここでの値は既存の芯々/切り寸法計算に一切影響しない。

export interface NitrogenPipeSize {
  code: string
  label: string
  innerDiameterMm: number
}

export interface NitrogenPipeTypeDef {
  id: string
  name: string
  sizes: NitrogenPipeSize[]
}

// 銅管(冷媒・ガス管等で使う「分」呼称)。呼び外径はJIS規格の慣用値、
// 肉厚は現場で一般的な標準値を用いて内径を算出する。
const COPPER_WALL_MM: Record<string, number> = {
  cu_3bu: 0.8,
  cu_4bu: 0.8,
  cu_5bu: 1.0,
  cu_6bu: 1.0,
}
const COPPER_OD_MM: Record<string, number> = {
  cu_3bu: 9.52,
  cu_4bu: 12.7,
  cu_5bu: 15.88,
  cu_6bu: 19.05,
}
const COPPER_SIZES: NitrogenPipeSize[] = [
  { code: 'cu_3bu', label: '3分(9.52)', innerDiameterMm: COPPER_OD_MM.cu_3bu - 2 * COPPER_WALL_MM.cu_3bu },
  { code: 'cu_4bu', label: '4分(12.70)', innerDiameterMm: COPPER_OD_MM.cu_4bu - 2 * COPPER_WALL_MM.cu_4bu },
  { code: 'cu_5bu', label: '5分(15.88)', innerDiameterMm: COPPER_OD_MM.cu_5bu - 2 * COPPER_WALL_MM.cu_5bu },
  { code: 'cu_6bu', label: '6分(19.05)', innerDiameterMm: COPPER_OD_MM.cu_6bu - 2 * COPPER_WALL_MM.cu_6bu },
]

// SGP配管用炭素鋼鋼管(JIS G3452)の外径・厚さから算出した内径(mm)。
const SGP_OD_THICKNESS_MM: Record<string, { od: number; t: number }> = {
  '20A': { od: 27.2, t: 2.8 },
  '25A': { od: 34.0, t: 3.2 },
  '32A': { od: 42.7, t: 3.5 },
  '40A': { od: 48.6, t: 3.5 },
  '50A': { od: 60.5, t: 3.8 },
  '65A': { od: 76.3, t: 4.2 },
  '80A': { od: 89.1, t: 4.2 },
  '100A': { od: 114.3, t: 4.5 },
}
const SGP_SIZES: NitrogenPipeSize[] = Object.entries(SGP_OD_THICKNESS_MM).map(([code, { od, t }]) => ({
  code,
  label: code,
  innerDiameterMm: od - 2 * t,
}))

// 将来ステンレス管等を追加する場合はここに配列要素を足すだけでよい構造。
export const NITROGEN_PIPE_TYPES: NitrogenPipeTypeDef[] = [
  { id: 'copper', name: '銅管', sizes: COPPER_SIZES },
  { id: 'sgp', name: 'SGP鋼管', sizes: SGP_SIZES },
]

export function nitrogenSizesForPipeType(pipeTypeId: string | undefined): NitrogenPipeSize[] {
  return NITROGEN_PIPE_TYPES.find((p) => p.id === pipeTypeId)?.sizes ?? []
}

export function nitrogenInnerDiameter(
  pipeTypeId: string | undefined,
  sizeCode: string | undefined,
): number | undefined {
  return nitrogenSizesForPipeType(pipeTypeId).find((s) => s.code === sizeCode)?.innerDiameterMm
}
