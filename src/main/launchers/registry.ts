import type {
  DetectedTools,
  LaunchProfile,
  TmuxPane,
} from "../../shared/types";

export const DEFAULT_TMUX_PANES: TmuxPane[] = [
  { command: "nvim" },
  { split: "h", size: 40, command: "${claude}", focus: true },
  { split: "v" },
];

export const TMUX_SYSTEM_ID = "system:tmux:default";

const TERMINAL_PRIORITY = ["ghostty", "iterm", "warp", "terminal"];

function pickDefaultTerminal(tools: DetectedTools): string {
  const terminals = tools.terminals as Record<string, { installed: boolean }>;
  return TERMINAL_PRIORITY.find((t) => terminals[t]?.installed) ?? "ghostty";
}

/**
 * The single seeded system profile. Everything else is user-created.
 * System profiles are read-only and undeletable — duplicate to customize.
 */
export function buildSystemProfiles(tools: DetectedTools): LaunchProfile[] {
  return [
    {
      id: TMUX_SYSTEM_ID,
      name: "Three-pane tmux",
      description:
        "Opens your terminal with a tmux session: nvim + claude + shell.",
      isSystem: true,
      actions: [
        {
          type: "tmux",
          app: pickDefaultTerminal(tools),
          panes: DEFAULT_TMUX_PANES,
        },
      ],
    },
  ];
}

/** Merge fresh system profiles into the existing list, replacing any existing
 *  entries with the same id and preserving all user profiles. */
export function mergeSystemProfiles(
  existing: LaunchProfile[],
  system: LaunchProfile[],
): LaunchProfile[] {
  const systemIds = new Set(system.map((p) => p.id));
  const kept = existing.filter((p) => !systemIds.has(p.id));
  return [...system, ...kept];
}
