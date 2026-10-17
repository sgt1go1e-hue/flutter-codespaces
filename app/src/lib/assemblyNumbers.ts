import type { Segment } from '../types'
import type { CutResult } from './cutlength'

/**
 * 配管の接続を辿った順(起点となる区間から、繋がっている区間を順にトレース
 * していく順序)でセグメントidを並べる。相番の自動採番のデフォルトルール。
 * 「線を描いた順」(segments配列の並び)ではなく、parentId で辿れるグラフ構造
 * だけを見る。同じ親を共有する子が複数あるとき（分岐）は、元の配列順を
 * 維持する（決定的な結果にするため）。
 */
export function computeConnectionOrder(segments: Segment[]): string[] {
  const childrenByParent = new Map<string | undefined, Segment[]>()
  for (const s of segments) {
    const key = s.parentId
    const list = childrenByParent.get(key)
    if (list) list.push(s)
    else childrenByParent.set(key, [s])
  }

  const order: string[] = []
  const visited = new Set<string>()
  function visit(list: Segment[]) {
    for (const s of list) {
      if (visited.has(s.id)) continue
      visited.add(s.id)
      order.push(s.id)
      const children = childrenByParent.get(s.id)
      if (children) visit(children)
    }
  }
  visit(childrenByParent.get(undefined) ?? [])
  // parentId が図面内に存在しない(あり得ないはずだが安全のため)区間は
  // 元の配列順のまま末尾に追加する。
  for (const s of segments) {
    if (!visited.has(s.id)) {
      visited.add(s.id)
      order.push(s.id)
    }
  }
  return order
}

/**
 * 相番(合番)を区間ごとに求める。芯々寸法が入力済み(=cutが'none'以外)の
 * 区間だけを対象にする。assemblyNumberOverride が設定されている区間は
 * その値をそのまま使い(＝現場での手動調整を尊重)、それ以外の区間には
 * 配管の接続順(computeConnectionOrder)で、手動指定された番号と重複しない
 * 最小の番号を順番に割り当てる。
 *
 * 既存の芯々/切り寸法の計算(cutlength.ts)には一切手を加えず、あくまで
 * 表示用の番号をここで別途組み立てるだけ（都度算出・非破壊）。
 */
export function computeAssemblyNumbers(
  segments: Segment[],
  cutById: Record<string, CutResult>,
): Record<string, number> {
  const order = computeConnectionOrder(segments)
  const rankById = new Map(order.map((id, i) => [id, i]))

  const dimensioned = segments.filter((s) => (cutById[s.id]?.status ?? 'none') !== 'none')

  const manuallyNumbered = new Set<number>()
  for (const s of dimensioned) {
    if (s.assemblyNumberOverride != null) manuallyNumbered.add(s.assemblyNumberOverride)
  }

  const autoTargets = dimensioned
    .filter((s) => s.assemblyNumberOverride == null)
    .sort((a, b) => (rankById.get(a.id) ?? 0) - (rankById.get(b.id) ?? 0))

  let next = 1
  const nextAvailable = () => {
    while (manuallyNumbered.has(next)) next++
    return next++
  }

  const result: Record<string, number> = {}
  for (const s of dimensioned) {
    result[s.id] = s.assemblyNumberOverride ?? 0
  }
  for (const s of autoTargets) {
    result[s.id] = nextAvailable()
  }
  return result
}
