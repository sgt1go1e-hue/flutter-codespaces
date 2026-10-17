import { useEffect, useRef, useState } from 'react'

// ドラムロール式の選択（iPhoneの時刻選択のような回転式リスト）。
// 縦スクロール＋scroll-snapで1行ずつ止め、止まった行を選択値にする。
// 行を直接タップしても、その行まで回して選べる。

const ITEM = 40 // 1行の高さ(px)
const VISIBLE = 5 // 見えている行数（奇数。真ん中が選択行）
const PAD = ((VISIBLE - 1) / 2) * ITEM

export interface DrumItem<T extends string> {
  value: T
  label: string
}

export function DrumWheel<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: DrumItem<T>[]
  value: T | undefined
  onChange: (v: T) => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<number | undefined>(undefined)
  const [scrollTop, setScrollTop] = useState(0)
  const index = Math.max(
    0,
    items.findIndex((it) => it.value === value),
  )
  // 中身が変わった(管種を変えて接続やサイズの候補が変わった)ときも位置を合わせ直す
  const itemsKey = items.map((it) => it.value).join('|')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const target = index * ITEM
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target
    setScrollTop(el.scrollTop)
  }, [index, itemsKey])

  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  function handleScroll() {
    const el = ref.current
    if (!el) return
    setScrollTop(el.scrollTop)
    // 指を離して慣性スクロールが止まったところで確定する
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)))
      const picked = items[i]
      if (picked && picked.value !== value) onChange(picked.value)
    }, 140)
  }

  function tapItem(i: number) {
    ref.current?.scrollTo({ top: i * ITEM, behavior: 'smooth' })
  }

  return (
    <div className="drum">
      <div className="drum-label">{label}</div>
      <div className="drum-window" style={{ height: ITEM * VISIBLE }}>
        <div className="drum-band" style={{ top: PAD, height: ITEM }} />
        <div
          ref={ref}
          className="drum-scroll"
          onScroll={handleScroll}
          role="listbox"
          aria-label={label}
          style={{ paddingTop: PAD, paddingBottom: PAD }}
        >
          {items.map((it, i) => {
            // 真ん中からの距離(行数)に応じて傾け・薄くし、ドラムが回っているように見せる
            const d = (i * ITEM - scrollTop) / ITEM
            const a = Math.min(Math.abs(d), 2.6)
            return (
              <div
                key={it.value}
                role="option"
                aria-selected={i === index}
                className={`drum-item${Math.abs(d) < 0.5 ? ' center' : ''}`}
                style={{
                  height: ITEM,
                  opacity: 1 - a * 0.3,
                  transform: `rotateX(${Math.max(-60, Math.min(60, -d * 20))}deg)`,
                }}
                onClick={() => tapItem(i)}
              >
                {it.label}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
