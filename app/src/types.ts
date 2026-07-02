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
  /**
   * 芯々寸法（この直線区間の中心〜中心の実寸, mm）。ユーザーが手入力する。
   * アイソメ図は非スケールのため、線のピクセル長ではなくこの値を寸法計算に使う。
   */
  centerLength?: number
  /** 始点側の継手（fittings.json の id） */
  startFitting?: string
  /** 終点側の継手（fittings.json の id） */
  endFitting?: string
  /** 接続方法（connections の id）。例: フランジ接合 'flange' */
  connection?: string
  /**
   * 始点側 / 終点側のフランジ。
   * 'double'（両フランジ・途中挿入の接続面）/ 'single'（片フランジ・ルート終端のエンド用）。
   * 両フランジは配置時に前後セグメントへ分割され、その接合ノードの両側に付く。
   */
  startFlange?: 'double' | 'single'
  endFlange?: 'double' | 'single'

  /**
   * 直接の親（上流）セグメントの id。属性継承に使う。
   * pipeType / size が未設定のときは親をたどって値を継承する。
   * 描画時に、始点が接続している既存セグメントを自動で親に設定する。
   */
  parentId?: string
}

// 図面全体の状態
export interface DrawingState {
  segments: Segment[]
  /** 選択中のセグメント id（未選択は null） */
  selectedId: string | null
}
