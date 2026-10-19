// クイック計算の絵（芯引きの模式図・45°振りの模式図・引しろ表の継手図）。
// 寸法は実寸比ではなく、どこを測った数字なのかが一目で分かることを優先した模式図。
// 色はCSS(.qd-*)側で持ち、ダーク/ライトどちらでも読めるようにする。
import type { ReactNode } from 'react'
import type { QuickFittingKind } from '../lib/quickCalc'
import type { FittingShape } from '../lib/fittingTable'
import { FittingArt, artExtent, type Joint } from './FittingArt'

const TUBE = 16 // 管の太さ(px)
const LEG = 36 // 継手の脚の長さ(px)
const R45 = LEG / Math.tan(Math.PI / 8) // 45°エルボの曲げ半径（脚=LEGになる半径）
const S45 = Math.SQRT1_2

/** 外形線＋中抜きで「管」に見せる */
function Tube({ d, accent }: { d: string; accent?: boolean }) {
  return (
    <g>
      <path d={d} className={accent ? 'qd-tube-out accent' : 'qd-tube-out'} strokeWidth={TUBE} />
      <path d={d} className="qd-tube-in" strokeWidth={TUBE - 4} />
    </g>
  )
}

function CenterLine({ d }: { d: string }) {
  return <path d={d} className="qd-center" />
}

/** 寸法線の矢印(先端x,y・向きdx,dy) */
function Arrow({ x, y, dx, dy, className }: { x: number; y: number; dx: number; dy: number; className?: string }) {
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const s = 7
  const w = 3
  const p = `${x},${y} ${x - ux * s - uy * w},${y - uy * s + ux * w} ${x - ux * s + uy * w},${y - uy * s - ux * w}`
  return <polygon points={p} className={className ?? 'qd-arrow'} />
}

/** 2点間の寸法線（両端矢印）。短すぎる区間は矢印を省く */
function DimLine({
  x1,
  y1,
  x2,
  y2,
  className,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  className?: string
}) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  if (len < 1) return null
  const cls = className ?? 'qd-dim'
  const arrowCls = cls.replace('qd-dim', 'qd-arrow')
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className={cls} />
      {len > 16 && (
        <>
          <Arrow x={x1} y={y1} dx={x1 - x2} dy={y1 - y2} className={arrowCls} />
          <Arrow x={x2} y={y2} dx={x2 - x1} dy={y2 - y1} className={arrowCls} />
        </>
      )}
    </g>
  )
}

function Ext({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} className="qd-ext" />
}

// ---------------------------------------------------------------
// 芯引き（直管1本）の模式図
// ---------------------------------------------------------------

/** 端の継手が管に対して占める長さ(px)。フリー端は0 */
function legOf(kind: QuickFittingKind): number {
  if (kind === 'free') return 0
  if (kind === 'flange') return 8
  return LEG
}

/**
 * 1端分の継手を、継手の芯を原点・管が+x方向に伸びる向きで描く。
 * 右端は呼び出し側で左右反転して使う。
 */
const END_RO = 8 // 芯引きの図の管の外径の半分(px)

/**
 * 図の継手の脚の長さ(px)。実物の「引しろ:管の外径」の比にして、太く短い実物らしい形にする。
 * 寸法が分からないときは従来の長さ。小さすぎ・大きすぎは図が読めないので範囲に収める。
 */
export function artLeg(real: { a: number; od: number } | undefined, fallback: number, min = 12, max = 40): number {
  if (!real || real.a <= 0 || real.od <= 0) return fallback
  return Math.min(max, Math.max(min, END_RO * (real.a / (real.od / 2))))
}

