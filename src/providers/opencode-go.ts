/**
 * OpenCode Go provider wrapper.
 *
 * Scrapes the OpenCode Go workspace dashboard and reports rolling (~5h),
 * weekly, and monthly usage as percentage-based quota entries.
 */

import type {
  QuotaProvider,
  QuotaProviderContext,
  QuotaProviderResult,
  QuotaToastEntry,
} from "../lib/entries.js";
import type { OpenCodeGoResult, OpenCodeGoWindowKey } from "../lib/types.js";
import {
  DEFAULT_OPENCODE_GO_CONFIG_CACHE_MAX_AGE_MS,
  resolveOpenCodeGoConfigCached,
  type OpenCodeGoAccountConfig,
} from "../lib/opencode-go-config.js";
import { queryOpenCodeGoQuota } from "../lib/opencode-go.js";
import { normalizeQuotaProviderId } from "../lib/provider-metadata.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

const OPENCODE_GO_PROVIDER_LABEL = "OpenCode Go";
const OPENCODE_GO_ACCOUNT_CONCURRENCY = 3;
const OPENCODE_GO_WINDOW_ORDER: OpenCodeGoWindowKey[] = ["rolling", "weekly", "monthly"];
const OPENCODE_GO_WINDOW_LABELS: Record<
  OpenCodeGoWindowKey,
  { name: string; label: string; dashboardField: string }
> = {
  rolling: {
    name: `${OPENCODE_GO_PROVIDER_LABEL} 5h`,
    label: "5h:",
    dashboardField: "rollingUsage",
  },
  weekly: {
    name: `${OPENCODE_GO_PROVIDER_LABEL} Weekly`,
    label: "Weekly:",
    dashboardField: "weeklyUsage",
  },
  monthly: {
    name: `${OPENCODE_GO_PROVIDER_LABEL} Monthly`,
    label: "Monthly:",
    dashboardField: "monthlyUsage",
  },
};

function isDefaultOpenCodeGoWindowSelection(windows: OpenCodeGoWindowKey[]): boolean {
  const selected = new Set(windows);
  return (
    selected.size === OPENCODE_GO_WINDOW_ORDER.length &&
    OPENCODE_GO_WINDOW_ORDER.every((window) => selected.has(window))
  );
}

function formatMissingWindowList(windows: OpenCodeGoWindowKey[]): string {
  return windows.map((window) => `${window} (${OPENCODE_GO_WINDOW_LABELS[window].dashboardField})`).join(", ");
}

function buildOpenCodeGoEntries(
  result: Extract<OpenCodeGoResult, { success: true }>,
  selectedWindows: OpenCodeGoWindowKey[],
  group: string = OPENCODE_GO_PROVIDER_LABEL,
): QuotaToastEntry[] {
  const selected = new Set(selectedWindows);
  const entries: QuotaToastEntry[] = [];

  for (const window of OPENCODE_GO_WINDOW_ORDER) {
    if (!selected.has(window)) continue;

    const usage = result[window];
    if (!usage) continue;

    const labels = OPENCODE_GO_WINDOW_LABELS[window];
    entries.push({
      name:
        group === OPENCODE_GO_PROVIDER_LABEL
          ? labels.name
          : `${group} ${labels.label.replace(/:$/u, "")}`,
      group,
      label: labels.label,
      percentRemaining: usage.percentRemaining,
      resetTimeIso: usage.resetTimeIso,
    });
  }

  return entries;
}

function getOpenCodeGoAccountGroup(account: OpenCodeGoAccountConfig, multiple: boolean): string {
  return multiple
    ? `${OPENCODE_GO_PROVIDER_LABEL} (${account.label ?? account.id})`
    : OPENCODE_GO_PROVIDER_LABEL;
}

async function mapWithConcurrency<T, R>(params: {
  items: readonly T[];
  concurrency: number;
  fn: (item: T, index: number) => Promise<R>;
}): Promise<R[]> {
  const results = new Array<R>(params.items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.trunc(params.concurrency)), params.items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= params.items.length) return;
        results[index] = await params.fn(params.items[index]!, index);
      }
    }),
  );

  return results;
}

export const opencodeGoProvider: QuotaProvider = {
  id: "opencode-go",

  async isAvailable(_ctx: QuotaProviderContext): Promise<boolean> {
    const config = await resolveOpenCodeGoConfigCached({
      maxAgeMs: DEFAULT_OPENCODE_GO_CONFIG_CACHE_MAX_AGE_MS,
    });
    return config.state === "configured";
  },

  matchesCurrentModel(model: string): boolean {
    const [provider] = model.toLowerCase().split("/", 2);
    return normalizeQuotaProviderId(provider) === "opencode-go";
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const config = await resolveOpenCodeGoConfigCached({
      maxAgeMs: DEFAULT_OPENCODE_GO_CONFIG_CACHE_MAX_AGE_MS,
    });

    if (config.state === "none") {
      return notAttemptedResult();
    }

    if (config.state === "incomplete") {
      return attemptedErrorResult(
        OPENCODE_GO_PROVIDER_LABEL,
        `Missing ${config.missing} (source: ${config.source})`,
      );
    }

    if (config.state === "invalid") {
      return attemptedErrorResult(
        OPENCODE_GO_PROVIDER_LABEL,
        `Invalid config (${config.source}): ${config.error}`,
      );
    }

    const accounts = config.config.accounts;
    const multiple = accounts.length > 1;
    const results = await mapWithConcurrency({
      items: accounts,
      concurrency: OPENCODE_GO_ACCOUNT_CONCURRENCY,
      fn: async (account) => ({
        account,
        result: await queryOpenCodeGoQuota(account.workspaceId, account.authCookie, {
          requestTimeoutMs: ctx.config?.requestTimeoutMsConfigured
            ? ctx.config.requestTimeoutMs
            : undefined,
        }),
      }),
    });

    if (results.every(({ result }) => !result)) {
      return notAttemptedResult();
    }

    const windows = ctx.config.opencodeGoWindows ?? OPENCODE_GO_WINDOW_ORDER;
    const entries: QuotaToastEntry[] = [];
    const errors: QuotaProviderResult["errors"] = [];

    for (const { account, result } of results) {
      const group = getOpenCodeGoAccountGroup(account, multiple);
      if (!result) {
        errors.push({ label: group, message: "OpenCode Go returned null" });
        continue;
      }
      if (!result.success) {
        errors.push({ label: group, message: result.error });
        continue;
      }

      entries.push(...buildOpenCodeGoEntries(result, windows, group));
      const missingSelectedWindows = windows.filter((window) => !result[window]);
      if (missingSelectedWindows.length > 0 && !isDefaultOpenCodeGoWindowSelection(windows)) {
        errors.push({
          label: group,
          message: `Selected OpenCode Go dashboard window(s) missing: ${formatMissingWindowList(missingSelectedWindows)}`,
        });
      }
    }

    return attemptedResult(entries, errors, multiple ? { singleWindowPerGroup: true } : undefined);
  },
};
