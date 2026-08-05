import type { Point, Segment } from '../types'
import { distanceToSegment, projectOnSegment, samePoint } from './isometric'
import { splitFieldWeldMarks } from './fieldMarks'

/** 指定セグメントを点 P で前後2本に分割する（下流 B は上流 A を親に継承）。 */
export function splitSegmentAt(
  segments: Segment[],
  targetId: string,
  P: Point,
  makeId: () => string,
): Segment[] {
  const target = segments.find((s) => s.id === targetId)
  if (!target) return segments
  const bId = makeId()
  // 現場溶接マークは分割後の区間長に合わせてA/Bへ振り分ける(そのまま
  // コピーすると、同じtでも区間が短くなった分だけ図面上の位置がずれる)。
  const { t: tSplit } = projectOnSegment(P, target.start, target.end)
  const marks = splitFieldWeldMarks(target.fieldWeldMarks, tSplit)
  // A の終点はP(新しい分岐ノード)に変わるため、元の終点側だけに意味を持つ
  // endFitting個別上書きはAには残せない(そのままだと分割点の継手に誤って
  // 適用されてしまう)。元の終点はB側が引き継ぐので、endFittingもBへ移す。
  const A: Segment = { ...target, end: P, endFitting: undefined, fieldWeldMarks: marks.a }
  const B: Segment = {
    id: bId,
    start: P,
    end: target.end,
    angle: target.angle,
    parentId: target.id,
    connection: target.connection,
    // size/pipeType/fitting は持たせない → A から継承（ユーザーが後で変更可）
    // 系統色(colorId)だけは継承の仕組み(Effective)を持たない直接指定の属性
    // なので、ここで明示的にコピーしないと分割後のB側だけ色が消えてしまう。
    colorId: target.colorId,
    // 元の終点側の個別上書き(endFitting)はB側の終点として引き継ぐ。
    endFitting: target.endFitting,
    fieldWeldMarks: marks.b,
  }
  const result: Segment[] = []
  for (const s of segments) {
    if (s.id === targetId) {
      result.push(A)
      continue
    }
    // 元セグメントの子は、B 側に近ければ B を親に付け替える
    if (s.parentId === targetId) {
      const dA = distanceToSegment(s.start, A.start, A.end)
      const dB = distanceToSegment(s.start, B.start, B.end)
      result.push(dB < dA ? { ...s, parentId: bId } : s)
      continue
    }
    result.push(s)
  }
  const idx = result.findIndex((s) => s.id === targetId)
  result.splice(idx + 1, 0, B)
  return result
}

/**
 * 分岐点で本管を自動分割する。
 * バットウェルド継手はランを切断するため、あるセグメントの端点が別セグメントの
 * 途中（中間分岐＝チーズ）に乗っている場合、その本管を接点で2本に分ける。
 * これにより分岐の奥側／手前側を独立して選択・サイズ・寸法入力できる。
 * 描いた順序に依らず正規化するため、変化が無くなるまで繰り返す。
 */
export function normalizeBranchSplits(
  segments: Segment[],
  makeId: () => string,
): Segment[] {
  let list = segments
  for (let guard = 0; guard < 50; guard++) {
    let done = true
    for (const s of list) {
      let hit: Point | null = null
      for (const o of list) {
        if (o.id === s.id) continue
        for (const pt of [o.start, o.end]) {
          if (samePoint(pt, s.start) || samePoint(pt, s.end)) continue
          if (distanceToSegment(pt, s.start, s.end) < 1.5) {
            hit = pt
            break
          }
        }
        if (hit) break
      }
      if (!hit) continue
      const { point: P, t } = projectOnSegment(hit, s.start, s.end)
      if (t < 0.02 || t > 0.98) continue
      list = splitSegmentAt(list, s.id, P, makeId)
      done = false
      break
    }
    if (done) break
  }
  return list
}
