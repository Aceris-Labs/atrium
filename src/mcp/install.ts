/**
 * `atrium-mcp install` — register the Atrium MCP server with one or more
 * MCP-aware agents (Claude Code, Codex, Cursor) by editing their config.
 *
 * Idempotent. Backs up the original file (`.bak.<timestamp>`) before writing.
 * Atomic write (temp+rename) so a partial run can't corrupt anyone's config.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync } from "fs";
import { writeFile, rename, copyFile, unlink } from "fs/promises";
import { homedir } from "os";
import { dirname, join, resolve } from "path";

type Agent = "claude" | "codex" | "cursor";

interface AgentSpec {
  name: Agent;
  prettyName: string;
  configPath: string;
  /** Reads the existing config and returns an updated object with Atrium registered. */
  apply: (raw: unknown, command: string, args: string[]) => unknown;
  /** Removes the Atrium registration. */
  remove: (raw: unknown) => unknown;
  /** True if Atrium is already registered in this config. */
  has: (raw: unknown) => boolean;
}

const SERVER_NAME = "atrium";

// Each agent has its own config layout. We narrow into a common
// "mcpServers"-style record and write our entry there.
const AGENTS: AgentSpec[] = [
  {
    name: "claude",
    prettyName: "Claude Code",
    // User-scoped MCP servers live in ~/.claude.json under top-level mcpServers.
    // (~/.claude/settings.json holds hooks/permissions but does NOT load MCP.)
    configPath: join(homedir(), ".claude.json"),
    apply: (raw, command, args) => {
      const obj = (raw as Record<string, unknown>) ?? {};
      const servers =
        (obj.mcpServers as Record<string, unknown>) ?? ({} as Record<string, unknown>);
      servers[SERVER_NAME] = { type: "stdio", command, args };
      obj.mcpServers = servers;
      return obj;
    },
    remove: (raw) => {
      const obj = (raw as Record<string, unknown>) ?? {};
      const servers = obj.mcpServers as Record<string, unknown> | undefined;
      if (servers && SERVER_NAME in servers) {
        delete servers[SERVER_NAME];
      }
      return obj;
    },
    has: (raw) => {
      const servers = (raw as Record<string, unknown> | undefined)
        ?.mcpServers as Record<string, unknown> | undefined;
      return !!servers && SERVER_NAME in servers;
    },
  },
  {
    name: "codex",
    prettyName: "Codex",
    // Codex CLI keeps its config at ~/.codex/config.toml normally, but JSON
    // also works and is cleaner to write programmatically. If a TOML file
    // exists we write the JSON variant alongside and let the user decide
    // (Codex picks up either). For first-time install JSON is fine.
    configPath: join(homedir(), ".codex", "mcp.json"),
    apply: (raw, command, args) => {
      const obj = (raw as Record<string, unknown>) ?? {};
      const servers =
        (obj.mcpServers as Record<string, unknown>) ?? ({} as Record<string, unknown>);
      servers[SERVER_NAME] = { type: "stdio", command, args };
      obj.mcpServers = servers;
      return obj;
    },
    remove: (raw) => {
      const obj = (raw as Record<string, unknown>) ?? {};
      const servers = obj.mcpServers as Record<string, unknown> | undefined;
      if (servers && SERVER_NAME in servers) delete servers[SERVER_NAME];
      return obj;
    },
    has: (raw) => {
      const servers = (raw as Record<string, unknown> | undefined)
        ?.mcpServers as Record<string, unknown> | undefined;
      return !!servers && SERVER_NAME in servers;
    },
  },
  {
    name: "cursor",
    prettyName: "Cursor",
    configPath: join(homedir(), ".cursor", "mcp.json"),
    apply: (raw, command, args) => {
      const obj = (raw as Record<string, unknown>) ?? {};
      const servers =
        (obj.mcpServers as Record<string, unknown>) ?? ({} as Record<string, unknown>);
      servers[SERVER_NAME] = { type: "stdio", command, args };
      obj.mcpServers = servers;
      return obj;
    },
    remove: (raw) => {
      const obj = (raw as Record<string, unknown>) ?? {};
      const servers = obj.mcpServers as Record<string, unknown> | undefined;
      if (servers && SERVER_NAME in servers) delete servers[SERVER_NAME];
      return obj;
    },
    has: (raw) => {
      const servers = (raw as Record<string, unknown> | undefined)
        ?.mcpServers as Record<string, unknown> | undefined;
      return !!servers && SERVER_NAME in servers;
    },
  },
];

