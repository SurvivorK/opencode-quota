import type { QuotaToastEntry } from "./entries.js";
import { readAuthFile } from "./opencode-auth.js";
import { resolveOpenCodeGoConfig, type OpenCodeGoConfig } from "./opencode-go-config.js";
import type { AuthData } from "./types.js";

export interface CurrentOpenCodeGoAccount {
  config: OpenCodeGoConfig;
  accountId: string | null;
}

export function findActiveOpenCodeGoAccountId(
  config: OpenCodeGoConfig,
  auth: AuthData | null | undefined,
): string | null {
  const credential = auth?.["opencode-go"];
  if (credential?.type !== "api" || typeof credential.key !== "string") {
    return null;
  }

  const activeKey = credential.key.trim();
  if (!activeKey) {
    return null;
  }

  const matches = config.accounts.filter(
    (account) => typeof account.apiKey === "string" && account.apiKey.trim() === activeKey,
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

export function markActiveOpenCodeGoEntries(
  entries: QuotaToastEntry[],
  activeAccountId: string | null,
  config?: OpenCodeGoConfig,
): QuotaToastEntry[] {
  const activeAccount = config?.accounts.find((account) => account.id === activeAccountId);
  const legacyActiveGroup = activeAccount
    ? (config?.accounts.length ?? 0) > 1
      ? `OpenCode Go (${activeAccount.label ?? activeAccount.id})`
      : "OpenCode Go"
    : null;

  return entries.map((entry) => {
    const { isActiveAccount: _isActiveAccount, ...withoutActiveMarker } = entry;
    const matchesActiveAccount =
      activeAccountId &&
      (entry.quotaAccountId === activeAccountId ||
        (!entry.quotaAccountId && entry.group === legacyActiveGroup));
    return matchesActiveAccount
      ? { ...withoutActiveMarker, isActiveAccount: true }
      : withoutActiveMarker;
  });
}

export async function markCurrentOpenCodeGoEntries(
  entries: QuotaToastEntry[],
): Promise<QuotaToastEntry[]> {
  const current = await resolveCurrentOpenCodeGoAccount();
  return markActiveOpenCodeGoEntries(entries, current?.accountId ?? null, current?.config);
}

export async function resolveCurrentOpenCodeGoAccount(): Promise<CurrentOpenCodeGoAccount | null> {
  const config = await resolveOpenCodeGoConfig();
  if (config.state !== "configured") {
    return null;
  }

  const auth = await readAuthFile();
  return {
    config: config.config,
    accountId: findActiveOpenCodeGoAccountId(config.config, auth),
  };
}
