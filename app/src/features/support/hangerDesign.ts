// 吊り架台の入力一式（図面＝計算のあいだで共有するモデル）。
// Flutter版 lib/models/hanger_design.dart の TypeScript 移植。

import {
  PipeOnSupport,
  HangerCalcResult,
  calcHanger,
  calcHangerModeB,
  sleeperHoleSpacing,
  uboltHoleSpacing,
  recommendedUBolt,
  outerDiameter,
  fmtMm,
  HoleMark,
} from './supportSpec';

/** 穴の色パレット（穴の種類ごとに選べる）。 */
export const holeColorPalette = [
  '#212121', // 黒
  '#1565C0', // 青
  '#2E7D32', // 緑
  '#EF6C00', // 橙
  '#C62828', // 赤
  '#6A1B9A', // 紫
];

/** 穴の仕様（丸穴／長穴・径・長穴寸法・色）。 */
export interface HoleSpec {
  slot: boolean; // false=丸穴, true=長穴
  dia: number; // 丸穴の径
  slotW: number; // 長穴 幅
  slotL: number; // 長穴 長さ
  colorIndex: number; // holeColorPalette の番号
}

export function holeSpec(partial: Partial<HoleSpec> = {}): HoleSpec {
  return {
    slot: partial.slot ?? false,
    dia: partial.dia ?? 11,
    slotW: partial.slotW ?? 12,
    slotL: partial.slotL ?? 20,
    colorIndex: partial.colorIndex ?? 0,
  };
}

export function holeColor(spec: HoleSpec): string {
  return holeColorPalette[spec.colorIndex % holeColorPalette.length];
}

/** 図面表記（φ11 / 12×20 長穴）。 */
export function holeNotation(spec: HoleSpec): string {
  return spec.slot
    ? `${fmtMm(spec.slotW)}×${fmtMm(spec.slotL)}`
    : `φ${fmtMm(spec.dia)}`;
}

/** 吊り架台の入力一式。 */
export interface HangerDesign {
  pipeSizes: string[];
  sleepers: number[]; // 各配管の保温厚（0=なし）
  spans: number[]; // 隣接配管の芯々（本数-1）

  modeB: boolean; // false=A(配管芯々基準) / true=B(吊り元基準)
  memberChannel: boolean; // false=アングル / true=チャンネル（溝形鋼）
  hasHanger: boolean; // 吊り穴を付けるか（門型・L型は false）
  bladeTop: boolean; // 刃/背向き：true=奥（上）/ false=手前（下）
  gauge: number; // 刃側／背側から穴まで（ゲージ）

  // 穴の仕様（Uボルトサイズ別・吊り穴）
  hole3: HoleSpec;
  hole4: HoleSpec;
  holeHanger: HoleSpec;

  // モードA
  endL: number; // 端あき左
  hgL: number; // 吊穴→U穴 左
  hgR: number; // 吊穴→U穴 右
  endR: number; // 端あき右

  // モードB
  hangerPitch: number; // 吊り元芯々
  refRight: boolean; // 基準の吊り元（false=左, true=右）
  refToPipe: number; // 基準吊り元→最寄り配管 芯々
  endOutL: number; // 端の出 左
  endOutR: number; // 端の出 右
}

/** 既定の吊り架台（100A/80A・芯々200）。 */
export function createHangerDesign(partial: Partial<HangerDesign> = {}): HangerDesign {
  return {
    pipeSizes: partial.pipeSizes ?? ['100A', '80A'],
    sleepers: partial.sleepers ?? [0, 0],
    spans: partial.spans ?? [200],
    modeB: partial.modeB ?? false,
    memberChannel: partial.memberChannel ?? false,
    hasHanger: partial.hasHanger ?? true,
    bladeTop: partial.bladeTop ?? true,
    gauge: partial.gauge ?? 22,
    hole3: partial.hole3 ?? holeSpec({ dia: 11, colorIndex: 1 }),
    hole4: partial.hole4 ?? holeSpec({ dia: 14, colorIndex: 2 }),
    holeHanger: partial.holeHanger ?? holeSpec({ dia: 11, colorIndex: 0 }),
    endL: partial.endL ?? 40,
    hgL: partial.hgL ?? 50,
    hgR: partial.hgR ?? 50,
    endR: partial.endR ?? 40,
    hangerPitch: partial.hangerPitch ?? 600,
    refRight: partial.refRight ?? false,
    refToPipe: partial.refToPipe ?? 150,
    endOutL: partial.endOutL ?? 40,
    endOutR: partial.endOutR ?? 40,
  };
}

