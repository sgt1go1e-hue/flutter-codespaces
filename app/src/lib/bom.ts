import type { Segment } from '../types'
import type { Effective } from './inheritance'
import type { CutResult } from './cutlength'
import { computeEnds, type EndRole, type EndResult } from './takeout'
import { samePoint } from './isometric'
import {
  getFitting,
  getPipeType,
  nominalOf,
  connectionLabelForSource,
  flangeLabelForConnection,
} from '../data/masters'

// BOM(部品表)の行
export interface PipeRow {
  pipeType?: string
  pipeShort: string
  size?: string
  count: number // 本数
  totalMm: number // 合計長さ(mm)
  cuts: number[] // 個々の切り寸法(mm)。大きい順。現場で切る寸法の明細。
}
export interface FittingRow {
  fittingId: string
  label: string
  size: string // "100A" or "100A×50A"
  count: number
  /** 接続方法(溶接/ねじ込み/差込等)。継手マスタのsourceから推定。 */
  connection: string
}
export interface FlangeRow {
  label: string
  size: string
  count: number
  /** 接続方法。フランジは常に「フランジ接合」。 */
  connection: string
}
export interface Bom {
  pipes: PipeRow[]
  fittings: FittingRow[]
  flanges: FlangeRow[]
}

const NODE_EPS = 1

interface EndAt extends EndResult {
  point: { x: number; y: number }
  size?: string
}

const isTeeRole = (r: EndRole) =>
  r === 'tee-run' || r === 'tee-branch' || r === 'tee-run-reducer'

// 大径_小径の順で "100A×50A" のような表示ラベルを作る
function pairLabel(a?: string, b?: string): string {
  const na = nominalOf(a)
  const nb = nominalOf(b)
  if (na == null || nb == null) return `${a ?? '?'}×${b ?? '?'}`
  return na >= nb ? `${a}×${b}` : `${b}×${a}`
}

const fittingLabel = (id: string) =>
  getFitting(id)?.name ?? getFitting(id)?.short ?? id

/**
 * 図面から材料集計(BOM)を作る。
 * - パイプ: 管種×呼び径ごとに、計上可能(切り寸>0)な区間の合計長さと本数。
 * - 継手: 節点単位で重複なく数える（エルボ/チーズ/レジューサー）。
 * - フランジ: 呼び径ごとの枚数（両フランジは接合の前後で2枚と数える）。
 */
