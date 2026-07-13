import { describe, expect, it } from "vitest";

import {
  findActiveOpenCodeGoAccountId,
  markActiveOpenCodeGoEntries,
} from "../src/lib/opencode-go-active.js";

const config = {
  accounts: [
    {
      id: "personal",
      label: "Personal",
      workspaceId: "ws-1",
      authCookie: "cookie-1",
      apiKey: "go-key-1",
    },
    {
      id: "backup",
      label: "Backup",
      workspaceId: "ws-2",
      authCookie: "cookie-2",
      apiKey: "go-key-2",
    },
  ],
};

describe("OpenCode Go active account presentation", () => {
  it("matches the configured account whose API key is active", () => {
    expect(
      findActiveOpenCodeGoAccountId(config, {
        "opencode-go": { type: "api", key: "go-key-2" },
      }),
    ).toBe("backup");
  });

  it("does not select an account for missing, unknown, or ambiguous credentials", () => {
    expect(findActiveOpenCodeGoAccountId(config, null)).toBeNull();
    expect(
      findActiveOpenCodeGoAccountId(config, {
        "opencode-go": { type: "api", key: "unknown" },
      }),
    ).toBeNull();

    expect(
      findActiveOpenCodeGoAccountId(
        {
          accounts: [config.accounts[0]!, { ...config.accounts[1]!, apiKey: "go-key-1" }],
        },
        { "opencode-go": { type: "api", key: "go-key-1" } },
      ),
    ).toBeNull();
  });

  it("marks only entries belonging to the active account and clears stale markers", () => {
    const entries = markActiveOpenCodeGoEntries(
      [
        {
          name: "Personal 5h",
          group: "OpenCode Go (Personal)",
          quotaAccountId: "personal",
          isActiveAccount: true,
          percentRemaining: 90,
        },
        {
          name: "Backup 5h",
          group: "OpenCode Go (Backup)",
          quotaAccountId: "backup",
          percentRemaining: 80,
        },
      ],
      "backup",
    );

    expect(entries[0]?.isActiveAccount).toBeUndefined();
    expect(entries[1]?.isActiveAccount).toBe(true);
  });

  it("recognizes cached entries written before account ids were persisted", () => {
    const entries = markActiveOpenCodeGoEntries(
      [
        {
          name: "OpenCode Go (Personal) Monthly",
          group: "OpenCode Go (Personal)",
          percentRemaining: 22,
        },
        {
          name: "OpenCode Go (Backup) Monthly",
          group: "OpenCode Go (Backup)",
          percentRemaining: 30,
        },
      ],
      "backup",
      config,
    );

    expect(entries[0]?.isActiveAccount).toBeUndefined();
    expect(entries[1]?.isActiveAccount).toBe(true);
  });
});
