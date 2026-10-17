import { useEffect, useState } from 'react'

/**
 * state を localStorage に自動保存する useState 互換フック。
 * 図面（セグメント配列）の永続化に使用する。
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 保存失敗（容量超過など）は無視する
    }
  }, [key, value])

  return [value, setValue]
}