function EndFitting({
  kind,
  accent,
  joint,
  leg = LEG,
}: {
  kind: QuickFittingKind
  accent: boolean
  joint?: Joint
  leg?: number
}) {
  // 接続方式が分かっていれば、エルボ・Tはカタログ風の線画で描く
  if (joint && kind !== 'free' && kind !== 'flange') {
    const legs =
      kind === 'elbow45'
        ? [{ x: 1, y: 0 }, { x: -S45, y: S45 }]
        : kind === 'tee'
          ? [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
          : kind === 'tee_branch'
            ? [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }]
            : [{ x: 1, y: 0 }, { x: 0, y: 1 }]
    return (
      <g>
        <FittingArt joint={joint} C={{ x: 0, y: 0 }} legs={legs} A={leg} ro={END_RO} sw={1.6} accent={accent} />
        <CenterLine d={kind === 'elbow45' ? `M -14 0 L ${leg} 0 M 10 -10 L ${-leg * S45 - 18} ${leg * S45 + 18}` : kind === 'tee_branch' ? `M 0 ${-leg - 18} L 0 ${leg + 18} M -14 0 L ${leg} 0` : `M 0 -14 L 0 ${leg + 26} M ${kind === 'tee' ? -leg - 18 : -14} 0 L ${leg} 0`} />
      </g>
    )
  }
  switch (kind) {
    case 'elbow90_long':
    case 'elbow90_short':
      return (
        <g>
          <Tube d={`M ${LEG} 0 A ${LEG} ${LEG} 0 0 0 0 ${LEG}`} accent={accent} />
          <CenterLine d={`M 0 -14 L 0 ${LEG + 24} M -14 0 L ${LEG} 0`} />
        </g>
      )
    case 'elbow45': {
      const ex = LEG - R45 * S45
      const ey = R45 - R45 * S45
      return (
        <g>
          <Tube d={`M ${LEG} 0 A ${R45} ${R45} 0 0 0 ${ex} ${ey}`} accent={accent} />
          <CenterLine d={`M -14 0 L ${LEG} 0 M 10 -10 L ${ex - 16} ${ey + 16}`} />
        </g>
      )
    }
    case 'tee':
      return (
        <g>
          <Tube d={`M ${-LEG} 0 L ${LEG} 0 M 0 0 L 0 ${LEG}`} accent={accent} />
          <CenterLine d={`M 0 -14 L 0 ${LEG + 20} M ${-LEG - 8} 0 L ${LEG} 0`} />
        </g>
      )
    case 'tee_branch':
      return (
        <g>
          <Tube d={`M 0 ${-LEG} L 0 ${LEG} M 0 0 L ${LEG} 0`} accent={accent} />
          <CenterLine d={`M 0 ${-LEG - 8} L 0 ${LEG + 8} M -14 0 L ${LEG} 0`} />
        </g>
      )
    case 'flange':
      return (
        <g>
          <rect x={-2} y={-26} width={10} height={52} className={accent ? 'qd-flange accent' : 'qd-flange'} />
          <line x1={-2} y1={-34} x2={-2} y2={34} className="qd-center" />
        </g>
      )
    default:
      return (
        <g>
          <line x1={0} y1={-14} x2={0} y2={14} className={accent ? 'qd-cutmark accent' : 'qd-cutmark'} />
        </g>
      )
  }
}

export interface StraightDiagramProps {
  leftKind: QuickFittingKind
  rightKind: QuickFittingKind
  leftFace: boolean
  /** 接続方式(継手の絵の描き分けに使う) */
  joint?: Joint
  /** 左右の継手の実寸(引しろ・管の外径 mm)。絵の太さの比に使う */
  leftReal?: { a: number; od: number }
  rightReal?: { a: number; od: number }
  rightFace: boolean
  selected: 'left' | 'right'
  onSelect: (end: 'left' | 'right') => void
  overallText: string
  s1Text: string
  s2Text: string
  cutText: string
  cutState: 'ok' | 'none' | 'bad'
  /** テンキーで入力している寸法（a=全体芯々 / L=切り寸） */
  field: 'a' | 'L'
  onField: (f: 'a' | 'L') => void
}

/** 寸法の数字を「入力欄」に見せる枠。入力中は実線、そうでなければ点線 */
function FieldBox({
  cx,
  cy,
  active,
  w = 164,
  rotate,
}: {
  cx: number
  cy: number
  active: boolean
  w?: number
  /** 文字と同じ角度に傾ける(度) */
  rotate?: number
}) {
  return (
    <rect
      transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined}
      x={cx - w / 2}
      y={cy - 21}
      width={w}
      height={28}
      rx={7}
      className={active ? 'qd-field active' : 'qd-field'}
    />
  )
}