/** 各配管の穴々（Uボルト or スリーパー）を解決する。 */
export function resolveHole(size: string, sleeper: number): number | null {
  if (sleeper > 0) return sleeperHoleSpacing(size, sleeper);
  return uboltHoleSpacing(size, recommendedUBolt(size));
}

export function holeSource(size: string, sleeper: number): string {
  if (sleeper > 0) return `保温T${sleeper}`;
  return `Uボルト${recommendedUBolt(size)}`;
}

/** 穴1つに対応する仕様（吊り穴／3分／4分）。 */
export function specForHole(d: HangerDesign, h: HoleMark): HoleSpec {
  if (h.isHanger) return d.holeHanger;
  const size = h.label.split('-')[0];
  return recommendedUBolt(size) === '3分' ? d.hole3 : d.hole4;
}

/** 図面の凡例に出す穴の種類（使っているものだけ）。 */
export function legendSpecs(d: HangerDesign): Array<{ key: string; spec: HoleSpec }> {
  const out: Array<{ key: string; spec: HoleSpec }> = [];
  if (d.pipeSizes.some((s) => recommendedUBolt(s) === '3分')) {
    out.push({ key: '3分', spec: d.hole3 });
  }
  if (d.pipeSizes.some((s) => recommendedUBolt(s) === '4分')) {
    out.push({ key: '4分', spec: d.hole4 });
  }
  if (d.hasHanger) out.push({ key: '吊', spec: d.holeHanger });
  return out;
}

export function buildPipes(d: HangerDesign): PipeOnSupport[] {
  return d.pipeSizes.map((s, i) => ({
    pipeSize: s,
    holeSpacing: resolveHole(s, d.sleepers[i]) ?? 0,
    sleeperThickness: d.sleepers[i],
    outerDiameter: outerDiameter(s) ?? 0,
  }));
}

/** 穴々が未登録の配管（サイズ＋出典）を返す。空なら計算可能。 */
export function missing(d: HangerDesign): string[] {
  const m: string[] = [];
  for (let i = 0; i < d.pipeSizes.length; i++) {
    if (resolveHole(d.pipeSizes[i], d.sleepers[i]) == null) {
      m.push(`${d.pipeSizes[i]}(${holeSource(d.pipeSizes[i], d.sleepers[i])})`);
    }
  }
  return m;
}

/** 計算を実行（モードと吊り穴有無で分岐）。 */
export function compute(d: HangerDesign): HangerCalcResult {
  const pipes = buildPipes(d);
  // 吊り元基準（B）は吊り穴が前提。吊り穴なしは配管芯々基準（A）に統一。
  if (d.modeB && d.hasHanger) {
    return calcHangerModeB({
      pipes,
      hangerPitch: d.hangerPitch,
      referenceRight: d.refRight,
      refHangerToPipe: d.refToPipe,
      centerToCenters: d.spans,
      endLeft: d.endOutL,
      endRight: d.endOutR,
    });
  }
  return calcHanger({
    pipes,
    centerToCenters: d.spans,
    endMarginLeft: d.endL,
    hangerToUboltLeft: d.hgL,
    hangerToUboltRight: d.hgR,
    endMarginRight: d.endR,
    hasHanger: d.hasHanger,
  });
}

/** 配管を1本追加（既定 100A）。 */
export function addPipe(d: HangerDesign): HangerDesign {
  return {
    ...d,
    pipeSizes: [...d.pipeSizes, '100A'],
    sleepers: [...d.sleepers, 0],
    spans: [...d.spans, 200],
  };
}

/** 配管を1本削除。 */
export function removePipe(d: HangerDesign, i: number): HangerDesign {
  if (d.pipeSizes.length <= 1) return d;
  const pipeSizes = d.pipeSizes.filter((_, k) => k !== i);
  const sleepers = d.sleepers.filter((_, k) => k !== i);
  const spans = [...d.spans];
  spans.splice(i === 0 ? 0 : i - 1, 1);
  return { ...d, pipeSizes, sleepers, spans };
}