function readJsonOrEmpty(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `Could not parse ${path}: ${(e as Error).message}. Refusing to overwrite — fix the file by hand and retry.`,
    );
  }
}

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(data, null, 2) + "\n";

  // If the target is a symlink (e.g. dotfiles-managed), don't temp+rename —
  // that replaces the symlink with a regular file and breaks the dotfile link.
  // Write through the symlink directly. We lose crash atomicity for these
  // cases, but the alternative (silently breaking dotfile sync) is worse.
  let isSymlink = false;
  try {
    isSymlink = lstatSync(path).isSymbolicLink();
  } catch {
    // path doesn't exist — fall through to normal atomic write
  }

  if (existsSync(path)) {
    await copyFile(path, `${path}.bak.${Date.now()}`);
  }

  if (isSymlink) {
    await writeFile(path, body);
    return;
  }

  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, body);
    await rename(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

function serverInvocation(): { command: string; args: string[] } {
  // The server invokes itself: same binary, no subcommand → server mode.
  // We resolve to an absolute path so client configs survive PATH changes.
  const self = resolve(process.argv[1]);
  // process.argv[0] is the node binary used to launch this script. Using it
  // directly means the registration works even if `node` isn't on the agent's
  // PATH (common with nvm/asdf-managed installs).
  return { command: process.argv[0], args: [self] };
}

export async function run(
  cmd: "install" | "uninstall" | "status",
  args: string[],
): Promise<void> {
  const filter = (args[0] ?? "").toLowerCase() as Agent | "";
  const targets = filter
    ? AGENTS.filter((a) => a.name === filter)
    : AGENTS;
  if (filter && targets.length === 0) {
    console.error(
      `Unknown agent: ${filter}. Known: ${AGENTS.map((a) => a.name).join(", ")}.`,
    );
    process.exit(1);
  }

  if (cmd === "status") {
    for (const agent of targets) {
      const exists = existsSync(agent.configPath);
      const present = exists && agent.has(readJsonOrEmpty(agent.configPath));
      console.log(
        `${exists ? (present ? "✓" : "·") : "—"}  ${agent.prettyName.padEnd(14)}  ${agent.configPath}${
          exists ? (present ? "  [registered]" : "  [config exists, not registered]") : "  [no config]"
        }`,
      );
    }
    return;
  }

  if (cmd === "install") {
    const { command, args: serverArgs } = serverInvocation();
    for (const agent of targets) {
      const raw = readJsonOrEmpty(agent.configPath);
      const next = agent.apply(raw, command, serverArgs);
      await atomicWriteJson(agent.configPath, next);
      console.log(`✓ ${agent.prettyName} → ${agent.configPath}`);
    }
    console.log("");
    console.log(
      `Atrium MCP registered. Restart your agent (or open a new session) to pick it up.`,
    );
    console.log(`Server invocation written: ${command} ${serverArgs.join(" ")}`);
    return;
  }

  if (cmd === "uninstall") {
    for (const agent of targets) {
      if (!existsSync(agent.configPath)) {
        console.log(`—  ${agent.prettyName}  (no config to clean)`);
        continue;
      }
      const raw = readJsonOrEmpty(agent.configPath);
      if (!agent.has(raw)) {
        console.log(`·  ${agent.prettyName}  (already absent)`);
        continue;
      }
      const next = agent.remove(raw);
      await atomicWriteJson(agent.configPath, next);
      console.log(`✓  ${agent.prettyName} cleaned`);
    }
    return;
  }
}
