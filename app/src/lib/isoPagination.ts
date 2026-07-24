import type { Segment } from '../types'

// PDF/印刷の「詳細（複数ページ）」モードで、アイソメ図1ページに収める
// 区間(セグメント)数の目安。A4を基準とし、相番自動採番のしきい値(10本)と
// 揃える。A3はA4のちょうど2倍の面積のため、目安の本数も2倍に広げる。
const SEGMENTS_PER_PAGE_A4 = 10

export function segmentsPerIsoPage(paperSize: 'a4' | 'a3'): number {
  return paperSize === 'a3' ? SEGMENTS_PER_PAGE_A4 * 2 : SEGMENTS_PER_PAGE_A4
}

/**
 * アイソメ図をページ単位に分割する。線(セグメント)の途中で切れることが
 * 絶対にないよう、必ずセグメント単位でまとめる。1ページに収まる本数
 * 以下なら、要素数1の配列（＝分割なし）を返す。
 */
export function chunkSegmentsForPrint(
  segments: Segment[],
  perPage: number,
): Segment[][] {
  if (segments.length === 0) return []
  if (segments.length <= perPage) return [segments]
  const chunks: Segment[][] = []
  for (let i = 0; i < segments.length; i += perPage) {
    chunks.push(segments.slice(i, i + perPage))
  }
  return chunks
}
