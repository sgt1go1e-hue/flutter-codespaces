// メーカーカタログの寸法図のような、継手の線画。
// 接続方式ごとに見た目の特徴を描き分ける:
//   突合せ溶接 … 管と同じ太さの曲がり。端に開先(面取り)
//   差込溶接   … 鍛造のかたまり。受口(差込み穴)とドリル穴が交わる内部
//   ねじ込み   … 鋳物の太い胴と口元の帯(ビード)。テーパーのめねじ
//   塩ビTS     … 肉厚の受口。受口の奥に段(差込み底)
//   塩ビDV     … 薄肉で大きな曲がり。口元に小さなつば
// 形は「芯からの距離」で組み立てる。A=芯〜差込み底(=引しろ)、F=芯〜継手の端面。
// 外形は部品を重ねて描き、太い線→塗りの順に重ねることで外周の線だけを残す。
import type { ReactNode } from 'react'
import type { ConnectionKind } from '../lib/takeout'

export type Joint = ConnectionKind
type V = { x: number; y: number }

const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k })
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y
const cross = (a: V, b: V) => a.x * b.y - a.y * b.x
const len = (a: V) => Math.hypot(a.x, a.y)
const norm = (a: V): V => mul(a, 1 / (len(a) || 1))
const perp = (u: V): V => ({ x: -u.y, y: u.x })
const f = (n: number) => (Math.round(n * 10) / 10).toString()
const pt = (p: V) => `${f(p.x)},${f(p.y)}`

/** 線の交点（平行ならa1を返す） */
function intersect(a1: V, ad: V, b1: V, bd: V): V {
  const d = cross(ad, bd)
  if (Math.abs(d) < 1e-6) return a1
  const t = cross(sub(b1, a1), bd) / d
  return add(a1, mul(ad, t))
}

interface Proportions {
  /** 芯〜端面 = A + depth */
  depth: number
  /** 受口・胴の外側の半幅 */
  hub: number
  /** 曲がり部の胴の半幅 */
  bendHalf: number
  /** 内径(流路)の半幅 */
  bore: number
  /** 曲がりの接線長（芯から曲がりが始まるまで）。0なら角ばったかたまり */
  tangent: number
}

function proportions(joint: Joint, A: number, ro: number, isTee: boolean): Proportions {
  switch (joint) {
    case 'buttweld':
      return { depth: 0, hub: ro, bendHalf: ro, bore: ro * 0.86, tangent: A }
    case 'socket':
      return { depth: ro * 1.2, hub: ro * 1.5, bendHalf: ro * 1.5, bore: ro * 0.62, tangent: 0 }
    case 'thread':
      return { depth: ro * 1.1, hub: ro * 1.3, bendHalf: ro * 1.22, bore: ro * 0.8, tangent: isTee ? 0 : A * 0.62 }
    case 'vp_ts':
      return { depth: ro * 1.7, hub: ro * 1.3, bendHalf: ro * 1.22, bore: ro * 0.82, tangent: isTee ? 0 : A * 0.55 }
    case 'vp_dv':
    default:
      return { depth: ro * 1.9, hub: ro * 1.16, bendHalf: ro * 1.12, bore: ro * 0.9, tangent: isTee ? 0 : A * 0.8 }
  }
}

/** 脚の上の点: 芯Cから向きuへ距離r、横へw(左手側が正) */
function legPt(C: V, u: V, r: number, w: number): V {
  return add(add(C, mul(u, r)), mul(perp(u), w))
}

/** 脚に沿った長方形（芯からの距離 r1〜r2、半幅 h） */
function legRect(C: V, u: V, r1: number, r2: number, h: number): string {
  const a = legPt(C, u, r1, -h)
  const b = legPt(C, u, r2, -h)
  const c = legPt(C, u, r2, h)
  const d = legPt(C, u, r1, h)
  return `M${pt(a)} L${pt(b)} L${pt(c)} L${pt(d)}Z`
}

/** 曲がり（2本の脚の間の円弧）の情報 */
function bendOf(C: V, u1: V, u2: V, T: number) {
  const T1 = add(C, mul(u1, T))
  const T2 = add(C, mul(u2, T))
  // 円弧の中心: T1から脚に直角に、もう一方の脚の側へ
  const n1 = perp(u1)
  const toward = dot(n1, u2) > 0 ? n1 : mul(n1, -1)
  const half = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))) / 2
  const rb = T * Math.tan(half)
  const K = add(T1, mul(toward, rb))
  const sweep = cross(sub(T1, K), sub(T2, K)) > 0 ? 1 : 0
  return { T1, T2, K, rb, sweep, n1, toward }
}

