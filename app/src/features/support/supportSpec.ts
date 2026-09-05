// 吊り架台の「穴々・Z・切り寸」を計算するロジック（UI非依存）。
// Flutter版 lib/models/support_spec.dart の TypeScript 移植。
// React + TypeScript のアイソメアプリ（app/src/）へそのまま置ける純関数モジュール。

/** Uボルトのサイズ（呼び）。3分 = W3/8、4分 = W1/2。 */
export const UBolt = {
  w3: '3分',
  w4: '4分',
  all: ['3分', '4分'] as const,
};

/** 標準の配管呼び径（アカギUボルト表の範囲）。 */
export const PIPE_SIZES = [
  '15A', '20A', '25A', '32A', '40A', '50A', '65A', '80A', '100A',
  '125A', '150A', '200A',
];

/** 配管の外径(mm)。芯高計算に使う（アカギ表のA寸法）。 */
const OUTER_DIAMETER: Record<string, number> = {
  '15A': 21.7, '20A': 27.2, '25A': 34.0, '32A': 42.7, '40A': 48.6,
  '50A': 60.5, '65A': 76.3, '80A': 89.1, '100A': 114.3,
  '125A': 139.8, '150A': 165.2, '200A': 216.3,
};

export function outerDiameter(size: string): number | null {
  return OUTER_DIAMETER[size] ?? null;
}

/** 呼び径の数値（'100A' -> 100）。 */
export function aValue(size: string): number {
  return parseFloat(size.replace(/[^0-9.]/g, '')) || 0;
}

/** よく使うUボルト：100Aまでは3分、125A以上は4分。 */
export function recommendedUBolt(size: string): string {
  return aValue(size) <= 100 ? UBolt.w3 : UBolt.w4;
}

/** 奇数(mm)は+1して偶数にする。 */
export function evenUp(v: number): number {
  const r = Math.round(v);
  return r % 2 !== 0 ? r + 1 : r;
}

// 「配管サイズ|Uボルトサイズ」ごとの穴々（P寸法・生値）。参照時に偶数へ丸める。
const HOLE_TABLE: Record<string, number> = {
  // 3分 (W3/8)
  '15A|3分': 32, '20A|3分': 40, '25A|3分': 46, '32A|3分': 53, '40A|3分': 60,
  '50A|3分': 72, '65A|3分': 87, '80A|3分': 102, '100A|3分': 125,
  '125A|3分': 152, '150A|3分': 180,
  // 4分 (W1/2)
  '40A|4分': 62, '50A|4分': 74, '65A|4分': 90, '80A|4分': 103,
  '100A|4分': 128, '125A|4分': 153, '150A|4分': 180, '200A|4分': 232,
};

/** Uボルトの穴々を引く。未登録なら null。奇数は+1して偶数に丸める。 */
export function uboltHoleSpacing(size: string, ubolt: string): number | null {
  const raw = HOLE_TABLE[`${size}|${ubolt}`];
  return raw == null ? null : evenUp(raw);
}

/** スリーパー（昭和 L-DA+U）の標準保温厚(mm)。 */
export const SLEEPER_THICKNESSES = [20, 25, 30, 40, 50];

// 「配管サイズ|保温厚T」ごとの穴々（P寸法・生値）。参照時に偶数へ丸める。
const SLEEPER_TABLE: Record<string, number> = {
  '15A|20': 72, '15A|25': 82, '15A|30': 92, '15A|40': 112, '15A|50': 132,
  '20A|20': 78, '20A|25': 88, '20A|30': 98, '20A|40': 118, '20A|50': 138,
  '25A|20': 85, '25A|25': 95, '25A|30': 105, '25A|40': 125, '25A|50': 145,
  '32A|20': 94, '32A|25': 104, '32A|30': 114, '32A|40': 134, '32A|50': 154,
  '40A|20': 100, '40A|25': 110, '40A|30': 120, '40A|40': 140, '40A|50': 160,
  '50A|20': 112, '50A|25': 122, '50A|30': 132, '50A|40': 152, '50A|50': 172,
  '65A|20': 128, '65A|25': 138, '65A|30': 148, '65A|40': 168, '65A|50': 188,
  '80A|20': 141, '80A|25': 151, '80A|30': 161, '80A|40': 181, '80A|50': 201,
  '100A|20': 166, '100A|25': 176, '100A|30': 186, '100A|40': 206, '100A|50': 226,
  '125A|25': 203, '125A|30': 213, '125A|40': 233, '125A|50': 253,
  '150A|25': 228, '150A|30': 238, '150A|40': 258, '150A|50': 278,
  '200A|30': 289, '200A|40': 309, '200A|50': 329, // T20/25なし
};

