import { readFile } from "fs/promises";
import { join } from "path";

import { getOpencodeRuntimeDirCandidates } from "./opencode-runtime-paths.js";

export interface OpenCodeGoAccountConfig {
  id: string;
  label?: string;
  workspaceId: string;
  authCookie: string;
}

export interface OpenCodeGoConfig {
  accounts: OpenCodeGoAccountConfig[];
}

export type ResolvedOpenCodeGoConfig =
  | { state: "none" }
  | { state: "configured"; config: OpenCodeGoConfig; source: string }
  | { state: "incomplete"; source: string; missing: string }
  | { state: "invalid"; source: string; error: string };

export interface OpenCodeGoConfigDiagnostics {
  state: ResolvedOpenCodeGoConfig["state"];
  source: string | null;
  missing: string | null;
  error: string | null;
  accountCount: number;
  checkedPaths: string[];
}

type ReadConfigFileResult =
  | { state: "missing" }
  | { state: "loaded"; config: Record<string, unknown> }
  | { state: "invalid"; error: string };

type ParsedOpenCodeGoConfig =
  | { state: "configured"; config: OpenCodeGoConfig }
  | { state: "incomplete"; missing: string }
  | { state: "invalid"; error: string };

function getConfigCandidatePaths(): string[] {
  const { configDirs } = getOpencodeRuntimeDirCandidates();
  return configDirs.map((dir) => join(dir, "opencode-quota", "opencode-go.json"));
}

function getConfigFileError(error: unknown): string {
  if (error instanceof SyntaxError) {
    return `Failed to parse JSON: ${error.message}`;
  }
  if (error instanceof Error && error.message) {
    return `Failed to read config file: ${error.message}`;
  }
  return `Failed to read config file: ${String(error)}`;
}