export function computeBom(
  segments: Segment[],
  effById: Record<string, Effective>,
  cutById: Record<string, CutResult>,
): Bom {
  // --- パイプ ---
  const pipeMap = new Map<string, PipeRow>()
  for (const s of segments) {
    const c = cutById[s.id]
    if (!c || c.status !== 'ok' || c.cut == null) continue
    const eff = effById[s.id]
    const key = `${eff?.pipeType ?? ''}|${eff?.size ?? ''}`
    let row = pipeMap.get(key)
    if (!row) {
      row = {
        pipeType: eff?.pipeType,
        pipeShort: eff?.pipeType
          ? (getPipeType(eff.pipeType)?.short ?? eff.pipeType)
          : '—',
        size: eff?.size,
        count: 0,
        totalMm: 0,
        cuts: [],
      }
      pipeMap.set(key, row)
    }
    row.count += 1
    row.totalMm += c.cut
    row.cuts.push(c.cut)
  }
  // 各サイズの切り寸は大きい順に（現場で拾いやすい）
  for (const row of pipeMap.values()) row.cuts.sort((a, b) => b - a)

  // --- 継手（節点でクラスタリングして分類） ---
  const ends = computeEnds(segments, effById)
  const endList: EndAt[] = []
  for (const s of segments) {
    const size = effById[s.id]?.size
    endList.push({ ...ends[s.id].start, point: s.start, size })
    endList.push({ ...ends[s.id].end, point: s.end, size })
  }
  // 端点を節点にまとめる
  const clusters: EndAt[][] = []
  for (const e of endList) {
    const c = clusters.find((cl) => samePoint(cl[0].point, e.point, NODE_EPS))
    if (c) c.push(e)
    else clusters.push([e])
  }

  const fitMap = new Map<string, FittingRow>()
  const addFit = (fittingId: string, size: string) => {
    const key = `${fittingId}|${size}`
    let row = fitMap.get(key)
    if (!row) {
      row = {
        fittingId,
        label: fittingLabel(fittingId),
        size,
        count: 0,
        connection: connectionLabelForSource(getFitting(fittingId)?.source),
      }
      fitMap.set(key, row)
    }
    row.count += 1
  }

  for (const cl of clusters) {
    const roles = cl.map((e) => e.role)
    if (roles.some(isTeeRole)) {
      // チーズ節点
      const runEnds = cl.filter(
        (e) => e.role === 'tee-run' || e.role === 'tee-run-reducer',
      )
      const branchEnds = cl.filter((e) => e.role === 'tee-branch')
      // 本管(ラン)ヘッダ径 = ラン側の最大径
      let runSize = branchEnds[0]?.size
      let runN = -1
      for (const e of runEnds) {
        const n = nominalOf(e.size)
        if (n != null && n > runN) {
          runN = n
          runSize = e.size
        }
      }
      // 同一節点に枝管が複数(度数4以上＝1点から枝が2本以上)ある場合、
      // 現場では枝ごとに別のチーズとして溶接するため、枝の本数だけ計上する
      // （以前は cl.find で最初の1本しか見ておらず、2本目以降が漏れていた）。
      const branchesToCount = branchEnds.length > 0 ? branchEnds : [undefined]
      for (const branchEnd of branchesToCount) {
        const branchN = nominalOf(branchEnd?.size)
        const reducing = runN >= 0 && branchN != null && runN !== branchN
        // 差込/ねじ込み/塩ビ(DV・TS)等、実際に使われた継手id（takeout.ts側で
        // 接続方法/管種から解決済み）をそのまま使う。以前はここで
        // 'tee_reducing'/'tee_equal' に固定していたため、差込・ねじ込み・
        // 塩ビ継手でもBOM上は突き合わせ溶接の品名のまま表示される不具合があった。
        const fittingId =
          branchEnd?.fittingId ??
          runEnds[0]?.fittingId ??
          (reducing ? 'tee_reducing' : 'tee_equal')
        if (reducing) addFit(fittingId, pairLabel(runSize, branchEnd?.size))
        else addFit(fittingId, `${runSize ?? branchEnd?.size ?? '?'}`)
      }
      // ツキ合わせのレジューサー（縮径したラン側 = tee-run-reducer 端ごとに1個）
      for (const e of cl) {
        if (e.role === 'tee-run-reducer')
          addFit('reducer_concentric', pairLabel(runSize, e.size))
      }
    } else if (roles.includes('elbow-reducer')) {
      // エルボ直後の突き合わせレジューサー（区間は分けず、取り出し寸法だけ
      // 隣のエルボ側へ折り込んでいる）。エルボ本体とレジューサーを別々に計上する。
      const e = cl.find((x) => x.role === 'elbow-reducer')!
      addFit(e.fittingId ?? 'elbow90_long', `${e.size ?? '?'}`)
      if (e.reducerCounterpart) addFit('reducer_concentric', pairLabel(e.size, e.reducerCounterpart))
    } else if (roles.includes('elbow')) {
      const e = cl.find((x) => x.role === 'elbow')!
      addFit(e.fittingId ?? 'elbow90_long', `${e.size ?? '?'}`)
    } else if (roles.includes('reducer')) {
      // 同径直管以外の直線接続＝レジューサー（明示レジューサー含む）
      const rs = cl.filter((x) => x.role === 'reducer')
      const fittingId = rs.find((x) => x.fittingId)?.fittingId ?? 'reducer_concentric'
      addFit(fittingId, pairLabel(rs[0]?.size, rs[1]?.size))
    }
    // 'straight'(同径直結) / 'free' は継手なし
  }

  // --- フランジ ---
  // 材料としては片/両を区別せず、品名(溶接フランジ/ねじ込みフランジ)と呼び径ごとに集計する。
  const flangeMap = new Map<string, FlangeRow>()
  const addFlange = (size: string, label: string) => {
    const key = `${label}|${size}`
    let row = flangeMap.get(key)
    if (!row) {
      row = { label, size, count: 0, connection: 'フランジ接合' }
      flangeMap.set(key, row)
    }
    row.count += 1
  }
  for (const s of segments) {
    const size = effById[s.id]?.size ?? '?'
    const label = flangeLabelForConnection(s.connection)
    if (s.startFlange) addFlange(size, label)
    if (s.endFlange) addFlange(size, label)
  }

  // 呼び径の大きい順・種類順に並べて返す
  const byNomDesc = (a?: string, b?: string) =>
    (nominalOf(b) ?? 0) - (nominalOf(a) ?? 0)
  return {
    pipes: [...pipeMap.values()].sort((a, b) => byNomDesc(a.size, b.size)),
    fittings: [...fitMap.values()].sort(
      (a, b) =>
        a.fittingId.localeCompare(b.fittingId) || byNomDesc(a.size, b.size),
    ),
    flanges: [...flangeMap.values()].sort(
      (a, b) => a.label.localeCompare(b.label) || byNomDesc(a.size, b.size),
    ),
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10

/**
 * BOM を CSV 文字列にする。パイプは1本ごと（切り寸法の明細）＋サイズ別の小計、
 * 継手・フランジは数量で出力する。
 */
export function bomToCsv(bom: Bom): string {
  const rows: string[][] = []
  rows.push(['区分', '品名', '呼び径', '接続方法', '切り寸法(mm)', '数量'])
  for (const p of bom.pipes) {
    // 1本ごとの明細（切る寸法）
    for (const cut of p.cuts) {
      rows.push(['パイプ', p.pipeShort, p.size ?? '', '', String(round1(cut)), '1'])
    }
    // サイズ別の小計
    rows.push([
      'パイプ小計',
      p.pipeShort,
      p.size ?? '',
      '',
      String(round1(p.totalMm)),
      String(p.count),
    ])
  }
  for (const f of bom.fittings) {
    rows.push(['継手', f.label, f.size, f.connection, '', String(f.count)])
  }
  for (const f of bom.flanges) {
    rows.push(['フランジ', f.label, f.size, f.connection, '', String(f.count)])
  }
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n')
}