export function StraightDiagram(p: StraightDiagramProps) {
  const CY = 124
  const XL = 50
  const XR = 310
  const artOn = (k: QuickFittingKind) => !!p.joint && k !== 'free' && k !== 'flange'
  const legL = artOn(p.leftKind) ? artLeg(p.leftReal, LEG) : LEG
  const legR = artOn(p.rightKind) ? artLeg(p.rightReal, LEG) : LEG
  const wL = artOn(p.leftKind) ? legL : legOf(p.leftKind)
  const wR = artOn(p.rightKind) ? legR : legOf(p.rightKind)
  const leftFace = p.leftKind === 'free' || p.leftFace
  const rightFace = p.rightKind === 'free' || p.rightFace
  const pipeL = XL + wL
  const pipeR = XR - wR
  const aL = leftFace ? pipeL : XL
  const aR = rightFace ? pipeR : XR
  const yA = 32
  const yS = 76
  return (
    <svg className="qd-svg" viewBox="0 0 360 200" role="img" aria-label="芯引きの図">
      {/* 寸法 a（全体・芯々） */}
      <Ext x1={aL} y1={yA - 8} x2={aL} y2={CY - 14} />
      <Ext x1={aR} y1={yA - 8} x2={aR} y2={CY - 14} />
      <DimLine x1={aL} y1={yA} x2={aR} y2={yA} className="qd-dim strong" />
      <FieldBox cx={(aL + aR) / 2} cy={yA - 8} active={p.field === 'a'} />
      <text x={(aL + aR) / 2} y={yA - 8} className="qd-label-a" textAnchor="middle">
        a　{p.overallText}
      </text>

      {/* 寸法 s1 / L / s2 */}
      <Ext x1={pipeL} y1={yS - 8} x2={pipeL} y2={CY - 12} />
      <Ext x1={pipeR} y1={yS - 8} x2={pipeR} y2={CY - 12} />
      <DimLine x1={aL} y1={yS} x2={pipeL} y2={yS} />
      <DimLine x1={pipeL} y1={yS} x2={pipeR} y2={yS} className="qd-dim cut" />
      <DimLine x1={pipeR} y1={yS} x2={aR} y2={yS} />
      <FieldBox cx={(pipeL + pipeR) / 2} cy={yS - 8} active={p.field === 'L'} />
      <text x={(pipeL + pipeR) / 2} y={yS - 8} className={`qd-label-cut ${p.cutState}`} textAnchor="middle">
        L　{p.cutText}
      </text>
      <text x={6} y={yS - 8} className="qd-label-s" textAnchor="start">
        s1 {p.s1Text}
      </text>
      <text x={354} y={yS - 8} className="qd-label-s" textAnchor="end">
        s2 {p.s2Text}
      </text>

      {/* 管 */}
      <CenterLine d={`M ${pipeL - 4} ${CY} L ${pipeR + 4} ${CY}`} />
      <Tube d={`M ${pipeL} ${CY} L ${pipeR} ${CY}`} />
      {p.leftKind === 'free' && <line x1={pipeL} y1={CY - 12} x2={pipeL} y2={CY + 12} className="qd-cutmark" />}
      {p.rightKind === 'free' && <line x1={pipeR} y1={CY - 12} x2={pipeR} y2={CY + 12} className="qd-cutmark" />}

      {/* 継手 */}
      <g transform={`translate(${XL} ${CY})`}>
        <EndFitting kind={p.leftKind} accent={p.selected === 'left'} joint={p.joint} leg={legL} />
      </g>
      <g transform={`translate(${XR} ${CY}) scale(-1 1)`}>
        <EndFitting kind={p.rightKind} accent={p.selected === 'right'} joint={p.joint} leg={legR} />
      </g>

      {/* 選択中の端の目印 */}
      <rect
        x={p.selected === 'left' ? 4 : 236}
        y={92}
        width={120}
        height={104}
        rx={12}
        className="qd-select-frame"
      />

      {/* 左右どちらかをタップして選ぶ */}
      <rect x={0} y={84} width={150} height={116} className="qd-hit" onPointerDown={() => p.onSelect('left')} />
      <rect x={210} y={84} width={150} height={116} className="qd-hit" onPointerDown={() => p.onSelect('right')} />

      {/* 寸法の数字をタップして、a と L のどちらを入力するか選ぶ */}
      <rect x={0} y={0} width={360} height={40} className="qd-hit" onPointerDown={() => p.onField('a')} />
      <rect x={70} y={42} width={220} height={40} className="qd-hit" onPointerDown={() => p.onField('L')} />
    </svg>
  )
}

// ---------------------------------------------------------------
// 45°振り（両端45°エルボのオフセット）の模式図
// ---------------------------------------------------------------

export interface OffsetDiagramProps {
  offsetText: string
  travelText: string
  /** 下側(s1)・上側(s2)の継手の控え */
  s1Text: string
  s2Text: string
  cutText: string
  cutState: 'ok' | 'none' | 'bad'
  /** 水平の長さ(45°エルボの端はツラ、立て管の端は芯まで) */
  faceText: string
  /** 接続方式(継手の絵の描き分けに使う) */
  joint?: Joint
  /** 下側・上側の継手の実寸(引しろ・管の外径 mm)。絵の太さの比に使う */
  real1?: { a: number; od: number }
  real2?: { a: number; od: number }
  /** 下側・上側が立て管の90°エルボか（平面で見て、立て管を丸で描く） */
  riser1: boolean
  riser2: boolean
  /** 継手をタップしたとき(45°エルボ⇔90°エルボの切り替えに使う) */
  onEnd?: (end: 1 | 2) => void
  given: 'offset' | 'travel' | 'cut'
  onGiven: (g: 'offset' | 'travel' | 'cut') => void
}

/**
 * 立て管の90°エルボを真上(真下)から見た形。立て管は丸、エルボの横の脚は斜め45°。
 * 外形は部品を重ねて太線→塗りの順で描き、外周の線だけを残す。
 */
function RiserElbow({ C, u, leg, ro }: { C: { x: number; y: number }; u: { x: number; y: number }; leg: number; ro: number }) {
  const h = ro * 1.3
  const n = { x: -u.y, y: u.x }
  const q = (r: number, w: number) => `${C.x + u.x * r + n.x * w},${C.y + u.y * r + n.y * w}`
  const rect = `M${q(0, -h)} L${q(leg, -h)} L${q(leg, h)} L${q(0, h)}Z`
  const circ = `M${C.x - h},${C.y} A${h},${h} 0 1 0 ${C.x + h},${C.y} A${h},${h} 0 1 0 ${C.x - h},${C.y}Z`
  return (
    <g>
      <path d={rect} className="fa-line accent fa-fillline accent" strokeWidth={3.2} />
      <path d={circ} className="fa-line accent fa-fillline accent" strokeWidth={3.2} />
      <path d={rect} className="fa-fill" />
      <path d={circ} className="fa-fill" />
      {/* 立て管(上下へ抜ける管)の内側 */}
      <circle cx={C.x} cy={C.y} r={ro * 0.75} className="fa-line accent" fill="none" strokeWidth={1} strokeDasharray="3 2" />
      <path d={`M${C.x - 4},${C.y - 4} L${C.x + 4},${C.y + 4} M${C.x - 4},${C.y + 4} L${C.x + 4},${C.y - 4}`} className="fa-line accent" strokeWidth={1} />
    </g>
  )
}

