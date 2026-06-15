import type { QuotaProvider, QuotaProviderContext, QuotaProviderResult } from "../lib/entries.js";
import { hasAgyQuotaRuntimeAvailable, queryGoogleAgyQuota } from "../lib/google-agy.js";
import { parseProviderModelRef } from "../lib/provider-model-matching.js";
import {
  formatGoogleAccountErrors,
  formatGoogleAccountLabel,
} from "./google-account-format.js";
import { attemptedErrorResult, attemptedResult, notAttemptedResult } from "./result-helpers.js";

function isAgyModel(model: string): boolean {
  const { providerId } = parseProviderModelRef(model);
  return ["google-agy", "opencode-agy-auth", "google-agy-auth"].includes(providerId);
}

async function isAgyConfigured(ctx: QuotaProviderContext): Promise<boolean> {
  try {
    return await hasAgyQuotaRuntimeAvailable(ctx.client);
  } catch {
    return false;
  }
}

export const googleAgyProvider: QuotaProvider = {
  id: "google-agy",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    return await isAgyConfigured(ctx);
  },

  matchesCurrentModel(model: string): boolean {
    return isAgyModel(model);
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const result = await queryGoogleAgyQuota(ctx.client, {
      requestTimeoutMs: ctx.config?.requestTimeoutMsConfigured
        ? ctx.config.requestTimeoutMs
        : undefined,
    });

    if (!result) {
      return notAttemptedResult();
    }

    if (!result.success) {
      return attemptedErrorResult("Google Agy", result.error);
    }

    const groupedBuckets = new Map<string, typeof result.buckets[0]>();

    for (const bucket of result.buckets) {
      let groupName: string | undefined;
      const name = bucket.displayName;

      if (name.startsWith("Gemini 2.5")) {
        groupName = "Gemini 2.5";
      } else if (name.startsWith("Gemini 3 ") || name.startsWith("Gemini 3.1")) {
        groupName = "Gemini 3 & 3.1";
      } else if (name.startsWith("Gemini 3.5")) {
        groupName = "Gemini 3.5";
      } else if (name.includes("Claude") && name.includes("4.6")) {
        groupName = "Claude 4.6";
      }

      if (!groupName) continue;

      const key = `${bucket.accountEmail || ""}::${groupName}`;
      const existing = groupedBuckets.get(key);

      if (!existing || bucket.percentRemaining < existing.percentRemaining) {
        groupedBuckets.set(key, { ...bucket, displayName: groupName });
      }
    }

    const finalBuckets = Array.from(groupedBuckets.values()).sort((a, b) => 
      a.displayName.localeCompare(b.displayName)
    );

    const entries = finalBuckets.map((bucket) => {
      const emailLabel = formatGoogleAccountLabel(bucket.accountEmail, "domainHint");
      const parsedRemaining = bucket.remainingAmount
        ? Number.parseInt(bucket.remainingAmount, 10)
        : Number.NaN;
      const remainingAmount = bucket.remainingAmount
        ? `${Number.isFinite(parsedRemaining) ? parsedRemaining.toLocaleString("en-US") : bucket.remainingAmount} left`
        : undefined;
      const tokenType = bucket.tokenType?.trim().toUpperCase();
      const right = [remainingAmount, tokenType && tokenType !== "REQUESTS" ? tokenType : undefined]
        .filter(Boolean)
        .join(" ");

      return {
        name: `${bucket.displayName} (${emailLabel})`,
        group: "Google Agy",
        label: `${bucket.displayName}:`,
        ...(right ? { right } : {}),
        percentRemaining: bucket.percentRemaining,
        resetTimeIso: bucket.resetTimeIso,
      };
    });

    return attemptedResult(entries, formatGoogleAccountErrors(result.errors, "domainHint"), {
      singleWindowDisplayName: "Google Agy",
      singleWindowShowRight: true,
    });
  },
};
