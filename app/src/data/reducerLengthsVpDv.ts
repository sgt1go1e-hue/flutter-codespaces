/**
 * 塩ビ(VP)・DV継手 インクリーザ(異径ソケット)の面間寸法(Z) 参照テーブル。
 * 出典: 積水化学工業 エスロンDV継手「インクリーザ(IN)」図番D-VP-004。
 *
 * SUS304突き合わせ溶接用の reducerLengths.ts とは物理的に別部品(材質・
 * 規格が異なる)のため、共通テーブルを流用せず専用に持つ。
 * レジューサー(縮径)・インクリーザ(拡径)は同一部品を逆向きに呼んでいる
 * だけなので、表はレジューサーと同じ「大径x小径」キー・大径側=0/小径側=
 * 全長Zという既存の取り出し寸法モデルをそのまま使う。
 *
 * キー形式: "大径A x 小径B" (呼び径、単位A)
 * 値: Z寸法(mm)
 */

export const REDUCER_LENGTH_TABLE_VP_DV: Record<string, number> = {
  "40x30": 20,
  "50x40": 20,
  "65x40": 20,
  "65x50": 20,
  "75x40": 25,
  "75x50": 25,
  "75x65": 25,
  "100x40": 30,
  "100x50": 30,
  "100x65": 30,
  "100x75": 30,
  "125x75": 35,
  "125x100": 35,
  "150x100": 40,
  "150x125": 40,
};

/**
 * サイズ組み合わせからVP-DVインクリーザ/レジューサーの面間寸法(Z)を取得する。
 * 呼び径は大径・小径どちらを先に渡しても正しく引けるようにする。
 */
export function getReducerLengthVpDv(sizeA: number, sizeB: number): number | undefined {
  const large = Math.max(sizeA, sizeB);
  const small = Math.min(sizeA, sizeB);
  return REDUCER_LENGTH_TABLE_VP_DV[`${large}x${small}`];
}