export function OffsetDiagram(p: OffsetDiagramProps) {
  const P1 = { x: 96, y: 214 }
  const P2 = { x: 256, y: 54 }
  const legOf = (real?: { a: number; od: number }) => (p.joint ? artLeg(real, 30, 12, 34) : 30)
  const leg1 = legOf(p.real1)
  const leg2 = legOf(p.real2)
  // 下の継手: 水平の脚(立て管なら無し) → 斜めの脚
  const a1 = { x: P1.x - leg1, y: P1.y }
  const b1 = { x: P1.x + leg1 * S45, y: P1.y - leg1 * S45 }
  // 上の継手: 斜めの脚 → 水平の脚(立て管なら無し)
  const a2 = { x: P2.x - leg2 * S45, y: P2.y + leg2 * S45 }
  const b2 = { x: P2.x + leg2, y: P2.y }
  // 水平の長さの端: 45°エルボはツラ、立て管は芯
  const f1 = p.riser1 ? P1.x : a1.x
  const f2 = p.riser2 ? P2.x : b2.x
  const faceLabel = p.riser1 && p.riser2 ? '芯〜芯' : p.riser1 || p.riser2 ? '芯〜ツラ' : 'ツラ〜ツラ'
  // 斜辺に直交する(左上向きの)ずらし
  const nx = -S45
  const ny = -S45
  const off = (pt: { x: number; y: number }, k: number) => ({ x: pt.x + nx * k, y: pt.y + ny * k })
  const c1 = off(P1, 58)
  const c2 = off(P2, 58)
  const l1 = off(b1, 30)
  const l2 = off(a2, 30)
  const mid = (u: { x: number; y: number }, v: { x: number; y: number }) => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 })
  const cm = off(mid(c1, c2), 10)
  const lm = off(mid(l1, l2), 10)
  const xB = 328
  const yA = 244
  const yF = 276
  const elbow45 = (C: { x: number; y: number }, legs: { x: number; y: number }[], leg: number) =>
    p.joint ? (
      <FittingArt joint={p.joint} C={C} legs={legs} A={leg} ro={END_RO} sw={1.6} accent />
    ) : null
  return (
    <svg className="qd-svg" viewBox="0 0 360 292" role="img" aria-label="45°振りの図">
      {/* 斜辺 c（芯々） */}
      <Ext x1={P1.x} y1={P1.y} x2={c1.x + nx * 6} y2={c1.y + ny * 6} />
      <Ext x1={P2.x} y1={P2.y} x2={c2.x + nx * 6} y2={c2.y + ny * 6} />
      <DimLine x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} className={p.given === 'travel' ? 'qd-dim strong' : 'qd-dim'} />
      <FieldBox cx={cm.x} cy={cm.y} w={136} rotate={-45} active={p.given === 'travel'} />
      <text
        x={cm.x}
        y={cm.y}
        className={p.given === 'travel' ? 'qd-label-a' : 'qd-label-s big'}
        textAnchor="middle"
        transform={`rotate(-45 ${cm.x} ${cm.y})`}
      >
        c　{p.travelText}
      </text>

      {/* 切り寸 L */}
      <Ext x1={b1.x} y1={b1.y} x2={l1.x + nx * 4} y2={l1.y + ny * 4} />
      <Ext x1={a2.x} y1={a2.y} x2={l2.x + nx * 4} y2={l2.y + ny * 4} />
      <DimLine x1={l1.x} y1={l1.y} x2={l2.x} y2={l2.y} className="qd-dim cut" />
      <FieldBox cx={lm.x} cy={lm.y} w={136} rotate={-45} active={p.given === 'cut'} />
      <text
        x={lm.x}
        y={lm.y}
        className={`qd-label-cut ${p.cutState}`}
        textAnchor="middle"
        transform={`rotate(-45 ${lm.x} ${lm.y})`}
      >
        L　{p.cutText}
      </text>

      {/* 管・継手 */}
      <CenterLine
        d={`M ${p.riser1 ? P1.x : 14} ${P1.y} L ${P1.x} ${P1.y} L ${P2.x} ${P2.y} L ${p.riser2 ? P2.x : 346} ${P2.y}`}
      />
      {!p.riser1 && <Tube d={`M 14 ${P1.y} L ${a1.x} ${a1.y}`} />}
      <Tube d={`M ${b1.x} ${b1.y} L ${a2.x} ${a2.y}`} />
      {!p.riser2 && <Tube d={`M ${b2.x} ${b2.y} L 346 ${P2.y}`} />}
      {p.riser1 ? (
        <RiserElbow C={P1} u={{ x: S45, y: -S45 }} leg={leg1} ro={END_RO} />
      ) : p.joint ? (
        elbow45(P1, [{ x: -1, y: 0 }, { x: S45, y: -S45 }], leg1)
      ) : (
        <Tube d={`M ${a1.x} ${a1.y} A ${leg1 / Math.tan(Math.PI / 8)} ${leg1 / Math.tan(Math.PI / 8)} 0 0 0 ${b1.x} ${b1.y}`} accent />
      )}
      {p.riser2 ? (
        <RiserElbow C={P2} u={{ x: -S45, y: S45 }} leg={leg2} ro={END_RO} />
      ) : p.joint ? (
        elbow45(P2, [{ x: -S45, y: S45 }, { x: 1, y: 0 }], leg2)
      ) : (
        <Tube d={`M ${a2.x} ${a2.y} A ${leg2 / Math.tan(Math.PI / 8)} ${leg2 / Math.tan(Math.PI / 8)} 0 0 1 ${b2.x} ${b2.y}`} accent />
      )}
      <text x={P1.x + 22} y={P1.y + 4} className="qd-label-s" textAnchor="start" dominantBaseline="hanging">
        {p.riser1 ? '立て90°' : '45°'} s1 {p.s1Text}
      </text>
      <text x={P2.x + 8} y={P2.y + 32} className="qd-label-s" textAnchor="start">
        {p.riser2 ? '立て90° ' : ''}s2 {p.s2Text}
      </text>

      {/* オフセット a・b（45°なので同じ値） */}
      <Ext x1={P2.x + 4} y1={P2.y} x2={xB + 8} y2={P2.y} />
      <Ext x1={P1.x + 10} y1={P1.y} x2={xB + 8} y2={P1.y} />
      <DimLine x1={xB} y1={P2.y} x2={xB} y2={P1.y} className={p.given === 'offset' ? 'qd-dim strong' : 'qd-dim'} />
      <FieldBox cx={xB - 56} cy={(P1.y + P2.y) / 2} w={104} active={p.given === 'offset'} />
      <text
        x={xB - 56}
        y={(P1.y + P2.y) / 2}
        className={p.given === 'offset' ? 'qd-label-a' : 'qd-label-s big'}
        textAnchor="middle"
      >
        b　{p.offsetText}
      </text>
      <Ext x1={P1.x} y1={P1.y + 10} x2={P1.x} y2={yA + 8} />
      <Ext x1={P2.x} y1={P2.y + 10} x2={P2.x} y2={yA + 8} />
      <DimLine x1={P1.x} y1={yA} x2={P2.x} y2={yA} className={p.given === 'offset' ? 'qd-dim strong' : 'qd-dim'} />
      <text x={(P1.x + P2.x) / 2} y={yA - 6} className="qd-label-s" textAnchor="middle">
        a = b
      </text>

      {/* 水平の長さ（45°エルボはツラ、立て管は芯まで） */}
      <Ext x1={f1} y1={P1.y + 12} x2={f1} y2={yF + 8} />
      <Ext x1={f2} y1={P2.y + 12} x2={f2} y2={yF + 8} />
      <DimLine x1={f1} y1={yF} x2={f2} y2={yF} className="qd-dim face" />
      <text x={(f1 + f2) / 2} y={yF - 6} className="qd-label-face" textAnchor="middle">
        {faceLabel}　{p.faceText}
      </text>

      {/* 継手をタップして 45°エルボ ⇔ 立て管の90°エルボ を切り替える */}
      {p.onEnd && (
        <>
          <circle cx={P1.x} cy={P1.y} r={26} className="qd-hit" onPointerDown={() => p.onEnd?.(1)} />
          <circle cx={P2.x} cy={P2.y} r={26} className="qd-hit" onPointerDown={() => p.onEnd?.(2)} />
        </>
      )}

      {/* 寸法の数字をタップして、b / c / L のどれを入力するか選ぶ */}
      <circle cx={xB - 56} cy={(P1.y + P2.y) / 2 - 8} r={44} className="qd-hit" onPointerDown={() => p.onGiven('offset')} />
      {/* c と L は斜めに近接して並ぶので、枠と同じ傾いた帯だけを当たり判定にする */}
      <rect
        transform={`rotate(-45 ${cm.x} ${cm.y})`}
        x={cm.x - 68}
        y={cm.y - 22}
        width={136}
        height={28}
        className="qd-hit"
        onPointerDown={() => p.onGiven('travel')}
      />
      <rect
        transform={`rotate(-45 ${lm.x} ${lm.y})`}
        x={lm.x - 68}
        y={lm.y - 22}
        width={136}
        height={28}
        className="qd-hit"
        onPointerDown={() => p.onGiven('cut')}
      />
    </svg>
  )
}

