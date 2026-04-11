import { useEffect, useState } from 'react'
import type { AtriumConfig, LaunchAction, DetectedTools } from '../../../shared/types'

interface Props {
  onClose: () => void
  onSave: () => void
  onRerunSetup: () => void
}

type Preset = 'editor-only' | 'terminal-tmux' | 'editor-and-terminal' | 'terminal-cmd'

const PRESET_LABELS: Record<Preset, string> = {
  'editor-only': 'Editor only',
  'terminal-tmux': 'Terminal + tmux',
  'editor-and-terminal': 'Editor + Terminal',
  'terminal-cmd': 'Terminal + command'
}

function detectPreset(profile: LaunchAction[]): Preset {
  const types = profile.map((a) => a.type)
  if (types.length === 1 && types[0] === 'editor') return 'editor-only'
  if (types.length === 1 && types[0] === 'terminal-tmux') return 'terminal-tmux'
  if (types.length === 1 && types[0] === 'terminal-cmd') return 'terminal-cmd'
  if (types.includes('editor') && types.includes('terminal-tmux')) return 'editor-and-terminal'
  return 'terminal-tmux'
}

function findAction<T extends LaunchAction['type']>(profile: LaunchAction[], type: T) {
  return profile.find((a) => a.type === type) as Extract<LaunchAction, { type: T }> | undefined
}

export function SettingsModal({ onClose, onSave, onRerunSetup }: Props) {
  const [config, setConfig] = useState<AtriumConfig | null>(null)
  const [tools, setTools] = useState<DetectedTools | null>(null)
  const [rootDir, setRootDir] = useState('')
  const [preset, setPreset] = useState<Preset>('terminal-tmux')
  const [editorApp, setEditorApp] = useState<'cursor' | 'code'>('cursor')
  const [terminalApp, setTerminalApp] = useState<'ghostty' | 'iterm' | 'terminal' | 'warp'>('ghostty')
  const [customCmd, setCustomCmd] = useState('claude --resume')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.config.get().then((c) => {
      setConfig(c)
      setRootDir(c.rootDir ?? '')
      const profile = c.launchProfile ?? []
      setPreset(detectPreset(profile))
      const editorAction = findAction(profile, 'editor')
      if (editorAction) setEditorApp(editorAction.app)
      const tmuxAction = findAction(profile, 'terminal-tmux')
      const cmdAction = findAction(profile, 'terminal-cmd')
      if (tmuxAction) setTerminalApp(tmuxAction.app)
      else if (cmdAction) { setTerminalApp(cmdAction.app); setCustomCmd(cmdAction.command) }
    })
    window.api.setup.detect().then(setTools)
  }, [])

  function buildProfile(): LaunchAction[] {
    switch (preset) {
      case 'editor-only': return [{ type: 'editor', app: editorApp }]
      case 'terminal-tmux': return [{ type: 'terminal-tmux', app: terminalApp }]
      case 'editor-and-terminal': return [{ type: 'editor', app: editorApp }, { type: 'terminal-tmux', app: terminalApp }]
      case 'terminal-cmd': return [{ type: 'terminal-cmd', app: terminalApp, command: customCmd }]
    }
  }

  async function handleSave() {
    setSaving(true)
    await window.api.config.set({
      rootDir: rootDir.trim() || undefined,
      launchProfile: buildProfile()
    })
    setSaving(false)
    onSave()
    onClose()
  }

  if (!config) return null

  const needsEditor = preset === 'editor-only' || preset === 'editor-and-terminal'
  const needsTerminal = preset !== 'editor-only'

  const editorOptions = [
    { value: 'cursor' as const, label: 'Cursor', installed: tools?.editors.cursor.installed ?? false },
    { value: 'code' as const, label: 'VS Code', installed: tools?.editors.code.installed ?? false }
  ]
  const terminalOptions = [
    { value: 'ghostty' as const, label: 'Ghostty', installed: tools?.terminals.ghostty.installed ?? false },
    { value: 'iterm' as const, label: 'iTerm', installed: tools?.terminals.iterm.installed ?? false },
    { value: 'warp' as const, label: 'Warp', installed: tools?.terminals.warp.installed ?? false },
    { value: 'terminal' as const, label: 'Terminal.app', installed: tools?.terminals.terminal.installed ?? false }
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-title">Settings</div>

        <div className="form-group">
          <label className="form-label">Root directory</label>
          <input
            className="form-input"
            value={rootDir}
            onChange={(e) => setRootDir(e.target.value)}
            placeholder="~/your-project-directory"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Launch profile</label>
          <div className="setup-inline-options">
            {(Object.entries(PRESET_LABELS) as [Preset, string][]).map(([key, label]) => (
              <button
                key={key}
                className={`setup-chip${preset === key ? ' active' : ''}`}
                onClick={() => setPreset(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {needsEditor && (
          <div className="form-group">
            <label className="form-label">Editor</label>
            <div className="setup-inline-options">
              {editorOptions.map((opt) => (
                <button
                  key={opt.value}
                  className={`setup-chip${editorApp === opt.value ? ' active' : ''}${!opt.installed ? ' disabled' : ''}`}
                  onClick={() => setEditorApp(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {needsTerminal && (
          <div className="form-group">
            <label className="form-label">Terminal</label>
            <div className="setup-inline-options">
              {terminalOptions.map((opt) => (
                <button
                  key={opt.value}
                  className={`setup-chip${terminalApp === opt.value ? ' active' : ''}${!opt.installed ? ' disabled' : ''}`}
                  onClick={() => setTerminalApp(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {preset === 'terminal-cmd' && (
          <div className="form-group">
            <label className="form-label">Command</label>
            <input
              className="form-input"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              placeholder="claude --resume"
            />
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
