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
  /**
   * この区間の継手種類（fittings.json の id）。始点・終点で別々には持たず1つに統合。
   * 未設定なら継承ロジックと同様、分岐箇所は 'tee_equal'・それ以外は 'elbow90_long'(ロング標準) を実効値とする。
   */
  fitting?: string
  /**
   * レジューサー/径違いチーズの「相手径」呼び径コード。
   * 自分の size と合わせて大径_小径を決め、全長や芯ズレ計算に使う。
   */
  reducerSize?: string
  /** 偏心レジューサーの合わせ面。'top'=上面合わせ / 'bottom'=下面合わせ。必須選択。 */
  reducerAlign?: 'top' | 'bottom'
  /**
   * レジューサーの面間寸法(H, mm)の手入力値。reducerLengths.ts のマスタ表に
   * 無いサイズ組み合わせのときだけ使う(手入力ダイアログで設定)。マスタに
   * 値があるときはこちらは無視され、常にマスタの値を優先する。
   */
  reducerLengthOverride?: number
  /** 接続方法（connections の id）。例: フランジ接合 'flange' */
  connection?: string
  /**
   * 塩ビ(VP)の継手シリーズ。'dv'=DV継手（排水用・勾配考慮が必要）/
   * 'ts'=TS継手（給水用）。管種がVPのときのみ意味を持つ。
   */
  vpSeries?: 'dv' | 'ts'
  /**
   * 排水勾配の分母(例: 100 なら「1/100勾配」)。SGP管またはVP+DV継手の
   * 区間にのみ設定できる。この区間の芯々寸法から生じる高低差
   * (centerLength / slopeDenom)を、上流側に隣接する縦区間(90°/270°)の
   * 寸法から自動的に差し引く（勾配で下がった分、縦区間が短くなる）。
   */
  slopeDenom?: number
  /**
   * フリー端(未接続の端)の基準高さ(mm)。任意の基準面(FL等)からの相対値。
   * 配管ルートの始点・終点(スタート/ゴール)に入力しておくと、実際のルートを
   * (縦区間の芯々寸法＋勾配による高低差で)たどって求めた高低差と一致するかを
   * 確認できる。二段階に分けて配管を落としても、この2点の高さだけは
   * 絶対に変えられないという制約の検算用の指標。接続済みの端では意味を持たない。
   */
  startRefElevation?: number
  endRefElevation?: number
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
