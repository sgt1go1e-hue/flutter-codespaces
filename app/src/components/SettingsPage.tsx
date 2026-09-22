import {
  FEATURE_LABELS,
  FEATURE_ORDER,
  type EnabledFeatures,
  type FeatureId,
} from '../lib/featureToggles'

interface Props {
  enabled: EnabledFeatures
  onChange: (next: EnabledFeatures) => void
  onClose: () => void
}

// 設定画面。今のところ中身は「仕様のオンオフ」だけ（今後、他の設定項目が
// 増えたらここにセクションを足していく想定）。
export function SettingsPage({ enabled, onChange, onClose }: Props) {
  function toggle(id: FeatureId) {
    onChange({ ...enabled, [id]: !enabled[id] })
  }

  return (
    <div className="qc-screen">
      <header className="topbar">
        <div className="title">設定</div>
        <div className="tools">
          <button onClick={onClose}>戻る</button>
        </div>
      </header>

      <div className="qc-body">
        <div className="field">
          <span className="field-label">仕様のオンオフ</span>
          <p className="field-note">
            使わない機能はオフにすると、ホーム画面から見えなくなります。データや計算結果には影響せず、いつでもここでオンに戻せます。
          </p>
          <div className="settings-feature-list">
            {FEATURE_ORDER.map((id) => (
              <label key={id} className="settings-feature-row">
                <span className="settings-feature-text">
                  <span className="settings-feature-title">{FEATURE_LABELS[id].title}</span>
                  <span className="settings-feature-sub">{FEATURE_LABELS[id].sub}</span>
                </span>
                <input type="checkbox" checked={enabled[id]} onChange={() => toggle(id)} />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
