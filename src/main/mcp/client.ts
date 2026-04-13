import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "./discovery";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export class McpClient {
  private client: Client;
  private transport: StdioClientTransport;
  private _tools: McpTool[] | null = null;
  private _connected = false;

  constructor(private config: McpServerConfig) {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...process.env, ...config.env } : undefined,
    });
    this.client = new Client(
      { name: "atrium", version: "1.0.0" },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    await this.client.connect(this.transport);
    this._connected = true;
  }

  async listTools(): Promise<McpTool[]> {
    if (this._tools) return this._tools;
    await this.connect();
    const result = await this.client.listTools();
    this._tools = result.tools as McpTool[];
    return this._tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await this.connect();
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    if (this._connected) {
      await this.client.close().catch(() => {});
      this._connected = false;
      this._tools = null;
    }
  }

  get serverName(): string {
    return this.config.name;
  }
}

// One client per unique server command — created lazily, closed on app quit
const pool = new Map<string, McpClient>();

function poolKey(config: McpServerConfig): string {
  return `${config.command} ${config.args.join(" ")}`;
}

export function getMcpClient(config: McpServerConfig): McpClient {
  const key = poolKey(config);
  if (!pool.has(key)) {
    pool.set(key, new McpClient(config));
  }
  return pool.get(key)!;
}

export async function closeAllMcpClients(): Promise<void> {
  await Promise.allSettled([...pool.values()].map((c) => c.close()));
  pool.clear();
}
