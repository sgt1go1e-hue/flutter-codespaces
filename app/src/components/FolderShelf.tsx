import { useMemo, useRef, useState } from 'react'
import type { DrawingMeta, FolderMeta } from '../lib/drawingStore'

interface Props {
  folders: FolderMeta[]
  drawings: DrawingMeta[]
  onOpenFolder: (folderId: string | null) => void
  onCreateFolder: () => void
  onRenameFolder: (id: string) => void
  onDeleteFolder: (id: string) => void
  onCreate: () => void
  onSupportDrawing: () => void
  onQuickCalc: () => void
  onNitrogenCalc: () => void
  onImportFile: (file: File) => void
  /** 設定メニュー用（既存の機能をホーム画面からも触れるようにするだけ）。 */
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenDisclaimer: () => void
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

// アプリを開いた直後に見せるホーム画面。現場・案件フォルダの棚に加えて、
// 新規作成・各ツールへの入口をまとめる（1階層のみ・サブフォルダなし）。
// 「未分類」も1つのフォルダ的な扱いで常に先頭に出す（新規作成した図面は
// 必ずここに入る）。フォルダをタップすると、その中の図面一覧
// (DrawingLauncher)へ遷移する。
export function FolderShelf({
  folders,
  drawings,
  onOpenFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onCreate,
  onSupportDrawing,
  onQuickCalc,
  onNitrogenCalc,
  onImportFile,
  theme,
  onToggleTheme,
  onOpenDisclaimer,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 開いているフォルダカードのメニュー(名前を変更/削除)のid。
  // 削除は不可逆なので、以前のようにカード脇へ出しっぱなしにせず
  // メニューの中へ入れて誤タップを防ぐ。
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [query, setQuery] = useState('')

  const unclassifiedUpdatedAt = drawings
    .filter((d) => d.folderId == null)
    .reduce((max, d) => Math.max(max, d.updatedAt), 0)

  // 検索は「フォルダの絞り込み」だけを行う（フォルダ名、またはその中の図面名に
  // 部分一致したフォルダを残す）。タップ先は従来どおりフォルダのままで、
  // 図面を直接開く新しい導線は増やさない。
  const q = query.trim().toLowerCase()
  const matchesFolder = useMemo(() => {
    if (!q) return null
    const hit = new Set<string>()
    for (const d of drawings) {
      if ((d.name ?? '').toLowerCase().includes(q) && d.folderId != null) hit.add(d.folderId)
    }
    return hit
  }, [q, drawings])
  const unclassifiedMatches =
    !q ||
    '未分類'.includes(query.trim()) ||
    drawings.some((d) => d.folderId == null && (d.name ?? '').toLowerCase().includes(q))

  const sortedFolders = [...folders]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((f) => !q || f.name.toLowerCase().includes(q) || matchesFolder?.has(f.id))

  const noResult = !!q && !unclassifiedMatches && sortedFolders.length === 0

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-header-row">
          <div className="home-brand-block">
            <h1 className="home-brand">アイソメ工房</h1>
            <p className="home-brand-sub">配管アイソメ図 ／ 芯引き自動計算</p>
          </div>
          <button
            type="button"
            className="home-gear"
            aria-label="設定"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            設定
          </button>
        </div>
        <input
          className="home-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="図面名・現場名でさがす"
          aria-label="図面名・現場名でさがす"
        />
        {settingsOpen && (
          <>
            <button
              type="button"
              className="home-menu-backdrop"
              aria-label="閉じる"
              onClick={() => setSettingsOpen(false)}
            />
            <div className="home-menu home-menu-settings" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSettingsOpen(false)
                  onToggleTheme()
                }}
              >
                {theme === 'dark' ? '明るい画面にする' : '暗い画面にする'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSettingsOpen(false)
                  onOpenDisclaimer()
                }}
              >
                免責事項を見る
              </button>
            </div>
          </>
        )}
      </header>

      <div className="home-body">
        <button type="button" className="home-cta" onClick={onCreate}>
          <span className="home-cta-badge" aria-hidden="true">
            ＋
          </span>
          <span className="home-cta-text">
            <span className="home-cta-title">新規作成</span>
            <span className="home-cta-sub">図面を描きはじめる</span>
          </span>
        </button>

        <div className="home-tools">
          <button type="button" className="home-tool" onClick={onQuickCalc}>
            <span className="home-tool-icon home-tool-icon-1" aria-hidden="true" />
            <span className="home-tool-title">クイック計算</span>
            <span className="home-tool-sub">芯引きをすぐ出す</span>
          </button>
          <button type="button" className="home-tool" onClick={onNitrogenCalc}>
            <span className="home-tool-icon home-tool-icon-2" aria-hidden="true" />
            <span className="home-tool-title">窒素計算</span>
            <span className="home-tool-sub">気密試験の必要量</span>
          </button>
          <button type="button" className="home-tool" onClick={onSupportDrawing}>
            <span className="home-tool-icon home-tool-icon-3" aria-hidden="true" />
            <span className="home-tool-title">サポート架台図面</span>
            <span className="home-tool-sub">吊り架台の図をつくる</span>
          </button>
        </div>

        <button
          type="button"
          className="home-import"
          onClick={() => fileInputRef.current?.click()}
        >
          共有ファイルを開く
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.pipeiso.json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onImportFile(file)
            e.target.value = ''
          }}
        />

        <div className="home-section-head">
          <span className="home-section-title">現場・案件フォルダ</span>
          <button type="button" className="home-folder-add" onClick={onCreateFolder}>
            ＋ フォルダ
          </button>
        </div>

        {noResult ? (
          <p className="home-empty">「{query.trim()}」に一致するフォルダはありません。</p>
        ) : (
          <div className="home-folder-grid">
            {unclassifiedMatches && (
              <div className="home-folder-card">
                <span className="home-folder-band" aria-hidden="true" />
                <button
                  type="button"
                  className="home-folder-main"
                  onClick={() => onOpenFolder(null)}
                >
                  <span className="home-folder-name">未分類</span>
                  <span className="home-folder-date">
                    {unclassifiedUpdatedAt ? formatDate(unclassifiedUpdatedAt) : '—'}
                  </span>
                </button>
              </div>
            )}
            {sortedFolders.map((f) => (
              <div className="home-folder-card" key={f.id}>
                <span className="home-folder-band" aria-hidden="true" />
                <button
                  type="button"
                  className="home-folder-main"
                  onClick={() => onOpenFolder(f.id)}
                >
                  <span className="home-folder-name">{f.name}</span>
                  <span className="home-folder-date">{formatDate(f.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  className="home-folder-menu-btn"
                  aria-label={`${f.name} のメニュー`}
                  onClick={() => setMenuFolderId((cur) => (cur === f.id ? null : f.id))}
                >
                  ⋯
                </button>
                {menuFolderId === f.id && (
                  <>
                    <button
                      type="button"
                      className="home-menu-backdrop"
                      aria-label="閉じる"
                      onClick={() => setMenuFolderId(null)}
                    />
                    <div className="home-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuFolderId(null)
                          onRenameFolder(f.id)
                        }}
                      >
                        名前を変更
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          setMenuFolderId(null)
                          onDeleteFolder(f.id)
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
