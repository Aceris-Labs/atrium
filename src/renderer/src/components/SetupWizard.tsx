import { useEffect, useState } from "react";
import { PathInput } from "./PathInput";
import { LauncherPicker } from "./LauncherPicker";
import type { DetectedTools, ToolStatus } from "../../../shared/types";

interface Props {
  onComplete: () => void;
}

type Step = "gh" | "launcher" | "wing" | "done";
const STEPS: Step[] = ["gh", "launcher", "wing", "done"];

function StatusIcon({ status }: { status: ToolStatus }) {
  if (!status.installed)
    return <span className="setup-icon setup-icon-missing">✗</span>;
  if (status.authenticated === false)
    return <span className="setup-icon setup-icon-warn">!</span>;
  return <span className="setup-icon setup-icon-ok">✓</span>;
}

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("gh");
  const [tools, setTools] = useState<DetectedTools | null>(null);
  const [detecting, setDetecting] = useState(false);

  const [wingName, setWingName] = useState("Main");
  const [projectDir, setProjectDir] = useState("");
  const [ghPath, setGhPath] = useState("");
  const [launcherId, setLauncherId] = useState<string | null>(null);

  async function runDetect(force = false) {
    setDetecting(true);
    const d = await window.api.setup.detect(force);
    setTools(d);
    setDetecting(false);
    if (d.gh.path) setGhPath(d.gh.path);
  }

  useEffect(() => {
    runDetect();
    // Pre-fill with the current global default (set by migration) so the user
    // sees a sensible starting point.
    window.api.launchers.list().then((d) => {
      if (d.globalDefault) setLauncherId(d.globalDefault);
    });
  }, []);

  const stepIdx = STEPS.indexOf(step);
  function next() {
    if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]);
  }
  function back() {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1]);
  }

  async function finish() {
    if (launcherId) {
      await window.api.launchers.setGlobalDefault(launcherId);
    }
    await window.api.config.set({
      ghPath: ghPath || "/opt/homebrew/bin/gh",
      setupComplete: true,
    });
    await window.api.wings.create({
      name: wingName.trim() || "Main",
      projectDir: projectDir.trim() || undefined,
      // launchProfile omitted → wing inherits the global default we just set
    });
    onComplete();
  }

  return (
    <div className="setup-overlay">
      <div className="setup-wizard">
        <div className="setup-header">
          <h1 className="setup-title">Welcome to Atrium</h1>
          <div className="setup-steps">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`setup-step-dot${i <= stepIdx ? " active" : ""}`}
              />
            ))}
          </div>
        </div>

        <div className="setup-body">
          {/* ── GitHub CLI ──────────────────────────────── */}
          {step === "gh" && tools && (
            <div className="setup-section">
              <h2 className="setup-subtitle">Tools</h2>

              <div className="setup-tool-card">
                <StatusIcon status={tools.gh} />
                <div className="setup-tool-info">
                  <span className="setup-tool-name">
                    {tools.gh.installed ? "GitHub CLI" : "GitHub CLI not found"}
                  </span>
                  {tools.gh.path && (
                    <code className="setup-tool-path">{tools.gh.path}</code>
                  )}
                </div>
              </div>
              {!tools.gh.installed && (
                <div className="setup-action-box">
                  <p>Install:</p>
                  <code className="setup-command">brew install gh</code>
                  <button
                    className="btn btn-ghost"
                    onClick={() => runDetect(true)}
                    disabled={detecting}
                  >
                    {detecting ? "Checking…" : "Re-check"}
                  </button>
                </div>
              )}
              {tools.gh.installed && !tools.gh.authenticated && (
                <div className="setup-action-box">
                  <p>Authenticate:</p>
                  <code className="setup-command">gh auth login</code>
                  <button
                    className="btn btn-ghost"
                    onClick={() => runDetect(true)}
                    disabled={detecting}
                  >
                    {detecting ? "Checking…" : "Re-check"}
                  </button>
                </div>
              )}
              {tools.gh.installed && tools.gh.authenticated && (
                <div className="setup-action-box setup-action-success">
                  Authenticated
                  {tools.gh.username ? ` as ${tools.gh.username}` : ""}
                </div>
              )}

              <div className="setup-tool-card">
                <StatusIcon status={tools.claude} />
                <div className="setup-tool-info">
                  <span className="setup-tool-name">
                    {tools.claude.installed
                      ? "Claude Code"
                      : "Claude Code not found"}
                  </span>
                  {tools.claude.version && (
                    <code className="setup-tool-path">
                      {tools.claude.version}
                    </code>
                  )}
                </div>
              </div>
              {!tools.claude.installed && (
                <div className="setup-action-box">
                  <p>Install:</p>
                  <code className="setup-command">
                    npm install -g @anthropic-ai/claude-code
                  </code>
                  <button
                    className="btn btn-ghost"
                    onClick={() => runDetect(true)}
                    disabled={detecting}
                  >
                    {detecting ? "Checking…" : "Re-check"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Launcher ────────────────────────────────── */}
          {step === "launcher" && (
            <div className="setup-section">
              <h2 className="setup-subtitle">Default launcher</h2>
              <p className="setup-desc">
                Choose what opens when you launch a workspace. You can customize
                or create your own anytime in Settings → Launchers.
              </p>
              <LauncherPicker
                scope="global"
                value={launcherId}
                onChange={setLauncherId}
              />
            </div>
          )}

          {/* ── First wing ──────────────────────────────── */}
          {step === "wing" && (
            <div className="setup-section">
              <h2 className="setup-subtitle">Your first wing</h2>
              <p className="setup-desc">
                A wing is a project context — its own set of workspaces, PRs,
                and project directory. You can add more wings anytime from the
                tab strip.
              </p>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  value={wingName}
                  onChange={(e) => setWingName(e.target.value)}
                  placeholder="Main"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Project directory</label>
                <PathInput
                  value={projectDir}
                  onChange={setProjectDir}
                  placeholder="~/your-project-directory"
                />
                <p className="setup-desc" style={{ marginTop: 6 }}>
                  Atrium scans this directory for git repos to scope this wing's
                  PR dashboard. Tab to complete.
                </p>
              </div>
            </div>
          )}

          {/* ── Done ───────────────────────────────────── */}
          {step === "done" && (
            <div className="setup-section">
              <h2 className="setup-subtitle">All set</h2>
              <div className="setup-summary">
                <div className="setup-summary-row">
                  <span className="setup-summary-label">First wing</span>
                  <span>{wingName.trim() || "Main"}</span>
                </div>
                <div className="setup-summary-row">
                  <span className="setup-summary-label">Project directory</span>
                  <code>{projectDir || "(not set)"}</code>
                </div>
                <div className="setup-summary-row">
                  <span className="setup-summary-label">Default launcher</span>
                  <span>{launcherId ?? "(none)"}</span>
                </div>
              </div>
              <p className="setup-desc" style={{ marginTop: 16 }}>
                You can change these anytime in Settings.
              </p>
            </div>
          )}
        </div>

        <div className="setup-footer">
          {stepIdx > 0 && step !== "done" && (
            <button className="btn btn-ghost" onClick={back}>
              Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step !== "done" ? (
            <button
              className="btn btn-primary"
              onClick={next}
              disabled={step === "wing" && !wingName.trim()}
            >
              Next
            </button>
          ) : (
            <button className="btn btn-primary" onClick={finish}>
              Start using Atrium
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
