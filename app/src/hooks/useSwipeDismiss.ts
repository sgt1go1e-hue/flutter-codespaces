import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// 下からせり上がる面(テンキーなど)を、指で下へスライドして閉じるためのフック。
// つかんでいる間は指について下がり、離したときに一定以上下げていた(または
// 素早く下へはじいた)ら閉じる。足りなければ元の位置へ戻す。
// ボタンで閉じるときも dismiss() を呼べば、同じ下がるアニメーションで閉じる。

const CLOSE_DISTANCE = 70 // これ以上下げたら閉じる(px)
const CLOSE_VELOCITY = 0.5 // これより速く下へはじいたら閉じる(px/ms)
const CLOSE_MS = 180 // 下がりきるまでの時間(CSSのtransitionと合わせる)

export function useSwipeDismiss(onDismiss: () => void) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [closing, setClosing] = useState(false)
  const start = useRef<{ y: number; t: number; id: number } | null>(null)
  const last = useRef<{ y: number; t: number }>({ y: 0, t: 0 })

  function dismiss() {
    if (closing) return
    setClosing(true)
    window.setTimeout(onDismiss, CLOSE_MS)
  }

  const dragProps = {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (closing) return
      start.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId }
      last.current = { y: e.clientY, t: e.timeStamp }
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      if (!start.current || e.pointerId !== start.current.id) return
      last.current = { y: e.clientY, t: e.timeStamp }
      // 上へは動かさない(引っぱり上げても伸びない)
      setDragY(Math.max(0, e.clientY - start.current.y))
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      if (!start.current || e.pointerId !== start.current.id) return
      const dy = e.clientY - start.current.y
      const dt = Math.max(1, e.timeStamp - last.current.t)
      const v = (e.clientY - last.current.y) / dt
      start.current = null
      setDragging(false)
      if (dy > CLOSE_DISTANCE || (dy > 10 && v > CLOSE_VELOCITY)) dismiss()
      else setDragY(0)
    },
    onPointerCancel() {
      start.current = null
      setDragging(false)
      setDragY(0)
    },
  }

  const style = {
    transform: closing ? 'translateY(100%)' : dragY ? `translateY(${dragY}px)` : undefined,
    transition: dragging ? 'none' : `transform ${CLOSE_MS}ms ease-out`,
  }

  return { dragProps, style, dismiss }
}