// ---------------------------------------------------------------
// 引しろ表の継手図
// ---------------------------------------------------------------

export interface FittingFigureProps {
  shape: FittingShape
  /** 図に書き込む数値（形ごとに並びが決まっている。dimRowsの順） */
  values: string[]
  /** 接続方式。エルボ・Tはこれでカタログ風の線画を描き分ける */
  joint?: Joint
  /** 実寸(mm)。引しろ(メイン/枝)と管の外径(メイン/枝)。あれば実物の太さの比で描く */
  mm?: { a: number; b?: number; od: number; bod?: number }
}

/**
 * エルボ・Tを、実物の「太さ:引しろ」の比のまま図の枠に収めて描く。
 * 寸法線は継手の外形のすぐ外に置く。
 */
function ArtFigure({
  shape,
  joint,
  mm,
  v,
}: {
  shape: 'elbow90' | 'elbow45' | 'tee'
  joint: Joint
  mm: { a: number; b?: number; od: number; bod?: number }
  v: (i: number) => string
}) {
  const ro = mm.od / 2
  const ext = artExtent(joint, mm.a, ro)
  const label = shape === 'tee' ? 'チーズ' : shape === 'elbow45' ? '45°エルボ' : '90°エルボ'
  if (shape === 'elbow90') {
    // 脚は下と右。左に縦の寸法、上に横の寸法の余白をとる
    const box = { x: 78, y: 48, w: 250, h: 172 }
    const span = ext.face + ext.hub
    const k = Math.min(box.w / span, box.h / span)
    const O = { x: box.x + ext.hub * k + (box.w - span * k) / 2, y: box.y + ext.hub * k }
    const A = mm.a * k
    const top = O.y - ext.hub * k - 12
    const left = O.x - ext.hub * k - 12
    return (
      <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label={label}>
        <FittingArt joint={joint} C={O} legs={[{ x: 0, y: 1 }, { x: 1, y: 0 }]} A={A} ro={ro * k} />
        <CenterLine d={`M ${O.x} ${O.y - ext.hub * k - 4} L ${O.x} ${O.y + ext.face * k + 8} M ${O.x - ext.hub * k - 4} ${O.y} L ${O.x + ext.face * k + 8} ${O.y}`} />
        <Ext x1={O.x} y1={O.y} x2={O.x} y2={top - 6} />
        <Ext x1={O.x + A} y1={O.y} x2={O.x + A} y2={top - 6} />
        <DimLine x1={O.x} y1={top} x2={O.x + A} y2={top} className="qd-dim strong" />
        <FigText x={O.x + A / 2} y={top - 7}>{v(0)}</FigText>
        <Ext x1={O.x} y1={O.y} x2={left - 6} y2={O.y} />
        <Ext x1={O.x} y1={O.y + A} x2={left - 6} y2={O.y + A} />
        <DimLine x1={left} y1={O.y} x2={left} y2={O.y + A} className="qd-dim strong" />
        <FigText x={left - 6} y={O.y + A / 2 + 8} anchor="end">{v(0)}</FigText>
      </svg>
    )
  }
  if (shape === 'elbow45') {
    // 脚は左と右上(45°)。下に横の寸法、右下に斜めの寸法の余白をとる
    const w = ext.face + ext.face * S45 + ext.hub * S45
    const h = ext.face * S45 + ext.hub * S45 + ext.hub
    const box = { x: 30, y: 24, w: 260, h: 150 }
    const k = Math.min(box.w / w, box.h / h)
    const O = { x: box.x + ext.face * k + (box.w - w * k) / 2, y: box.y + (ext.face * S45 + ext.hub * S45) * k }
    const A = mm.a * k
    const E1 = { x: O.x - A, y: O.y }
    const E2 = { x: O.x + A * S45, y: O.y - A * S45 }
    const below = O.y + ext.hub * k + 16
    const off = ext.hub * k + 16
    return (
      <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label={label}>
        <FittingArt joint={joint} C={O} legs={[{ x: -1, y: 0 }, { x: S45, y: -S45 }]} A={A} ro={ro * k} />
        <CenterLine d={`M ${O.x - ext.face * k - 8} ${O.y} L ${O.x + 20} ${O.y} M ${O.x - 16 * S45} ${O.y + 16 * S45} L ${O.x + (ext.face * k + 8) * S45} ${O.y - (ext.face * k + 8) * S45}`} />
        <Ext x1={E1.x} y1={O.y} x2={E1.x} y2={below + 6} />
        <Ext x1={O.x} y1={O.y} x2={O.x} y2={below + 6} />
        <DimLine x1={E1.x} y1={below} x2={O.x} y2={below} className="qd-dim strong" />
        <FigText x={(E1.x + O.x) / 2} y={below + 24}>{v(0)}</FigText>
        <Ext x1={O.x} y1={O.y} x2={O.x + (off + 6) * S45} y2={O.y + (off + 6) * S45} />
        <Ext x1={E2.x} y1={E2.y} x2={E2.x + (off + 6) * S45} y2={E2.y + (off + 6) * S45} />
        <DimLine x1={O.x + off * S45} y1={O.y + off * S45} x2={E2.x + off * S45} y2={E2.y + off * S45} className="qd-dim strong" />
        <FigText x={(O.x + E2.x) / 2 + (off + 12) * S45} y={(O.y + E2.y) / 2 + (off + 12) * S45 + 8} anchor="start">
          {v(0)}
        </FigText>
      </svg>
    )
  }
  // T: メインは左右、枝は下。上にメインの寸法、右に枝の寸法の余白をとる
  const bro = (mm.bod ?? mm.od) / 2
  const bext = artExtent(joint, mm.b ?? mm.a, bro)
  const w = ext.face * 2
  const h = ext.hub + bext.face
  const box = { x: 20, y: 46, w: 320, h: 172 }
  const k = Math.min(box.w / w, box.h / h)
  const O = { x: 180, y: box.y + ext.hub * k }
  const A = mm.a * k
  const B = (mm.b ?? mm.a) * k
  const top = O.y - ext.hub * k - 12
  const right = O.x + bext.hub * k + 14
  return (
    <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label={label}>
      <FittingArt
        joint={joint}
        C={O}
        legs={[{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]}
        A={A}
        ro={ro * k}
        branchA={B}
        branchRo={bro * k}
      />
      <CenterLine d={`M ${O.x - ext.face * k - 8} ${O.y} L ${O.x + ext.face * k + 8} ${O.y} M ${O.x} ${O.y - ext.hub * k - 4} L ${O.x} ${O.y + bext.face * k + 8}`} />
      <Ext x1={O.x} y1={O.y} x2={O.x} y2={top - 6} />
      <Ext x1={O.x + A} y1={O.y} x2={O.x + A} y2={top - 6} />
      <DimLine x1={O.x} y1={top} x2={O.x + A} y2={top} className="qd-dim strong" />
      <FigText x={O.x + A / 2} y={top - 7}>メイン {v(0)}</FigText>
      <Ext x1={O.x} y1={O.y + B} x2={right + 6} y2={O.y + B} />
      <DimLine x1={right} y1={O.y} x2={right} y2={O.y + B} className="qd-dim strong" />
      <FigText x={right + 6} y={O.y + B / 2 + 8} anchor="start">枝 {v(1)}</FigText>
    </svg>
  )
}

/** 引しろ表の図での管の外径の半分(px)。差込溶接は鍛造のかたまりらしく太めに */
function figRo(joint: Joint): number {
  return joint === 'socket' ? 22 : joint === 'buttweld' ? 16 : 18
}

function FigText({ x, y, children, anchor = 'middle' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} className="qd-fig-num" textAnchor={anchor}>
      {children}
    </text>
  )
}

