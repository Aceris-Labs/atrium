import type { Workspace } from "../../shared/types";

const AI_ACTIONS_DISABLED_MESSAGE =
  "AI actions are disabled until they use an explicit API-token-backed client with usage tracking.";

export async function generateWingSummary(
  _wingId: string,
  _workspaceIds: string[],
): Promise<string> {
  throw new Error(AI_ACTIONS_DISABLED_MESSAGE);
}

export async function generateWorkspaceDigest(
  _workspace: Workspace,
): Promise<string> {
  throw new Error(AI_ACTIONS_DISABLED_MESSAGE);
}
