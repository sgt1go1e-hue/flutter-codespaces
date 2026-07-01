// アプリ全体で使う型定義

export interface Point {
  x: number
  y: number
}

// 配管セグメント（1本の直線区間）
// フェーズ2以降で管種・サイズ・継手などの属性を追加していく。
export interface Segment {
  id: string
  start: Point
  end: Point
  /** スナップ後のアイソメ角度（度）。0/30/90/150/210/270/330 のいずれか */
  angle: number

  // --- 以降はフェーズ2以降で使用する属性（フェーズ1では未設定） ---
  /** 管種コード（pipes.json の id） */
  pipeType?: string
  /** 呼び径（サイズコード） */
  size?: string
  /** 始点側の継手（fittings.json の id） */
  startFitting?: string
  /** 終点側の継手（fittings.json の id） */
  endFitting?: string
}

// 図面全体の状態
export interface DrawingState {
  segments: Segment[]
  /** 選択中のセグメント id（未選択は null） */
  selectedId: string | null
}