export function FittingFigure({ shape, values, joint, mm }: FittingFigureProps) {
  const v = (i: number) => values[i] ?? '—'
  if (joint && mm && mm.a > 0 && mm.od > 0 && (shape === 'elbow90' || shape === 'elbow45' || shape === 'tee')) {
    return <ArtFigure shape={shape} joint={joint} mm={mm} v={v} />
  }
  const T = 30 // 図の管の太さ
  const tube = (d: string, key?: string) => (
    <g key={key}>
      <path d={d} className="qd-tube-out" strokeWidth={T} />
      <path d={d} className="qd-tube-in" strokeWidth={T - 5} />
    </g>
  )
  switch (shape) {
    case 'elbow90': {
      const O = { x: 130, y: joint ? 74 : 62 }
      const A = 110
      return (
        <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label="90°エルボ">
          {joint ? (
            <FittingArt joint={joint} C={O} legs={[{ x: 0, y: 1 }, { x: 1, y: 0 }]} A={A} ro={figRo(joint)} />
          ) : (
            tube(`M ${O.x} ${O.y + A} A ${A} ${A} 0 0 1 ${O.x + A} ${O.y}`)
          )}
          <CenterLine d={`M ${O.x} ${O.y + A + 14} L ${O.x} ${O.y - 14} M ${O.x - 14} ${O.y} L ${O.x + A + 14} ${O.y}`} />
          <Ext x1={O.x} y1={O.y - 10} x2={O.x} y2={18} />
          <Ext x1={O.x + A} y1={O.y - 20} x2={O.x + A} y2={18} />
          <DimLine x1={O.x} y1={26} x2={O.x + A} y2={26} className="qd-dim strong" />
          <FigText x={O.x + A / 2} y={20}>{v(0)}</FigText>
          <Ext x1={O.x - 10} y1={O.y} x2={52} y2={O.y} />
          <Ext x1={O.x - 20} y1={O.y + A} x2={52} y2={O.y + A} />
          <DimLine x1={60} y1={O.y} x2={60} y2={O.y + A} className="qd-dim strong" />
          <FigText x={52} y={O.y + A / 2 + 8} anchor="end">{v(0)}</FigText>
        </svg>
      )
    }
    case 'elbow45': {
      const O = { x: 170, y: 170 }
      const A = 100
      const rr = A / Math.tan(Math.PI / 8)
      const E1 = { x: O.x - A, y: O.y }
      const E2 = { x: O.x + A * S45, y: O.y - A * S45 }
      return (
        <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label="45°エルボ">
          {joint ? (
            <FittingArt joint={joint} C={O} legs={[{ x: -1, y: 0 }, { x: S45, y: -S45 }]} A={A} ro={figRo(joint)} />
          ) : (
            tube(`M ${E1.x} ${E1.y} A ${rr} ${rr} 0 0 0 ${E2.x} ${E2.y}`)
          )}
          <CenterLine d={`M ${E1.x - 14} ${O.y} L ${O.x + 30} ${O.y} M ${O.x - 20 * S45} ${O.y + 20 * S45} L ${E2.x + 14 * S45} ${E2.y - 14 * S45}`} />
          <Ext x1={E1.x} y1={O.y + 20} x2={E1.x} y2={O.y + 54} />
          <Ext x1={O.x} y1={O.y + 8} x2={O.x} y2={O.y + 54} />
          <DimLine x1={E1.x} y1={O.y + 48} x2={O.x} y2={O.y + 48} className="qd-dim strong" />
          <FigText x={(E1.x + O.x) / 2} y={O.y + 42}>{v(0)}</FigText>
          <DimLine
            x1={O.x + 40 * S45}
            y1={O.y + 40 * S45}
            x2={E2.x + 40 * S45}
            y2={E2.y + 40 * S45}
            className="qd-dim strong"
          />
          <FigText x={(O.x + E2.x) / 2 + 56} y={(O.y + E2.y) / 2 + 40} anchor="start">{v(0)}</FigText>
          <text x={O.x + 40} y={O.y - 6} className="qd-label-s">45°</text>
        </svg>
      )
    }
    case 'tee': {
      const O = { x: 180, y: 80 }
      const A = 110
      return (
        <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label="チーズ">
          {joint ? (
            <FittingArt
              joint={joint}
              C={O}
              legs={[{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]}
              A={A}
              ro={figRo(joint)}
            />
          ) : (
            tube(`M ${O.x - A} ${O.y} L ${O.x + A} ${O.y} M ${O.x} ${O.y} L ${O.x} ${O.y + A}`)
          )}
          <CenterLine d={`M ${O.x - A - 14} ${O.y} L ${O.x + A + 14} ${O.y} M ${O.x} ${O.y - 30} L ${O.x} ${O.y + A + 14}`} />
          <Ext x1={O.x} y1={O.y - 24} x2={O.x} y2={14} />
          <Ext x1={O.x + A} y1={O.y - 20} x2={O.x + A} y2={14} />
          <DimLine x1={O.x} y1={22} x2={O.x + A} y2={22} className="qd-dim strong" />
          <FigText x={O.x + A / 2} y={16}>メイン {v(0)}</FigText>
          <Ext x1={O.x + 20} y1={O.y + A} x2={O.x + 74} y2={O.y + A} />
          <Ext x1={O.x + 10} y1={O.y} x2={O.x + 74} y2={O.y} />
          <DimLine x1={O.x + 66} y1={O.y} x2={O.x + 66} y2={O.y + A} className="qd-dim strong" />
          <FigText x={O.x + 76} y={O.y + A / 2 + 30} anchor="start">枝 {v(1)}</FigText>
        </svg>
      )
    }
    case 'wye45':
    case 'wye90': {
      const O = { x: 190, y: 150 }
      const far = 130
      const near = 90
      const br = 120
      const is45 = shape === 'wye45'
      // 枝: 45°Yは上流側(左上)へ斜め、90°大曲りYは真上へ
      const B = is45 ? { x: O.x - br * S45, y: O.y - br * S45 } : { x: O.x, y: O.y - br }
      return (
        <svg className="qd-svg qd-fig" viewBox="0 0 360 236" role="img" aria-label="Y継手">
          {tube(`M ${O.x - far} ${O.y} L ${O.x + near} ${O.y} M ${O.x} ${O.y} L ${B.x} ${B.y}`)}
          <CenterLine d={`M ${O.x - far - 12} ${O.y} L ${O.x + near + 12} ${O.y} M ${O.x} ${O.y} L ${B.x + (B.x - O.x) * 0.12} ${B.y + (B.y - O.y) * 0.12}`} />
          <Ext x1={O.x - far} y1={O.y + 20} x2={O.x - far} y2={O.y + 72} />
          <Ext x1={O.x} y1={O.y + 6} x2={O.x} y2={O.y + 72} />
          <Ext x1={O.x + near} y1={O.y + 20} x2={O.x + near} y2={O.y + 72} />
          <DimLine x1={O.x - far} y1={O.y + 66} x2={O.x} y2={O.y + 66} className="qd-dim strong" />
          <DimLine x1={O.x} y1={O.y + 66} x2={O.x + near} y2={O.y + 66} className="qd-dim strong" />
          <FigText x={O.x - far / 2} y={O.y + 58}>上流 {v(1)}</FigText>
          <FigText x={O.x + near / 2} y={O.y + 58}>下流 {v(0)}</FigText>
          <FigText x={is45 ? B.x - 8 : B.x + 26} y={is45 ? B.y + 4 : B.y + 24} anchor={is45 ? 'end' : 'start'}>
            枝 {v(2)}
          </FigText>
          <text x={O.x + near + 10} y={O.y - 22} className="qd-label-s" textAnchor="end">流れ →</text>
        </svg>
      )
    }
    case 'cap':
      return (
        <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label="キャップ">
          <path d="M 120 70 L 190 70 A 70 50 0 0 1 190 170 L 120 170 Z" className="qd-solid" />
          <CenterLine d="M 100 120 L 280 120" />
          <Ext x1={120} y1={64} x2={120} y2={30} />
          <Ext x1={260} y1={110} x2={260} y2={30} />
          <DimLine x1={120} y1={38} x2={260} y2={38} className="qd-dim strong" />
          <FigText x={190} y={32}>{v(0)}</FigText>
        </svg>
      )
    default:
      return (
        <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label="レジューサー">
          <path d="M 100 70 L 140 70 L 220 100 L 260 100 L 260 160 L 220 160 L 140 190 L 100 190 Z" className="qd-solid" />
          <CenterLine d="M 80 130 L 280 130" />
          <Ext x1={100} y1={64} x2={100} y2={30} />
          <Ext x1={260} y1={94} x2={260} y2={30} />
          <DimLine x1={100} y1={38} x2={260} y2={38} className="qd-dim strong" />
          <FigText x={180} y={32}>H {v(0)}</FigText>
          <text x={96} y={212} className="qd-label-s" textAnchor="start">大径側</text>
          <text x={264} y={212} className="qd-label-s" textAnchor="end">小径側</text>
        </svg>
      )
  }
}