/** スリーパーの穴々を引く。未登録なら null。奇数は+1して偶数に丸める。 */
export function sleeperHoleSpacing(size: string, thickness: number): number | null {
  const raw = SLEEPER_TABLE[`${size}|${thickness}`];
  return raw == null ? null : evenUp(raw);
}

/** アングル／チャンネルに載る配管1本ぶんの入力。 */
export interface PipeOnSupport {
  pipeSize: string;
  /** 実際の穴々(mm)（通常Uボルト or スリーパー表で解決済み）。 */
  holeSpacing: number;
  /** スリーパー厚(mm)、無しは0。 */
  sleeperThickness: number;
  /** 配管外径(mm)、芯高計算用（不明は0）。 */
  outerDiameter: number;
}

/** 配管の芯高（材料上面から）。スリーパー厚＋配管半径。 */
export function centerHeight(p: PipeOnSupport): number {
  return p.sleeperThickness + p.outerDiameter / 2;
}

/** 穴1つの位置（左端からの寸法）。 */
export interface HoleMark {
  label: string; // '吊穴L' / '100A-L' など
  x: number; // 左端からの位置(mm)
  isHanger: boolean; // 吊り穴かどうか
}

/** 計算結果。 */
export interface HangerCalcResult {
  holes: HoleMark[]; // 全ての穴（左→右）
  gapsZ: number[]; // 隣接配管間のZ
  pipeCenters: number[]; // 各配管の中心(左端から)
  effHoleSpacings: number[]; // 各配管の実穴々
  pipeCenterHeights: number[]; // 各配管の芯高
  totalLength: number; // 切り寸（全長）
  hangerPitch: number; // 吊り芯々（吊り穴なしは0）
}

/** モードAの入力。配管は左→右の順。 */
export interface HangerCalcInput {
  pipes: PipeOnSupport[];
  /** 隣り合う配管の芯々(mm)。長さは pipes.length - 1。 */
  centerToCenters: number[];
  endMarginLeft?: number; // 端あき左（端→吊穴 / 吊り穴なしは端→最初のU穴）
  hangerToUboltLeft?: number; // 吊穴→最初のU穴（左）
  hangerToUboltRight?: number; // 最後のU穴→吊穴（右）
  endMarginRight?: number; // 端あき右
  hasHanger?: boolean; // 吊り穴を付けるか（門型・L型は false）
}

/**
 * 配管の絶対位置・吊り元位置・両端から図面情報を組み立てる共通レイアウト。
 * 基準モードA/Bはどちらもここへ集約する（左端を0に正規化）。
 */
export function layoutFromCenters(opts: {
  pipes: PipeOnSupport[];
  pipeCenters: number[];
  hangerLeft: number;
  hangerRight: number;
  leftEnd: number;
  rightEnd: number;
  hasHanger?: boolean;
}): HangerCalcResult {
  const { pipes, pipeCenters, hangerLeft, hangerRight, leftEnd, rightEnd } = opts;
  const hasHanger = opts.hasHanger ?? true;
  const shift = leftEnd;
  const holes: HoleMark[] = [];
  const gapsZ: number[] = [];
  const effHoles: number[] = [];
  const heights: number[] = [];
  const centersOut: number[] = [];

  if (hasHanger) {
    holes.push({ label: '吊穴L', x: hangerLeft - shift, isHanger: true });
  }

  let prevRight: number | null = null;
  for (let i = 0; i < pipes.length; i++) {
    const e = pipes[i].holeSpacing;
    const c = pipeCenters[i] - shift;
    const l = c - e / 2;
    const r = c + e / 2;
    if (prevRight !== null) gapsZ.push(l - prevRight);
    holes.push({ label: `${pipes[i].pipeSize}-L`, x: l, isHanger: false });
    holes.push({ label: `${pipes[i].pipeSize}-R`, x: r, isHanger: false });
    centersOut.push(c);
    effHoles.push(e);
    heights.push(centerHeight(pipes[i]));
    prevRight = r;
  }

  if (hasHanger) {
    holes.push({ label: '吊穴R', x: hangerRight - shift, isHanger: true });
  }
  holes.sort((a, b) => a.x - b.x);

  return {
    holes,
    gapsZ,
    pipeCenters: centersOut,
    effHoleSpacings: effHoles,
    pipeCenterHeights: heights,
    totalLength: rightEnd - leftEnd,
    hangerPitch: hasHanger ? hangerRight - hangerLeft : 0,
  };
}

