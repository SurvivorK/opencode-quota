import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimePathMocks = vi.hoisted(() => ({
  getOpencodeRuntimeDirCandidates: vi.fn(),
}));

vi.mock("../src/lib/opencode-runtime-paths.js", () => ({
  getOpencodeRuntimeDirCandidates: runtimePathMocks.getOpencodeRuntimeDirCandidates,
}));

const tempRoots: string[] = [];
const originalEnv = process.env;

function getConfigPath(configDir: string): string {
  return join(configDir, "opencode-quota", "opencode-go.json");
}

async function createConfigDirs(): Promise<[string, string]> {
  const root = await mkdtemp(join(tmpdir(), "opencode-go-config-"));
  tempRoots.push(root);

  const primaryDir = join(root, "config-primary");
  const fallbackDir = join(root, "config-fallback");

  await mkdir(join(primaryDir, "opencode-quota"), { recursive: true });
  await mkdir(join(fallbackDir, "opencode-quota"), { recursive: true });

  return [primaryDir, fallbackDir];
}

describe("opencode-go config resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENCODE_GO_WORKSPACE_ID;
    delete process.env.OPENCODE_GO_AUTH_COOKIE;
  });

  afterEach(async () => {
    process.env = originalEnv;
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes the legacy single-account file format", async () => {
    const [configDir] = await createConfigDirs();
    const configPath = getConfigPath(configDir);
    runtimePathMocks.getOpencodeRuntimeDirCandidates.mockReturnValue({ configDirs: [configDir] });
    await writeFile(
      configPath,
      JSON.stringify({
        workspaceId: " ws-legacy ",
        authCookie: " cookie-legacy ",
        apiKey: " key-legacy ",
      }),
    );

    const { resolveOpenCodeGoConfig } = await import("../src/lib/opencode-go-config.js");

    await expect(resolveOpenCodeGoConfig()).resolves.toEqual({
      state: "configured",
      source: configPath,
      config: {
        accounts: [
          {
            id: "default",
            workspaceId: "ws-legacy",
            authCookie: "cookie-legacy",
            apiKey: "key-legacy",
          },
        ],
      },
    });
  });

  it("loads and trims multiple named accounts", async () => {
    const [configDir] = await createConfigDirs();
    const configPath = getConfigPath(configDir);
    runtimePathMocks.getOpencodeRuntimeDirCandidates.mockReturnValue({ configDirs: [configDir] });
    await writeFile(
      configPath,
      JSON.stringify({
        accounts: [
          {
            id: " personal ",
            label: " Personal ",
            workspaceId: " ws-1 ",
            authCookie: " ck-1 ",
            apiKey: " key-1 ",
          },
          { id: "backup", workspaceId: "ws-2", authCookie: "ck-2" },
        ],
      }),
    );

    const { getOpenCodeGoConfigDiagnostics, resolveOpenCodeGoConfig } =
      await import("../src/lib/opencode-go-config.js");

    await expect(resolveOpenCodeGoConfig()).resolves.toEqual({
      state: "configured",
      source: configPath,
      config: {
        accounts: [
          {
            id: "personal",
            label: "Personal",
            workspaceId: "ws-1",
            authCookie: "ck-1",
            apiKey: "key-1",
          },
          { id: "backup", workspaceId: "ws-2", authCookie: "ck-2" },
        ],
      },
    });
    await expect(getOpenCodeGoConfigDiagnostics()).resolves.toMatchObject({
      state: "configured",
      accountCount: 2,
    });
  });

  it("keeps the environment pair as the highest-priority default account", async () => {
    const [configDir] = await createConfigDirs();
    runtimePathMocks.getOpencodeRuntimeDirCandidates.mockReturnValue({ configDirs: [configDir] });
    process.env.OPENCODE_GO_WORKSPACE_ID = "ws-env";
    process.env.OPENCODE_GO_AUTH_COOKIE = "cookie-env";

    const { resolveOpenCodeGoConfig } = await import("../src/lib/opencode-go-config.js");

    await expect(resolveOpenCodeGoConfig()).resolves.toEqual({
      state: "configured",
      source: "env",
      config: {
        accounts: [{ id: "default", workspaceId: "ws-env", authCookie: "cookie-env" }],
      },
    });
  });

  it("reports an account-specific missing field", async () => {
    const [configDir] = await createConfigDirs();
    const configPath = getConfigPath(configDir);
    runtimePathMocks.getOpencodeRuntimeDirCandidates.mockReturnValue({ configDirs: [configDir] });
    await writeFile(
      configPath,
      JSON.stringify({ accounts: [{ id: "backup", workspaceId: "ws-2" }] }),
    );

    const { resolveOpenCodeGoConfig } = await import("../src/lib/opencode-go-config.js");

    await expect(resolveOpenCodeGoConfig()).resolves.toEqual({
      state: "incomplete",
      source: configPath,
      missing: "accounts[0].authCookie",
    });
  });

  it.each([
    [{ accounts: [] }, "accounts must contain at least one account"],
    [
      {
        accounts: [{ id: "one", workspaceId: "ws-1", authCookie: "ck-1", apiKey: 123 }],
      },
      "accounts[0].apiKey must be a string",
    ],
    [
      {
        accounts: [{ id: "one", workspaceId: "ws-1", authCookie: "ck-1", apiKey: "  " }],
      },
      "accounts[0].apiKey must not be empty",
    ],
    [
      {
        accounts: [
          { id: "same", workspaceId: "ws-1", authCookie: "ck-1" },
          { id: "same", workspaceId: "ws-2", authCookie: "ck-2" },
        ],
      },
      "Duplicate account id: same",
    ],
    [
      {
        accounts: [
          { id: "one", label: "Shared", workspaceId: "ws-1", authCookie: "ck-1" },
          { id: "two", label: "Shared", workspaceId: "ws-2", authCookie: "ck-2" },
        ],
      },
      "Duplicate account label: Shared",
    ],
  ])("rejects invalid multi-account config %#", async (contents, error) => {
    const [configDir] = await createConfigDirs();
    const configPath = getConfigPath(configDir);
    runtimePathMocks.getOpencodeRuntimeDirCandidates.mockReturnValue({ configDirs: [configDir] });
    await writeFile(configPath, JSON.stringify(contents));

    const { resolveOpenCodeGoConfig } = await import("../src/lib/opencode-go-config.js");

    await expect(resolveOpenCodeGoConfig()).resolves.toEqual({
      state: "invalid",
      source: configPath,
      error,
    });
  });

  it("stops at the first invalid config file instead of falling through to a lower-priority path", async () => {
    const [primaryDir, fallbackDir] = await createConfigDirs();
    const primaryPath = getConfigPath(primaryDir);
    const fallbackPath = getConfigPath(fallbackDir);

    runtimePathMocks.getOpencodeRuntimeDirCandidates.mockReturnValue({
      configDirs: [primaryDir, fallbackDir],
    });

    await writeFile(primaryPath, "[]");
    await writeFile(
      fallbackPath,
      JSON.stringify({ workspaceId: "ws-fallback", authCookie: "cookie-fallback" }),
    );

    const { resolveOpenCodeGoConfig } = await import("../src/lib/opencode-go-config.js");

    await expect(resolveOpenCodeGoConfig()).resolves.toEqual({
      state: "invalid",
      source: primaryPath,
      error: "Config file must contain a JSON object",
    });
  });

  it("reports invalid config details in diagnostics", async () => {
    const [primaryDir] = await createConfigDirs();
    const primaryPath = getConfigPath(primaryDir);

    runtimePathMocks.getOpencodeRuntimeDirCandidates.mockReturnValue({
      configDirs: [primaryDir],
    });

    await writeFile(primaryPath, "{");

    const { getOpenCodeGoConfigDiagnostics } = await import("../src/lib/opencode-go-config.js");

    await expect(getOpenCodeGoConfigDiagnostics()).resolves.toMatchObject({
      state: "invalid",
      source: primaryPath,
      missing: null,
      checkedPaths: [primaryPath],
    });

    const diagnostics = await getOpenCodeGoConfigDiagnostics();
    expect(diagnostics.error).toContain("Failed to parse JSON:");
  });
});
