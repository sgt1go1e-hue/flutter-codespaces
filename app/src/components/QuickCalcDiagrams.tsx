// クイック計算の絵（芯引きの模式図・45°振りの模式図・引しろ表の継手図）。
// 寸法は実寸比ではなく、どこを測った数字なのかが一目で分かることを優先した模式図。
// 色はCSS(.qd-*)側で持ち、ダーク/ライトどちらでも読めるようにする。
import type { ReactNode } from 'react'
import type { QuickFittingKind } from '../lib/quickCalc'
import type { FittingShape } from '../lib/fittingTable'

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
function EndFitting({ kind, accent }: { kind: QuickFittingKind; accent: boolean }) {
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
  const wL = legOf(p.leftKind)
  const wR = legOf(p.rightKind)
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
        <EndFitting kind={p.leftKind} accent={p.selected === 'left'} />
      </g>
      <g transform={`translate(${XR} ${CY}) scale(-1 1)`}>
        <EndFitting kind={p.rightKind} accent={p.selected === 'right'} />
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
  sText: string
  cutText: string
  cutState: 'ok' | 'none' | 'bad'
  given: 'offset' | 'travel' | 'cut'
  onGiven: (g: 'offset' | 'travel' | 'cut') => void
}

export function OffsetDiagram(p: OffsetDiagramProps) {
  const P1 = { x: 96, y: 214 }
  const P2 = { x: 256, y: 54 }
  const leg = 30
  const r = leg / Math.tan(Math.PI / 8)
  // 下のエルボ: 水平の脚 → 斜めの脚
  const a1 = { x: P1.x - leg, y: P1.y }
  const b1 = { x: P1.x + leg * S45, y: P1.y - leg * S45 }
  // 上のエルボ: 斜めの脚 → 水平の脚
  const a2 = { x: P2.x - leg * S45, y: P2.y + leg * S45 }
  const b2 = { x: P2.x + leg, y: P2.y }
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
  const yA = 246
  return (
    <svg className="qd-svg" viewBox="0 0 360 262" role="img" aria-label="45°振りの図">
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

      {/* 管・エルボ */}
      <CenterLine d={`M 14 ${P1.y} L ${P1.x} ${P1.y} L ${P2.x} ${P2.y} L 346 ${P2.y}`} />
      <Tube d={`M 14 ${P1.y} L ${a1.x} ${a1.y}`} />
      <Tube d={`M ${b1.x} ${b1.y} L ${a2.x} ${a2.y}`} />
      <Tube d={`M ${b2.x} ${b2.y} L 346 ${P2.y}`} />
      <Tube d={`M ${a1.x} ${a1.y} A ${r} ${r} 0 0 0 ${b1.x} ${b1.y}`} accent />
      <Tube d={`M ${a2.x} ${a2.y} A ${r} ${r} 0 0 1 ${b2.x} ${b2.y}`} accent />
      <text x={P1.x + 22} y={P1.y + 4} className="qd-label-s" textAnchor="start" dominantBaseline="hanging">
        45° s1 {p.sText}
      </text>
      <text x={P2.x + 8} y={P2.y + 32} className="qd-label-s" textAnchor="start">
        s2 {p.sText}
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
}

function FigText({ x, y, children, anchor = 'middle' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} className="qd-fig-num" textAnchor={anchor}>
      {children}
    </text>
  )
}

export function FittingFigure({ shape, values }: FittingFigureProps) {
  const v = (i: number) => values[i] ?? '—'
  const T = 30 // 図の管の太さ
  const tube = (d: string, key?: string) => (
    <g key={key}>
      <path d={d} className="qd-tube-out" strokeWidth={T} />
      <path d={d} className="qd-tube-in" strokeWidth={T - 5} />
    </g>
  )
  switch (shape) {
    case 'elbow90': {
      const O = { x: 130, y: 62 }
      const A = 110
      return (
        <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label="90°エルボ">
          {tube(`M ${O.x} ${O.y + A} A ${A} ${A} 0 0 1 ${O.x + A} ${O.y}`)}
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
          {tube(`M ${E1.x} ${E1.y} A ${rr} ${rr} 0 0 0 ${E2.x} ${E2.y}`)}
          <CenterLine d={`M ${E1.x - 14} ${O.y} L ${O.x + 30} ${O.y} M ${O.x - 20 * S45} ${O.y + 20 * S45} L ${E2.x + 14 * S45} ${E2.y - 14 * S45}`} />
          <Ext x1={E1.x} y1={O.y + 20} x2={E1.x} y2={O.y + 44} />
          <Ext x1={O.x} y1={O.y + 8} x2={O.x} y2={O.y + 44} />
          <DimLine x1={E1.x} y1={O.y + 38} x2={O.x} y2={O.y + 38} className="qd-dim strong" />
          <FigText x={(E1.x + O.x) / 2} y={O.y + 32}>{v(0)}</FigText>
          <DimLine
            x1={O.x + 26 * S45}
            y1={O.y + 26 * S45}
            x2={E2.x + 26 * S45}
            y2={E2.y + 26 * S45}
            className="qd-dim strong"
          />
          <FigText x={(O.x + E2.x) / 2 + 46} y={(O.y + E2.y) / 2 + 30} anchor="start">{v(0)}</FigText>
          <text x={O.x + 40} y={O.y - 6} className="qd-label-s">45°</text>
        </svg>
      )
    }
    case 'tee': {
      const O = { x: 180, y: 80 }
      const A = 110
      return (
        <svg className="qd-svg qd-fig" viewBox="0 0 360 230" role="img" aria-label="チーズ">
          {tube(`M ${O.x - A} ${O.y} L ${O.x + A} ${O.y} M ${O.x} ${O.y} L ${O.x} ${O.y + A}`)}
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
