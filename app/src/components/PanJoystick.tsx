import { useEffect, useRef, useState } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'

interface Props {
  view: { scale: number; tx: number; ty: number }
  onViewChange: (view: { scale: number; tx: number; ty: number }) => void
  /** 表示スケール係数（iPhone幅=1、広い画面ほど大きい。他のUI要素と同じ拡大率に揃える）。 */
  uiScale: number
}

// スマホゲームの移動スティックのように、押し込んだ方向・強さに応じて
// 画面を連続的にパン(移動)できるようにする常設コントローラー。二本指の
// ドラッグでもパンできる操作自体は変えず、その代わり・保険として追加する。
// 位置は画面下部の左隅を既定にし(ズームボタンは右隅にあるため衝突しない)、
// ダブルタップで「持ち上げ」→次のどこか1回のタップで「そこへ置く」操作で
// 好きな位置へ動かせる（動かした位置は端末に記憶する）。
const BASE_SIZE = 84 // 基準直径(px)。実際はuiScale倍。
const KNOB_MAX = 28 // スティックが中心から動ける最大距離(px, 基準値)。実際はuiScale倍。
const PAN_SPEED_MAX = 700 // 最大まで倒したときのパン速度(画面px/秒)。uiScaleに関係なく画面上の速さを揃える。
const DOUBLE_TAP_MS = 350

export function PanJoystick({ view, onViewChange, uiScale }: Props) {
  // rAFループの中で毎フレーム最新のviewを参照するため、propsの値をrefにも
  // 同期しておく(エフェクトの再セットアップなしに常に最新値を読めるように)。
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const [pos, setPos] = useLocalStorage<{ x: number; y: number } | null>(
    'piping-iso:panJoystickPos',
    null,
  )
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 })
  const [repositioning, setRepositioning] = useState(false)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const dirRef = useRef({ x: 0, y: 0, mag: 0 })
  const startClientRef = useRef({ x: 0, y: 0 })
  const lastTapRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const base = BASE_SIZE * uiScale
  const knobMax = KNOB_MAX * uiScale

  // 常時まわす移動ループ。ドラッグ中(draggingRef)だけ実際にviewを動かす。
  // マウント中ずっと1本のrAFループを回し続け、ドラッグの開始/終了のたびに
  // エフェクトを張り直さない(開始/終了のタイミングのズレで初速が飛ぶ事故を防ぐ)。
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    function step(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (draggingRef.current && dirRef.current.mag > 0.05) {
        const speed = PAN_SPEED_MAX * dirRef.current.mag
        const v = viewRef.current
        onViewChange({
          scale: v.scale,
          tx: v.tx + dirRef.current.x * speed * dt,
          ty: v.ty + dirRef.current.y * speed * dt,
        })
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [onViewChange])

  // ダブルタップ判定を1箇所にまとめる（ベース部分の直接タップと、スティックを
  // 動かさずタップだけした場合の両方から呼ぶ）。
  function registerTap() {
    const now = performance.now()
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0
      setRepositioning(true)
    } else {
      lastTapRef.current = now
    }
  }

  function handleKnobPointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    movedRef.current = false
    startClientRef.current = { x: e.clientX, y: e.clientY }
  }

  function handleKnobPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return
    e.stopPropagation()
    const dx = e.clientX - startClientRef.current.x
    const dy = e.clientY - startClientRef.current.y
    const dist = Math.hypot(dx, dy) || 1
    if (dist > 4) movedRef.current = true
    const clamped = Math.min(dist, knobMax)
    const nx = dx / dist
    const ny = dy / dist
    setKnobOffset({ x: nx * clamped, y: ny * clamped })
    dirRef.current = { x: nx, y: ny, mag: clamped / knobMax }
  }

  function handleKnobPointerUp(e: React.PointerEvent) {
    e.stopPropagation()
    draggingRef.current = false
    dirRef.current = { x: 0, y: 0, mag: 0 }
    setKnobOffset({ x: 0, y: 0 })
    // スティックを動かさずに離した(=ドラッグではなくタップ)場合も、
    // ベース部分をタップしたのと同じくダブルタップ判定に含める
    // (中央のスティックがベースの真ん中を覆っているため、そこを
    // ダブルタップされるケースの方が実際には多い)。
    if (!movedRef.current) registerTap()
  }

  // ベース部分(スティックの外側の輪)への直接タップも同じダブルタップ判定に含める。
  function handleBasePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    registerTap()
  }

  // 持ち上げ中(repositioning)は画面全体を覆う透明レイヤーでタップ位置を拾い、
  // そこへコントローラーの基準位置を移動して置く。既存のキャンバスの作図・
  // 選択操作に一切干渉しないよう、この間だけ最前面でタップを横取りする。
  function handlePlaceTap(e: React.PointerEvent) {
    e.stopPropagation()
    e.preventDefault()
    const stageEl = rootRef.current?.parentElement
    const rect = stageEl?.getBoundingClientRect()
    if (!rect) {
      setRepositioning(false)
      return
    }
    const margin = base / 2 + 6
    const x = Math.min(rect.width - margin, Math.max(margin, e.clientX - rect.left))
    const y = Math.min(rect.height - margin, Math.max(margin, e.clientY - rect.top))
    setPos({ x, y })
    setRepositioning(false)
  }

  // 既定位置は画面下部の左隅(ズームボタンは右隅のため衝突しない)。
  // 移動後(pos)はタップした位置がジョイスティックの中心になるようにする
  // (left/topは既定でボックスの左上端を指すため、中心合わせにはtranslateが要る)。
  // 既定位置はズームボタンと同じくleft/bottom基準の端合わせなのでtranslate不要。
  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }
    : { left: 10, bottom: 10 }

  return (
    <>
      {repositioning && (
        <div
          className="pan-joystick-place-overlay"
          onPointerDown={handlePlaceTap}
        >
          <span className="pan-joystick-place-hint">タップして置く場所を選んでください</span>
        </div>
      )}
      <div
        ref={rootRef}
        className={`pan-joystick${repositioning ? ' repositioning' : ''}`}
        style={{ ...style, width: base, height: base }}
        onPointerDown={handleBasePointerDown}
      >
        <div
          className="pan-joystick-knob"
          style={{
            width: base * 0.55,
            height: base * 0.55,
            marginLeft: (base * 0.55) / -2,
            marginTop: (base * 0.55) / -2,
            transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
          }}
          onPointerDown={handleKnobPointerDown}
          onPointerMove={handleKnobPointerMove}
          onPointerUp={handleKnobPointerUp}
          onPointerCancel={handleKnobPointerUp}
        />
      </div>
    </>
  )
}
