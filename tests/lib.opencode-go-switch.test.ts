import { describe, expect, it, vi } from "vitest";

import {
  formatOpenCodeGoSwitchCommandOutput,
  switchOpenCodeGoAccount,
} from "../src/lib/opencode-go-switch.js";

function configured(
  accounts = [
    {
      id: "personal",
      label: "Personal",
      workspaceId: "ws-1",
      authCookie: "cookie-1",
      apiKey: "go-secret-1",
    },
  ],
) {
  return async () => ({
    state: "configured" as const,
    source: "/tmp/opencode-go.json",
    config: { accounts },
  });
}

describe("OpenCode Go account switching", () => {
  it("sets the opencode-go API credential without exposing the key", async () => {
    const set = vi.fn().mockResolvedValue({ data: true });

    const result = await switchOpenCodeGoAccount({
      client: { auth: { set } },
      accountId: " personal ",
      resolveConfig: configured(),
    });

    expect(result).toEqual({ ok: true, accountId: "personal", label: "Personal" });
    expect(set).toHaveBeenCalledWith({
      path: { id: "opencode-go" },
      body: { type: "api", key: "go-secret-1" },
      throwOnError: true,
    });
    expect(formatOpenCodeGoSwitchCommandOutput(result)).toContain(
      "OpenCode Go subscription switched",
    );
    expect(formatOpenCodeGoSwitchCommandOutput(result)).not.toContain("go-secret-1");
  });

  it("reports an unknown id and lists configured ids without changing auth", async () => {
    const set = vi.fn();
    const result = await switchOpenCodeGoAccount({
      client: { auth: { set } },
      accountId: "missing",
      resolveConfig: configured([
        {
          id: "personal",
          workspaceId: "ws-1",
          authCookie: "cookie-1",
          apiKey: "go-secret-1",
        },
        {
          id: "backup",
          workspaceId: "ws-2",
          authCookie: "cookie-2",
          apiKey: "go-secret-2",
        },
      ]),
    });

    expect(result).toEqual({
      ok: false,
      message: "Unknown OpenCode Go account id: missing. Available ids: personal, backup.",
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("requires apiKey only for switching, not quota scraping", async () => {
    const set = vi.fn();
    const result = await switchOpenCodeGoAccount({
      client: { auth: { set } },
      accountId: "personal",
      resolveConfig: configured([{ id: "personal", workspaceId: "ws-1", authCookie: "cookie-1" }]),
    });

    expect(result).toEqual({
      ok: false,
      message: "OpenCode Go account personal does not define apiKey.",
    });
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    [{ state: "none" as const }, "OpenCode Go account config was not found."],
    [
      {
        state: "incomplete" as const,
        source: "/tmp/opencode-go.json",
        missing: "accounts[0].apiKey",
      },
      "OpenCode Go account config is incomplete: missing accounts[0].apiKey.",
    ],
    [
      {
        state: "invalid" as const,
        source: "/tmp/opencode-go.json",
        error: "duplicate id",
      },
      "OpenCode Go account config is invalid: duplicate id.",
    ],
  ])("reports unavailable config without changing auth %#", async (config, message) => {
    const set = vi.fn();
    const result = await switchOpenCodeGoAccount({
      client: { auth: { set } },
      accountId: "personal",
      resolveConfig: async () => config,
    });

    expect(result).toEqual({ ok: false, message });
    expect(set).not.toHaveBeenCalled();
  });

  it("fails closed when the SDK rejects the update and never echoes its error", async () => {
    const secret = "go-secret-1";
    const set = vi.fn().mockRejectedValue(new Error(`request included ${secret}`));
    const result = await switchOpenCodeGoAccount({
      client: { auth: { set } },
      accountId: "personal",
      resolveConfig: configured(),
    });

    expect(result).toEqual({
      ok: false,
      message: "OpenCode failed to update the authentication credential.",
    });
    expect(formatOpenCodeGoSwitchCommandOutput(result)).not.toContain(secret);
  });

  it("reports a missing auth API without attempting a credential write", async () => {
    await expect(
      switchOpenCodeGoAccount({
        client: {},
        accountId: "personal",
        resolveConfig: configured(),
      }),
    ).resolves.toEqual({
      ok: false,
      message: "This OpenCode version does not expose the authentication update API.",
    });
  });
});
