import { useEffect, useState } from 'react'
import type { DetectedTools, LaunchAction, ToolStatus } from '../../../shared/types'

interface Props {
  onComplete: () => void
}

type Step = 'root' | 'gh' | 'workspace' | 'done'
const STEPS: Step[] = ['root', 'gh', 'workspace', 'done']

type Preset = 'editor-only' | 'terminal-tmux' | 'editor-and-terminal' | 'terminal-cmd'

const PRESET_INFO: Record<Preset, { label: string; desc: string }> = {
  'editor-only': { label: 'Editor only', desc: 'Open your editor at the worktree' },
  'terminal-tmux': { label: 'Terminal + tmux', desc: 'tmux session with nvim, claude, and shell panes' },
  'editor-and-terminal': { label: 'Editor + Terminal', desc: 'Both your editor and a tmux terminal session' },
  'terminal-cmd': { label: 'Terminal + command', desc: 'Run a custom command in a terminal' }
}

function StatusIcon({ status }: { status: ToolStatus }) {
  if (!status.installed) return <span className="setup-icon setup-icon-missing">✗</span>
  if (status.authenticated === false) return <span className="setup-icon setup-icon-warn">!</span>
  return <span className="setup-icon setup-icon-ok">✓</span>
}

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('root')
  const [tools, setTools] = useState<DetectedTools | null>(null)
  const [detecting, setDetecting] = useState(false)

  const [rootDir, setRootDir] = useState('')
  const [ghPath, setGhPath] = useState('')
  const [preset, setPreset] = useState<Preset>('terminal-tmux')
  const [editorApp, setEditorApp] = useState<'cursor' | 'code'>('cursor')
  const [terminalApp, setTerminalApp] = useState<'ghostty' | 'iterm' | 'terminal' | 'warp'>('ghostty')
  const [customCmd, setCustomCmd] = useState('claude --resume')

  async function runDetect() {
    setDetecting(true)
    const d = await window.api.setup.detect()
    setTools(d)
    setDetecting(false)

    if (d.gh.path) setGhPath(d.gh.path)
    if (d.editors.cursor.installed) setEditorApp('cursor')
    else if (d.editors.code.installed) setEditorApp('code')
    if (d.terminals.ghostty.installed) setTerminalApp('ghostty')
    else if (d.terminals.iterm.installed) setTerminalApp('iterm')
    else if (d.terminals.warp.installed) setTerminalApp('warp')
    else setTerminalApp('terminal')
  }

  useEffect(() => { runDetect() }, [])

  const stepIdx = STEPS.indexOf(step)
  function next() { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]) }
  function back() { if (stepIdx > 0) setStep(STEPS[stepIdx - 1]) }

  function buildProfile(): LaunchAction[] {
    switch (preset) {
      case 'editor-only':
        return [{ type: 'editor', app: editorApp }]
      case 'terminal-tmux':
        return [{ type: 'terminal-tmux', app: terminalApp }]
      case 'editor-and-terminal':
        return [{ type: 'editor', app: editorApp }, { type: 'terminal-tmux', app: terminalApp }]
      case 'terminal-cmd':
        return [{ type: 'terminal-cmd', app: terminalApp, command: customCmd }]
    }
  }

  async function finish() {
    await window.api.config.set({
      rootDir: rootDir.trim() || undefined,
      ghPath: ghPath || '/opt/homebrew/bin/gh',
      launchProfile: buildProfile(),
      setupComplete: true
    })
    onComplete()
  }

  const editorOptions = tools ? [
    { value: 'cursor' as const, label: 'Cursor', installed: tools.editors.cursor.installed },
    { value: 'code' as const, label: 'VS Code', installed: tools.editors.code.installed }
  ] : []

  const terminalOptions = tools ? [
    { value: 'ghostty' as const, label: 'Ghostty', installed: tools.terminals.ghostty.installed },
    { value: 'iterm' as const, label: 'iTerm', installed: tools.terminals.iterm.installed },
    { value: 'warp' as const, label: 'Warp', installed: tools.terminals.warp.installed },
    { value: 'terminal' as const, label: 'Terminal.app', installed: tools.terminals.terminal.installed }
  ] : []

  const needsEditor = preset === 'editor-only' || preset === 'editor-and-terminal'
  const needsTerminal = preset !== 'editor-only'

  return (
    <div className="setup-overlay">
      <div className="setup-wizard">
        <div className="setup-header">
          <h1 className="setup-title">Welcome to Atrium</h1>
          <div className="setup-steps">
            {STEPS.map((s, i) => (
              <div key={s} className={`setup-step-dot${i <= stepIdx ? ' active' : ''}`} />
            ))}
          </div>
        </div>

        <div className="setup-body">
          {/* ── Root Directory ──────────────────────────── */}
          {step === 'root' && (
            <div className="setup-section">
              <h2 className="setup-subtitle">Where do your repos live?</h2>
              <p className="setup-desc">
                Atrium scans this directory for git repos to scope your PR dashboard.
              </p>
              <input
                className="form-input"
                value={rootDir}
                onChange={(e) => setRootDir(e.target.value)}
                placeholder="~/your-project-directory"
                autoFocus
              />
            </div>
          )}

          {/* ── GitHub CLI ──────────────────────────────── */}
          {step === 'gh' && tools && (
            <div className="setup-section">
              <h2 className="setup-subtitle">Tools</h2>

              <div className="setup-tool-card">
                <StatusIcon status={tools.gh} />
                <div className="setup-tool-info">
                  <span className="setup-tool-name">{tools.gh.installed ? 'GitHub CLI' : 'GitHub CLI not found'}</span>
                  {tools.gh.path && <code className="setup-tool-path">{tools.gh.path}</code>}
                </div>
              </div>
              {!tools.gh.installed && (
                <div className="setup-action-box">
                  <p>Install:</p>
                  <code className="setup-command">brew install gh</code>
                  <button className="btn btn-ghost" onClick={runDetect} disabled={detecting}>
                    {detecting ? 'Checking…' : 'Re-check'}
                  </button>
                </div>
              )}
              {tools.gh.installed && !tools.gh.authenticated && (
                <div className="setup-action-box">
                  <p>Authenticate:</p>
                  <code className="setup-command">gh auth login</code>
                  <button className="btn btn-ghost" onClick={runDetect} disabled={detecting}>
                    {detecting ? 'Checking…' : 'Re-check'}
                  </button>
                </div>
              )}
              {tools.gh.installed && tools.gh.authenticated && (
                <div className="setup-action-box setup-action-success">
                  Authenticated{tools.gh.username ? ` as ${tools.gh.username}` : ''}
                </div>
              )}

              <div className="setup-tool-card">
                <StatusIcon status={tools.claude} />
                <div className="setup-tool-info">
                  <span className="setup-tool-name">{tools.claude.installed ? 'Claude Code' : 'Claude Code not found'}</span>
                  {tools.claude.version && <code className="setup-tool-path">{tools.claude.version}</code>}
                </div>
              </div>
              {!tools.claude.installed && (
                <div className="setup-action-box">
                  <p>Install:</p>
                  <code className="setup-command">npm install -g @anthropic-ai/claude-code</code>
                  <button className="btn btn-ghost" onClick={runDetect} disabled={detecting}>
                    {detecting ? 'Checking…' : 'Re-check'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Workspace Launch ────────────────────────── */}
          {step === 'workspace' && tools && (
            <div className="setup-section">
              <h2 className="setup-subtitle">What should Launch do?</h2>
              <p className="setup-desc">Choose what opens when you launch a workspace.</p>

              <div className="setup-radio-group">
                {(Object.entries(PRESET_INFO) as [Preset, typeof PRESET_INFO[Preset]][]).map(([key, info]) => (
                  <label key={key} className={`setup-radio${preset === key ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="preset"
                      checked={preset === key}
                      onChange={() => setPreset(key)}
                    />
                    <div>
                      <span className="setup-radio-label">{info.label}</span>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{info.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* App selectors based on preset */}
              <div className="setup-app-selectors">
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
                          {!opt.installed && <span className="setup-chip-note">not found</span>}
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
                          {!opt.installed && <span className="setup-chip-note">not found</span>}
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
              </div>
            </div>
          )}

          {/* ── Done ───────────────────────────────────── */}
          {step === 'done' && (
            <div className="setup-section">
              <h2 className="setup-subtitle">All set</h2>
              <div className="setup-summary">
                <div className="setup-summary-row">
                  <span className="setup-summary-label">Root directory</span>
                  <code>{rootDir || '(not set)'}</code>
                </div>
                <div className="setup-summary-row">
                  <span className="setup-summary-label">Launch profile</span>
                  <span>{PRESET_INFO[preset].label}</span>
                </div>
                {needsEditor && (
                  <div className="setup-summary-row">
                    <span className="setup-summary-label">Editor</span>
                    <span>{editorApp}</span>
                  </div>
                )}
                {needsTerminal && (
                  <div className="setup-summary-row">
                    <span className="setup-summary-label">Terminal</span>
                    <span>{terminalApp}</span>
                  </div>
                )}
              </div>
              <p className="setup-desc" style={{ marginTop: 16 }}>
                You can change these anytime in Settings.
              </p>
            </div>
          )}
        </div>

        <div className="setup-footer">
          {stepIdx > 0 && step !== 'done' && (
            <button className="btn btn-ghost" onClick={back}>Back</button>
          )}
          <div style={{ flex: 1 }} />
          {step !== 'done' ? (
            <button className="btn btn-primary" onClick={next}>
              {step === 'root' && !rootDir.trim() ? 'Skip' : 'Next'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={finish}>
              Start using Atrium
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