/** 芯線から左右に w ずらした円弧（脚1の横方向 w の側） */
function bendArc(b: ReturnType<typeof bendOf>, w: number, u1: V): { p1: V; p2: V; r: number } {
  const p1 = add(b.T1, mul(perp(u1), w))
  const r = len(sub(p1, b.K))
  const p2 = add(b.K, mul(norm(sub(b.T2, b.K)), r))
  return { p1, p2, r }
}

export interface FittingArtProps {
  joint: Joint
  /** 継手の芯(芯線の交点) */
  C: V
  /** 芯から外へ向かう各脚の向き（エルボ=2本、T=3本で最初の2本がメイン） */
  legs: V[]
  /** 芯〜差込み底(引しろ)の長さ(px) */
  A: number
  /** 管の外径の半分(px) */
  ro: number
  /** 線の太さ */
  sw?: number
  /** 選択中などで線の色を変える */
  accent?: boolean
  /** 枝だけ別の引しろにする(T)。省略時はA */
  branchA?: number
}

export function FittingArt({ joint, C, legs, A, ro, sw = 2, accent, branchA }: FittingArtProps) {
  const isTee = legs.length === 3
  const P = proportions(joint, A, ro, isTee)
  const Aof = (i: number) => (isTee && i === 2 && branchA != null ? branchA : A)
  const Fof = (i: number) => Aof(i) + P.depth
  const lineCls = accent ? 'fa-line accent' : 'fa-line'

  // ---- 外形の部品
  const body: string[] = []
  if (!isTee && P.tangent > 0) {
    const b = bendOf(C, legs[0], legs[1], P.tangent)
    const o = bendArc(b, -P.bendHalf * Math.sign(dot(b.toward, perp(legs[0]))), legs[0])
    const i = bendArc(b, P.bendHalf * Math.sign(dot(b.toward, perp(legs[0]))), legs[0])
    body.push(
      `M${pt(o.p1)} A${f(o.r)},${f(o.r)} 0 0 ${b.sweep} ${pt(o.p2)} L${pt(i.p2)} A${f(i.r)},${f(i.r)} 0 0 ${1 - b.sweep} ${pt(i.p1)}Z`,
    )
  }
  legs.forEach((u, k) => {
    // 曲がりと少し重ねる(継ぎ目に細い線が出ないように)
    const from = P.tangent > 0 && !isTee ? Math.max(0, P.tangent - 2) : 0
    if (Fof(k) > from) body.push(legRect(C, u, from, Fof(k), P.hub))
  })
  if (isTee) {
    // Tの中心のかたまり。角を少し丸めた四角
    const h = P.hub
    const r = h * 0.35
    body.push(`M${f(C.x - h + r)},${f(C.y - h)} H${f(C.x + h - r)} A${f(r)},${f(r)} 0 0 1 ${f(C.x + h)},${f(C.y - h + r)} V${f(C.y + h - r)} A${f(r)},${f(r)} 0 0 1 ${f(C.x + h - r)},${f(C.y + h)} H${f(C.x - h + r)} A${f(r)},${f(r)} 0 0 1 ${f(C.x - h)},${f(C.y + h - r)} V${f(C.y - h + r)} A${f(r)},${f(r)} 0 0 1 ${f(C.x - h + r)},${f(C.y - h)}Z`)
  } else if (P.tangent === 0) {
    // 鍛造エルボ: 芯に丸を重ねて、外側の角を丸くする
    const h = P.hub
    body.push(`M${f(C.x - h)},${f(C.y)} A${f(h)},${f(h)} 0 1 0 ${f(C.x + h)},${f(C.y)} A${f(h)},${f(h)} 0 1 0 ${f(C.x - h)},${f(C.y)}Z`)
  }
  // 口元の帯（ねじ込みのビード／DVのつば）
  if (joint === 'thread') legs.forEach((u, k) => body.push(legRect(C, u, Fof(k) - ro * 0.45, Fof(k), P.hub + ro * 0.18)))
  if (joint === 'vp_dv') legs.forEach((u, k) => body.push(legRect(C, u, Fof(k) - ro * 0.22, Fof(k), P.hub + ro * 0.1)))

  // ---- 内側・端の線
  const det: ReactNode[] = []
  const thin = sw * 0.6
  const line = (d: string, key: string, w = thin, dash?: string) => (
    <path key={key} d={d} className={lineCls} strokeWidth={w} fill="none" strokeDasharray={dash} />
  )

  if (joint === 'buttweld') {
    // 開先: 端面の手前に1本と、角の面取り
    legs.forEach((u, k) => {
      const F = Fof(k)
      const c = ro * 0.22
      det.push(line(`M${pt(legPt(C, u, F - c, -ro))} L${pt(legPt(C, u, F, -ro + c))} L${pt(legPt(C, u, F, ro - c))} L${pt(legPt(C, u, F - c, ro))}`, `bv${k}`))
      det.push(line(`M${pt(legPt(C, u, F - c, -ro))} L${pt(legPt(C, u, F - c, ro))}`, `bl${k}`, thin * 0.8))
    })
  } else {
    // 受口(差込み穴)・めねじ: 端面から差込み底まで
    legs.forEach((u, k) => {
      const F = Fof(k)
      const a = Aof(k)
      const inMouth = joint === 'thread' ? ro * 1.0 : ro
      const inBottom = joint === 'thread' ? ro * 0.86 : ro
      for (const s of [-1, 1]) {
        det.push(line(`M${pt(legPt(C, u, F, s * inMouth))} L${pt(legPt(C, u, a, s * inBottom))} L${pt(legPt(C, u, a, s * P.bore))}`, `so${k}${s}`))
      }
      if (joint === 'thread') {
        // ねじ山を細い線で数本
        const n = 4
        for (let j = 1; j < n; j++) {
          const r = F - ((F - a) * j) / n
          const wv = inMouth - ((inMouth - inBottom) * j) / n
          det.push(line(`M${pt(legPt(C, u, r, -wv))} L${pt(legPt(C, u, r - ro * 0.12, -wv + ro * 0.12))} M${pt(legPt(C, u, r, wv))} L${pt(legPt(C, u, r - ro * 0.12, wv - ro * 0.12))}`, `th${k}${j}`, thin * 0.7))
        }
      }
    })
  }

  // 流路(内径)の線
  if (joint !== 'buttweld') {
    if (!isTee && P.tangent > 0) {
      const b = bendOf(C, legs[0], legs[1], P.tangent)
      for (const s of [-1, 1]) {
        const arc = bendArc(b, s * P.bore, legs[0])
        const st1 = legPt(C, legs[0], A, s * P.bore)
        // 脚2で同じ側の点
        const st2 = add(arc.p2, mul(legs[1], A - P.tangent))
        det.push(line(`M${pt(st1)} L${pt(arc.p1)} A${f(arc.r)},${f(arc.r)} 0 0 ${b.sweep} ${pt(arc.p2)} L${pt(st2)}`, `bo${s}`))
      }
    } else if (!isTee) {
      // 鍛造: 2本のドリル穴が芯で交わる（内側どうし・外側どうしの線を延ばして交わらせる）
      const [u1, u2] = legs
      const in1 = Math.sign(dot(perp(u1), u2)) || 1
      const in2 = Math.sign(dot(perp(u2), u1)) || 1
      for (const s of [1, -1]) {
        const a1 = legPt(C, u1, A, s * in1 * P.bore)
        const b1 = legPt(C, u2, A, s * in2 * P.bore)
        const x = intersect(a1, u1, b1, u2)
        det.push(line(`M${pt(a1)} L${pt(x)} L${pt(b1)}`, `dr${s}`))
      }
    } else {
      // T: メインは通しの穴、枝はメインの穴まで
      const [m1, m2, br] = legs
      const nb = perp(m1)
      const side = Math.sign(dot(nb, br)) || 1 // 枝のある側
      const at = (u: V, r: number, w: number) => add(add(C, mul(u, r)), mul(nb, w))
      const farA = at(m1, A, -side * P.bore)
      const farB = at(m2, A, -side * P.bore)
      det.push(line(`M${pt(farA)} L${pt(farB)}`, 'tf'))
      const nearA = at(m1, A, side * P.bore)
      const nearB = at(m2, A, side * P.bore)
      const brA = Aof(2)
      const pb = perp(br)
      // 枝の左右の線のうち、メイン1(m1)側にある方
      const s1 = Math.sign(dot(pb, m1)) || 1
      const brM1 = add(add(C, mul(br, brA)), mul(pb, s1 * P.bore))
      const brM2 = add(add(C, mul(br, brA)), mul(pb, -s1 * P.bore))
      const xM1 = intersect(brM1, br, nearA, m1)
      const xM2 = intersect(brM2, br, nearA, m1)
      det.push(line(`M${pt(nearA)} L${pt(xM1)} L${pt(brM1)}`, 'tn1'))
      det.push(line(`M${pt(nearB)} L${pt(xM2)} L${pt(brM2)}`, 'tn2'))
    }
  }

  return (
    <g>
      {/* 外形: 太線で全部描いてから塗りで中を消すと、外周だけが残る */}
      <g className={lineCls}>
        {body.map((d, k) => (
          <path key={`s${k}`} d={d} strokeWidth={sw * 2} strokeLinejoin="round" className={`${lineCls} fa-fillline`} />
        ))}
      </g>
      {body.map((d, k) => (
        <path key={`f${k}`} d={d} className="fa-fill" />
      ))}
      {det}
    </g>
  )
}
