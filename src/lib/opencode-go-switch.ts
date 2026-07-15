import {
  resolveOpenCodeGoConfig,
  type OpenCodeGoConfig,
  type ResolvedOpenCodeGoConfig,
} from "./opencode-go-config.js";
import { sanitizeSingleLineDisplaySnippet } from "./display-sanitize.js";

export const OPENCODE_GO_PROVIDER_ID = "opencode-go";
const MAX_ACCOUNT_DISPLAY_LENGTH = 80;

export interface OpenCodeGoAuthSetClient {
  auth?: {
    set: (params: {
      path: { id: string };
      body: { type: "api"; key: string };
      throwOnError?: boolean;
    }) => Promise<unknown>;
  };
}

type ResolveConfig = () => Promise<ResolvedOpenCodeGoConfig>;

export interface SwitchOpenCodeGoAccountParams {
  client: OpenCodeGoAuthSetClient;
  accountId: string;
  resolveConfig?: ResolveConfig;
  activateApiKey?: (apiKey: string) => void;
}

export type SwitchOpenCodeGoAccountResult =
  | { ok: true; accountId: string; label: string }
  | { ok: false; message: string };

function displayAccountId(value: string): string {
  return sanitizeSingleLineDisplaySnippet(value, MAX_ACCOUNT_DISPLAY_LENGTH) || "(empty)";
}

function listAccountIds(config: OpenCodeGoConfig): string {
  return config.accounts.map((account) => displayAccountId(account.id)).join(", ");
}

function configErrorMessage(
  config: Exclude<ResolvedOpenCodeGoConfig, { state: "configured" }>,
): string {
  if (config.state === "none") {
    return "OpenCode Go account config was not found.";
  }
  if (config.state === "incomplete") {
    return `OpenCode Go account config is incomplete: missing ${displayAccountId(config.missing)}.`;
  }
  return `OpenCode Go account config is invalid: ${displayAccountId(config.error)}.`;
}

export async function switchOpenCodeGoAccount(
  params: SwitchOpenCodeGoAccountParams,
): Promise<SwitchOpenCodeGoAccountResult> {
  const accountId = params.accountId.trim();
  if (!accountId) {
    return { ok: false, message: "An account id is required." };
  }

  const resolved = await (params.resolveConfig ?? resolveOpenCodeGoConfig)();
  if (resolved.state !== "configured") {
    return { ok: false, message: configErrorMessage(resolved) };
  }

  const account = resolved.config.accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    return {
      ok: false,
      message: `Unknown OpenCode Go account id: ${displayAccountId(accountId)}. Available ids: ${listAccountIds(resolved.config)}.`,
    };
  }
  if (!account.apiKey) {
    return {
      ok: false,
      message: `OpenCode Go account ${displayAccountId(account.id)} does not define apiKey.`,
    };
  }
  if (!params.client.auth?.set) {
    return {
      ok: false,
      message: "This OpenCode version does not expose the authentication update API.",
    };
  }

  try {
    const response = await params.client.auth.set({
      path: { id: OPENCODE_GO_PROVIDER_ID },
      body: { type: "api", key: account.apiKey },
      throwOnError: true,
    });
    if (
      response &&
      typeof response === "object" &&
      (("error" in response && response.error) || ("data" in response && response.data === false))
    ) {
      return { ok: false, message: "OpenCode rejected the authentication update." };
    }
  } catch {
    return { ok: false, message: "OpenCode failed to update the authentication credential." };
  }

  // OpenCode caches initialized provider instances, so persisting auth alone
  // does not replace the credential used by an already-running provider.
  // Let the plugin install a request-time override only after persistence succeeds.
  params.activateApiKey?.(account.apiKey);

  return {
    ok: true,
    accountId: account.id,
    label: account.label ?? account.id,
  };
}

export function formatOpenCodeGoSwitchCommandOutput(result: SwitchOpenCodeGoAccountResult): string {
  if (!result.ok) {
    return `OpenCode Go switch failed\n\n${result.message}\n\nUsage: /quota_switch <id>`;
  }

  return [
    "OpenCode Go subscription switched",
    "",
    `Account: ${displayAccountId(result.accountId)}`,
    `Label: ${displayAccountId(result.label)}`,
    "Provider: opencode-go",
    "",
    "New OpenCode Go requests will use this account.",
  ].join("\n");
}
