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

// --- 段階昇圧シミュレーター(カスケード充填計算) ---
// 単純な「総量÷使用可能量」の割り算では、ボンベと配管をつなぐと圧力が
// 等しくなった時点で流れが止まる、という物理現象を無視してしまう。
// ここでは等温・理想気体近似のもと、ボンベを1本ずつ接続したときの均衡圧力を
// 質量保存式で逐次計算する。この節の計算に使う「物理容量(L)」は、上記の
// cylinderUsableLiters が使う「常圧換算7,000L」の慣用値とは別物なので
// 混同しないよう変数名・関数を完全に分けている。

/** 標準大気圧(MPa)。ゲージ圧⇔絶対圧の変換に使う。 */
const ATM_MPA = 0.1013

function gaugeToAbs(gaugeMPa: number): number {
  return gaugeMPa + ATM_MPA
}
function absToGauge(absMPa: number): number {
  return absMPa - ATM_MPA
}

export interface CascadeStep {
  index: number
  label: string
  beforePressureMPa: number
  afterPressureMPa: number
  reachedTarget: boolean
}

export interface CascadeResult {
  steps: CascadeStep[]
  reachedTarget: boolean
  usedCylinderCount: number
  freshCylinderCount: number
  /** 目標圧力がボンベ充填圧力以上で、この方法では原理上到達できない場合true */
  impossible: boolean
}

export interface CascadeParams {
  /** 配管内容積(L) */
  pipeVolumeL: number
  /** 配管の初期圧力(MPa, ゲージ圧)。すでに何か入っていれば入力する。 */
  initialPipePressureMPa: number
  /** 目標試験圧力(MPa, ゲージ圧) */
  targetPressureMPa: number
  /** 手持ちの使いかけボンベの残圧(MPa, ゲージ圧)の配列(未ソートでよい) */
  usedCylinderPressuresMPa: number[]
  /** ボンベの物理内容積(L)。47Lボンベなら実容積は約46.7L。 */
  cylinderPhysicalVolumeL: number
  /** 新品ボンベの充填圧力(MPa, ゲージ圧) */
  freshFillPressureMPa: number
  /** 無限ループ防止の安全上限(既定200本) */
  maxSteps?: number
}

/**
 * ボンベ投入順(使いかけを残圧が低い順→最後に新品)で、配管内圧が
 * 目標試験圧力に到達するまで1本ずつ均衡圧力を計算するシミュレーション。
 */
export function simulateCascadeFill(params: CascadeParams): CascadeResult {
  const {
    pipeVolumeL,
    initialPipePressureMPa,
    targetPressureMPa,
    usedCylinderPressuresMPa,
    cylinderPhysicalVolumeL,
    freshFillPressureMPa,
    maxSteps = 200,
  } = params

  const impossible = targetPressureMPa >= freshFillPressureMPa

  let pipeAbs = gaugeToAbs(initialPipePressureMPa)
  const steps: CascadeStep[] = []
  let reached = absToGauge(pipeAbs) >= targetPressureMPa - 1e-9
  let usedCylinderCount = 0
  let freshCylinderCount = 0

  function injectOne(beforeGauge: number, label: string) {
    const beforeAbs = gaugeToAbs(beforeGauge)
    const afterAbs =
      (beforeAbs * cylinderPhysicalVolumeL + pipeAbs * pipeVolumeL) /
      (cylinderPhysicalVolumeL + pipeVolumeL)
    pipeAbs = afterAbs
    const afterGauge = absToGauge(afterAbs)
    const nowReached = afterGauge >= targetPressureMPa - 1e-9
    steps.push({
      index: steps.length + 1,
      label,
      beforePressureMPa: beforeGauge,
      afterPressureMPa: afterGauge,
      reachedTarget: nowReached,
    })
    return nowReached
  }

  if (!reached && !impossible) {
    const sortedUsed = [...usedCylinderPressuresMPa].sort((a, b) => a - b)
    for (const usedP of sortedUsed) {
      if (reached || steps.length >= maxSteps) break
      usedCylinderCount += 1
      reached = injectOne(usedP, '使いかけボンベ')
    }
    while (!reached && steps.length < maxSteps) {
      freshCylinderCount += 1
      reached = injectOne(freshFillPressureMPa, '新品ボンベ')
    }
  }

  return {
    steps,
    reachedTarget: reached,
    usedCylinderCount,
    freshCylinderCount,
    impossible,
  }
}
