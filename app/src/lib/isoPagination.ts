import type { Segment } from '../types'

// PDF/印刷の「詳細（複数ページ）」モードで、アイソメ図1ページに収める
// 区間(セグメント)数の目安。A4を基準とし、相番自動採番のしきい値(10本)と
// 揃える。A3はA4のちょうど2倍の面積のため、目安の本数も2倍に広げる。
const SEGMENTS_PER_PAGE_A4 = 10

export function segmentsPerIsoPage(paperSize: 'a4' | 'a3'): number {
  return paperSize === 'a3' ? SEGMENTS_PER_PAGE_A4 * 2 : SEGMENTS_PER_PAGE_A4
}

// 目安本数(perPage)を多少超えてでも、系統・枝のまとまりを1ページに保つ
// ことを優先してよい許容量（本数）。大きくしすぎると1ページの密度が上がり
// すぎて過去のあふれ不具合(空白ページ・明細消失)の土壌に逆戻りしかねない
// ため、目安本数の3割程度・最低2本という控えめな範囲に留める。
function tolerance(perPage: number): number {
  return Math.max(2, Math.round(perPage * 0.3))
}

/**
 * parentId(直接の親セグメント)を辿り、系統・枝分かれの単位でまとめた
 * 「まとまり(run)」の列に分解する。1つのrunは「同じ直線が継手を挟んで
 * 続いているだけ（分岐なし）」の区間の連なりで、分岐点（子が複数）や
 * 系統の切り替わり（親を持たない新しい起点）でのみ次のrunに移る。
 * 単純な配列の並び順（描画した順）だと同じ枝の途中に別系統の区間が
 * 混ざることがあるため、親子関係に沿って深さ優先で辿って作る。
 */
function splitIntoRuns(segments: Segment[]): Segment[][] {
  const byId = new Map(segments.map((s) => [s.id, s]))
  const childrenOf = new Map<string, Segment[]>()
  const roots: Segment[] = []
  for (const s of segments) {
    const parent = s.parentId != null ? byId.get(s.parentId) : undefined
    if (parent) {
      const list = childrenOf.get(parent.id)
      if (list) list.push(s)
      else childrenOf.set(parent.id, [s])
    } else {
      roots.push(s)
    }
  }

  const visited = new Set<string>()
  const runs: Segment[][] = []
  let current: Segment[] = []
  function flush() {
    if (current.length > 0) {
      runs.push(current)
      current = []
    }
  }
  function visit(seg: Segment, parent: Segment | undefined) {
    if (visited.has(seg.id)) return
    visited.add(seg.id)
    const parentChildren = parent ? (childrenOf.get(parent.id) ?? []) : []
    // 分岐点（親が複数の子を持つ）から新しい枝へ移る瞬間、または系統が
    // まるごと切り替わる瞬間だけ、新しいrunとして区切る。それ以外
    // （直前の区間からの単純な続き）は同じrunに連ねる。
    if (!parent || parentChildren.length !== 1) {
      flush()
    }
    current.push(seg)
    const kids = childrenOf.get(seg.id) ?? []
    for (const kid of kids) visit(kid, seg)
  }
  for (const root of roots) visit(root, undefined)
  flush()
  // 循環参照や、親が結果セットに含まれない等の想定外データでも取りこぼさない
  // よう、未訪問が残っていれば別runとして追加する（安全側フォールバック）。
  for (const s of segments) {
    if (!visited.has(s.id)) {
      visited.add(s.id)
      runs.push([s])
    }
  }
  return runs
}

/**
 * runの列を、1ページ=perPage本を目安にページへ詰め込む。runは分岐・系統の
 * 単位でひとまとまりのため、ページの都合でどうしても収まらない場合を除き
 * runの途中では絶対に切らない。1つのrunだけでperPage(+許容量)を超える
 * 場合のみ、そのrunに限って機械的に本数で分割する。
 */
function packRuns(runs: Segment[][], perPage: number): Segment[][] {
  const tol = tolerance(perPage)
  const pages: Segment[][] = []
  let current: Segment[] = []
  for (const run of runs) {
    if (run.length > perPage + tol) {
      // このrun単独でも1ページに収まらない（分岐のない長い一本道が
      // 目安本数を大きく超えて続く場合など）。それまでのページを確定し、
      // このrunだけは確実性を優先して機械的に本数で分割する。
      if (current.length > 0) {
        pages.push(current)
        current = []
      }
      for (let i = 0; i < run.length; i += perPage) {
        pages.push(run.slice(i, i + perPage))
      }
      continue
    }
    if (current.length === 0) {
      current = run.slice()
    } else if (current.length + run.length <= perPage + tol) {
      current = current.concat(run)
    } else {
      pages.push(current)
      current = run.slice()
    }
  }
  if (current.length > 0) pages.push(current)
  return pages
}

/**
 * アイソメ図をページ単位に分割する。線(セグメント)の途中で切れることが
 * 絶対にないよう、必ずセグメント単位でまとめる。1ページに収まる本数
 * 以下なら、要素数1の配列（＝分割なし）を返す。
 *
 * 分割が必要な場合は、単に配列の先頭からperPage本ずつ機械的に切るのでは
 * なく、parentIdで辿れる親子関係をもとに「枝分かれ・系統の単位(run)」に
 * 分解してから、run単位でページへ詰め込む。これにより、1本の枝や1つの
 * 系統が複数ページにまたがって中途半端に分断されることを避け、なるべく
 * 「このページはこの枝(系統)一式」という意図の伝わる構成にする。
 * runが1ページに収まりきらないほど長い場合のみ、確実性を優先して
 * 機械的な本数区切りにフォールバックする。
 */
export function chunkSegmentsForPrint(
  segments: Segment[],
  perPage: number,
): Segment[][] {
  if (segments.length === 0) return []
  if (segments.length <= perPage) return [segments]

  const runs = splitIntoRuns(segments)
  return packRuns(runs, perPage)
}