async function readConfigFile(path: string): Promise<ReadConfigFileResult> {
  try {
    const data = await readFile(path, "utf-8");
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { state: "invalid", error: "Config file must contain a JSON object" };
    }
    return { state: "loaded", config: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { state: "missing" };
    }
    return { state: "invalid", error: getConfigFileError(error) };
  }
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseOpenCodeGoAccount(
  value: unknown,
  index: number,
):
  | { state: "configured"; account: OpenCodeGoAccountConfig }
  | Exclude<ParsedOpenCodeGoConfig, { state: "configured" }> {
  const path = `accounts[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { state: "invalid", error: `${path} must be a JSON object` };
  }

  const raw = value as Record<string, unknown>;
  const id = trimmedString(raw.id);
  const workspaceId = trimmedString(raw.workspaceId);
  const authCookie = trimmedString(raw.authCookie);

  if (!id) return { state: "incomplete", missing: `${path}.id` };
  if (!workspaceId) return { state: "incomplete", missing: `${path}.workspaceId` };
  if (!authCookie) return { state: "incomplete", missing: `${path}.authCookie` };

  if (raw.label !== undefined && typeof raw.label !== "string") {
    return { state: "invalid", error: `${path}.label must be a string` };
  }
  const label = trimmedString(raw.label);
  if (raw.label !== undefined && !label) {
    return { state: "invalid", error: `${path}.label must not be empty` };
  }

  return {
    state: "configured",
    account: { id, ...(label ? { label } : {}), workspaceId, authCookie },
  };
}

function parseOpenCodeGoConfig(raw: Record<string, unknown>): ParsedOpenCodeGoConfig {
  if ("accounts" in raw) {
    if (!Array.isArray(raw.accounts)) {
      return { state: "invalid", error: "accounts must be a JSON array" };
    }
    if (raw.accounts.length === 0) {
      return { state: "invalid", error: "accounts must contain at least one account" };
    }

    const accounts: OpenCodeGoAccountConfig[] = [];
    const ids = new Set<string>();
    const labels = new Set<string>();

    for (const [index, value] of raw.accounts.entries()) {
      const parsed = parseOpenCodeGoAccount(value, index);
      if (parsed.state !== "configured") return parsed;

      const { account } = parsed;
      if (ids.has(account.id)) {
        return { state: "invalid", error: `Duplicate account id: ${account.id}` };
      }
      const displayLabel = account.label ?? account.id;
      if (labels.has(displayLabel)) {
        return { state: "invalid", error: `Duplicate account label: ${displayLabel}` };
      }

      ids.add(account.id);
      labels.add(displayLabel);
      accounts.push(account);
    }

    return { state: "configured", config: { accounts } };
  }

  const workspaceId = trimmedString(raw.workspaceId);
  const authCookie = trimmedString(raw.authCookie);
  if (workspaceId && authCookie) {
    return {
      state: "configured",
      config: { accounts: [{ id: "default", workspaceId, authCookie }] },
    };
  }

  return { state: "incomplete", missing: !workspaceId ? "workspaceId" : "authCookie" };
}

export function resolveOpenCodeGoConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOpenCodeGoConfig | null {
  const workspaceId = env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const authCookie = env.OPENCODE_GO_AUTH_COOKIE?.trim();

  if (!workspaceId && !authCookie) return null;

  if (workspaceId && authCookie) {
    return {
      state: "configured",
      config: { accounts: [{ id: "default", workspaceId, authCookie }] },
      source: "env",
    };
  }

  return {
    state: "incomplete",
    source: "env",
    missing: workspaceId ? "OPENCODE_GO_AUTH_COOKIE" : "OPENCODE_GO_WORKSPACE_ID",
  };
}

export async function resolveOpenCodeGoConfig(): Promise<ResolvedOpenCodeGoConfig> {
  const envResult = resolveOpenCodeGoConfigFromEnv();
  if (envResult) return envResult;

  const candidates = getConfigCandidatePaths();
  for (const path of candidates) {
    const fileResult = await readConfigFile(path);
    if (fileResult.state === "missing") continue;
    if (fileResult.state === "invalid") {
      return { state: "invalid", source: path, error: fileResult.error };
    }

    const parsed = parseOpenCodeGoConfig(fileResult.config);
    if (parsed.state === "configured") {
      return {
        state: "configured",
        config: parsed.config,
        source: path,
      };
    }
    if (parsed.state === "incomplete") {
      return { state: "incomplete", source: path, missing: parsed.missing };
    }
    return { state: "invalid", source: path, error: parsed.error };
  }

  return { state: "none" };
}

let cachedConfig: ResolvedOpenCodeGoConfig | null = null;
let cachedAt = 0;

const DEFAULT_CACHE_MAX_AGE_MS = 30_000;
export { DEFAULT_CACHE_MAX_AGE_MS as DEFAULT_OPENCODE_GO_CONFIG_CACHE_MAX_AGE_MS };

export async function resolveOpenCodeGoConfigCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedOpenCodeGoConfig> {
  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS);
  const now = Date.now();
  if (cachedConfig && now - cachedAt < maxAgeMs) {
    return cachedConfig;
  }
  cachedConfig = await resolveOpenCodeGoConfig();
  cachedAt = now;
  return cachedConfig;
}

export async function getOpenCodeGoConfigDiagnostics(): Promise<OpenCodeGoConfigDiagnostics> {
  const resolved = await resolveOpenCodeGoConfig();
  const checkedPaths = getConfigCandidatePaths();

  if (resolved.state === "none") {
    return {
      state: "none",
      source: null,
      missing: null,
      error: null,
      accountCount: 0,
      checkedPaths,
    };
  }

  if (resolved.state === "incomplete") {
    return {
      state: "incomplete",
      source: resolved.source,
      missing: resolved.missing,
      error: null,
      accountCount: 0,
      checkedPaths,
    };
  }

  if (resolved.state === "invalid") {
    return {
      state: "invalid",
      source: resolved.source,
      missing: null,
      error: resolved.error,
      accountCount: 0,
      checkedPaths,
    };
  }

  return {
    state: "configured",
    source: resolved.source,
    missing: null,
    error: null,
    accountCount: resolved.config.accounts.length,
    checkedPaths,
  };
}
