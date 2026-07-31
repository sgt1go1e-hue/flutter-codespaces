// 気密試験(窒素加圧)用の必要ボンベ本数計算ロジック。図面データ(Segment/BOM)
// とは完全に独立した単発計算で、既存の計算結果には一切影響しない。

/** 配管内容積(L) = π/4 × (内径mm/1000)² × 長さm × 1000 */
export function pipeVolumeLiters(innerDiameterMm: number, lengthM: number): number {
  const dM = innerDiameterMm / 1000
  return (Math.PI / 4) * dM * dM * lengthM * 1000
}

/** 必要窒素量(常圧換算, L) = V × (10×試験圧力MPa + 1) */
export function requiredNitrogenLiters(volumeL: number, testPressureMPa: number): number {
  return volumeL * (10 * testPressureMPa + 1)
}

// ボンベの「満充填時の常圧換算量」の基準値。一般的な47Lボンベ・充填圧力
// 14.7MPa(150kgf/cm²)のとき常圧換算で約7000Lという業界の慣用値を基準とし、
// 容量・圧力の変更にも比例して展開する(既定値の組み合わせで使用可能量が
// 約6,760L/本になることを確認済み)。
const REFERENCE_CAPACITY_L = 47
const REFERENCE_FILL_MPA = 14.7
const REFERENCE_NORMAL_L = 7000
const NORMAL_L_PER_L_MPA = REFERENCE_NORMAL_L / (REFERENCE_CAPACITY_L * REFERENCE_FILL_MPA)

/**
 * ボンベ1本あたりの使用可能量(常圧換算, L)。
 * 満充填(充填圧力)から使用停止残圧まで使った分だけを、常圧換算量に
 * 比例配分する。
 */
export function cylinderUsableLiters(
  capacityL: number,
  fillPressureMPa: number,
  residualPressureMPa: number,
): number {
  const usableMPa = Math.max(0, fillPressureMPa - residualPressureMPa)
  return capacityL * usableMPa * NORMAL_L_PER_L_MPA
}

/** 必要本数 = ROUNDUP(必要窒素量 / 1本あたり使用可能量) */
export function requiredCylinderCount(requiredL: number, usablePerCylinderL: number): number {
  if (usablePerCylinderL <= 0) return 0
  return Math.ceil(requiredL / usablePerCylinderL)
}
