import { setConnector, listConnectors } from "../workspace.js";

// Higgsfield connector — Phase 3 scope: CREDENTIAL STORAGE + STATUS ONLY.
//
// DEFERRED: real image/video generation runs through the Higgsfield MCP
// (subscription-based, Claude-driven via the higgsfield-prompting skill), NOT a
// server-side REST key. So there is intentionally no generate() here and no live
// validateKey ping — we store the credential (encrypted, via the workspace
// connector layer) and report status. Server-side generation is a later slice
// once a server API surface exists.

/** Store the Higgsfield credential. Store-only: no live validation ping. */
export async function setKey(
  workspaceId: number,
  apiKey: string,
  config?: Record<string, unknown>,
): Promise<void> {
  await setConnector(workspaceId, "higgsfield", { apiKey, config });
}

/** Whether a Higgsfield credential is stored for the workspace. */
export async function status(
  workspaceId: number,
): Promise<{ connected: boolean }> {
  const connectors = await listConnectors(workspaceId);
  return {
    connected: connectors.some(
      (c) => c.provider === "higgsfield" && c.status === "connected",
    ),
  };
}