/** モードA（配管芯々基準）。端・吊穴〜U穴はユーザー既定値。 */
export function calcHanger(input: HangerCalcInput): HangerCalcResult {
  const n = input.pipes.length;
  const leftEnd = 0;
  const hasHanger = input.hasHanger ?? true;
  const endL = input.endMarginLeft ?? 40;
  const hgL = input.hangerToUboltLeft ?? 50;
  const hgR = input.hangerToUboltRight ?? 50;
  const endR = input.endMarginRight ?? 40;

  const hangerLeft = endL;
  // 吊り穴あり：端→吊穴→U穴 ／ なし：端→U穴（端あきのみ）
  const firstUholeL = hasHanger ? hangerLeft + hgL : leftEnd + endL;

  const centers: number[] = [];
  centers.push(firstUholeL + input.pipes[0].holeSpacing / 2);
  for (let i = 1; i < n; i++) {
    centers.push(centers[i - 1] + input.centerToCenters[i - 1]);
  }

  const lastUholeR = centers[centers.length - 1] + input.pipes[n - 1].holeSpacing / 2;
  const hangerRight = hasHanger ? lastUholeR + hgR : lastUholeR;
  const rightEnd = hangerRight + endR;

  return layoutFromCenters({
    pipes: input.pipes,
    pipeCenters: centers,
    hangerLeft,
    hangerRight,
    leftEnd,
    rightEnd,
    hasHanger,
  });
}

/**
 * モードB（吊り元基準）。吊り元芯々が第一基準。左右どちらかの吊り元を基準に
 * 配管を振り分ける。端の出は既定値。
 */
export function calcHangerModeB(opts: {
  pipes: PipeOnSupport[];
  hangerPitch: number; // 吊り元芯々（鉄骨で固定）
  referenceRight: boolean; // 基準の吊り元（false=左, true=右）
  refHangerToPipe: number; // 基準吊り元→最寄り配管の芯々
  centerToCenters: number[]; // 配管どうしの芯々（左→右）
  endLeft?: number; // 端の出（左）既定
  endRight?: number; // 端の出（右）既定
}): HangerCalcResult {
  const { pipes, hangerPitch, referenceRight, refHangerToPipe, centerToCenters } = opts;
  const endLeft = opts.endLeft ?? 40;
  const endRight = opts.endRight ?? 40;
  const n = pipes.length;
  const leftEnd = 0;
  const hangerLeft = endLeft;
  const hangerRight = hangerLeft + hangerPitch;

  const centers = new Array<number>(n).fill(0);
  if (!referenceRight) {
    centers[0] = hangerLeft + refHangerToPipe;
    for (let i = 1; i < n; i++) centers[i] = centers[i - 1] + centerToCenters[i - 1];
  } else {
    centers[n - 1] = hangerRight - refHangerToPipe;
    for (let i = n - 2; i >= 0; i--) centers[i] = centers[i + 1] - centerToCenters[i];
  }

  const rightEnd = hangerRight + endRight;

  return layoutFromCenters({
    pipes,
    pipeCenters: centers,
    hangerLeft,
    hangerRight,
    leftEnd,
    rightEnd,
    hasHanger: true,
  });
}

/**
 * 寸法表示用の整形。小数は2桁までに丸め、余分な0を落とす。
 * （57.15 - 44.55 = 12.600000000000001 のような誤差を消す）
 */
export function fmtMm(v: number): string {
  const r = Math.round(v * 100) / 100;
  if (r === Math.round(r)) return String(Math.round(r));
  let s = r.toFixed(2);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
