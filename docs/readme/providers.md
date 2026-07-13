# Providers

[← Back to README](../../README.md)

Supported providers and provider-specific setup notes.

## Providers

Most providers work automatically. If a provider has a “Needs setup” link, open that setup note only if you use that provider.

| Provider | Auth/setup | Source | Reports |
| --- | --- | --- | --- |
| Anthropic (Claude) | [Needs setup](#anthropic-claude) | Local CLI/OAuth | Usage/quota |
| GitHub Copilot | OpenCode OAuth or PAT | Remote API | Quota/usage |
| OpenAI | Automatic | Remote API | Usage/quota |
| Cursor | [Needs setup](#cursor) | Local estimate | Estimated quota |
| Qwen Code | [Needs setup](#qwen-code) | Local estimate | Estimated quota |
| Alibaba Coding Plan | OpenCode config | Local estimate | Estimated quota |
| MiniMax Coding Plan | OpenCode config | Remote API | Usage/quota |
| MiniMax Coding Plan (CN) | OpenCode config | Remote API | Usage/quota |
| Kimi Code | OpenCode config | Remote API | Usage/quota |
| Chutes AI | API key/config | Remote API | Usage/quota |
| Synthetic | Automatic | Remote API | Quota |
| Google Antigravity | [Needs setup](#google-antigravity) | Remote API | Usage/quota |
| Google AGY | [Needs setup](#google-agy-quick-setup) | Remote API | Usage/quota |
| Gemini CLI | [Needs setup](#gemini-cli) | Remote API | Usage/quota |
| Z.ai Coding Plan | OpenCode config | Remote API | Usage/quota |
| Zhipu Coding Plan | OpenCode config | Remote API | Usage/quota |
| NanoGPT | API key/config | Remote API | Usage + balance |
| DeepSeek | API key/config | Remote API | Balance/status |
| Ollama Cloud | [Needs setup](#ollama-cloud) | Dashboard scraping | Dashboard usage |
| OpenCode Go | [Needs setup](#opencode-go) | Dashboard scraping | Dashboard usage |

## Provider setup notes

<a id="anthropic-claude"></a>
### Anthropic (Claude)

Install Claude Code, authenticate it, and make sure `claude` is on your `PATH`:

```bash
claude auth login
claude auth status
```

If Claude lives at a custom path, set `anthropicBinaryPath` in `opencode-quota/quota-toast.json`.


<a id="cursor"></a>
### Cursor

Use companion plugin [`@playwo/opencode-cursor-oauth`](https://github.com/PoolPirate/opencode-cursor#readme). Add it before `@slkiser/opencode-quota` in `opencode.json`, then authenticate once:

```bash
opencode auth login --provider cursor
```


<a id="qwen-code"></a>
### Qwen Code

Use companion plugin [`opencode-qwencode-auth`](https://github.com/gustavodiasdev/opencode-qwencode-auth#readme). Add it before `@slkiser/opencode-quota` in `opencode.json`.


<a id="google-antigravity"></a>
### Google Antigravity

Use companion plugin [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth#readme). Add it before `@slkiser/opencode-quota` in `opencode.json`.


<a id="google-agy-quick-setup"></a>
### Google AGY

Use companion plugin [`@anthonyhaussman/opencode-agy-auth`](https://www.npmjs.com/package/@anthonyhaussman/opencode-agy-auth). Add it before `@slkiser/opencode-quota` in `opencode.json`, then authenticate Google once:

```bash
opencode auth login --provider google-agy
```

If you use manual provider selection, include `google-agy` in `enabledProviders`.

```jsonc
{
  "enabledProviders": ["google-agy"],
}
```

If the AGY auth entry does not include a project id, set `OPENCODE_AGY_PROJECT_ID` or `provider.google-agy.options.projectId`.

```jsonc
{
  "provider": {
    "google-agy": {
      "options": {
        "projectId": "your-google-cloud-project"
      }
    }
  }
}
```


<a id="gemini-cli"></a>
### Gemini CLI

Use companion plugin [`opencode-gemini-auth`](https://github.com/jenslys/opencode-gemini-auth#readme). Add it before `@slkiser/opencode-quota` in `opencode.json`, then authenticate Google once:

```bash
opencode auth login --provider google
```

If you use manual provider selection, include `google-gemini-cli` in `enabledProviders`.


<a id="deepseek"></a>
### DeepSeek

DeepSeek shows the current on-demand account balance from `GET https://api.deepseek.com/user/balance`.

Use one of these trusted API-key sources:

```bash
export DEEPSEEK_API_KEY="your-api-key"
```

Or put the key in trusted user/global OpenCode config, not repo-local config:

```jsonc
{
  "provider": {
    "deepseek": {
      "options": { "apiKey": "{env:DEEPSEEK_API_KEY}" },
    },
  },
}
```

If you use manual provider selection, include `deepseek` in `enabledProviders`.


<a id="ollama-cloud"></a>
### Ollama Cloud

Ollama Cloud quota scrapes the Ollama Cloud settings page and needs a `__Secure-session` cookie:

```bash
export OLLAMA_USAGE_COOKIE="your-session-cookie-value"
```

Or use one of these config files (cookie without the `__Secure-session=` prefix, or with — the plugin normalizes it):

- `~/.config/opencode/opencode-quota/ollama-cloud.json`: `{ "cookie": "..." }`
- `~/.config/ollama-usage/config.yaml`: `cookie: "..."`

To find the cookie, open `ollama.com/settings` in your browser, open Developer Tools → Storage → Cookies, and copy the value of `__Secure-session`.


<a id="opencode-go"></a>
### OpenCode Go

OpenCode Go quota scrapes the dashboard and needs a workspace ID plus an `auth` cookie:

```bash
export OPENCODE_GO_WORKSPACE_ID="your-workspace-id"
export OPENCODE_GO_AUTH_COOKIE="your-auth-cookie"
```

For multiple Go subscriptions, create `~/.config/opencode/opencode-quota/opencode-go.json`:

```json
{
  "accounts": [
    {
      "id": "personal",
      "label": "Personal",
      "workspaceId": "your-first-workspace-id",
      "authCookie": "your-first-auth-cookie",
      "apiKey": "your-first-go-api-key"
    },
    {
      "id": "backup",
      "label": "Backup",
      "workspaceId": "your-second-workspace-id",
      "authCookie": "your-second-auth-cookie",
      "apiKey": "your-second-go-api-key"
    }
  ]
}
```

Each `id` and effective display label must be unique. `label` is optional and defaults to `id`. `apiKey` is optional for quota display but required before that account can be selected with `/quota_switch <id>`. The legacy single-account object (`{ "workspaceId": "...", "authCookie": "..." }`) remains supported. The environment variable pair represents one `default` account and takes precedence over the entire file.

Run `/quota_switch personal` to replace OpenCode's active `opencode-go` API credential with the key stored for `personal`. This uses the same OpenCode authentication API as `/connect`, takes effect for new requests, and never includes the API key in command output.

When a configured `apiKey` matches OpenCode's active `opencode-go` credential, `/quota` marks that account header with `[CURRENT]`. The marker is resolved from the latest auth file when the command runs, so it updates immediately after `/quota_switch` even when quota values are still cached.

The browser `auth` cookie and Go API key are sensitive. Keep this file out of source control and restrict it with `chmod 600 ~/.config/opencode/opencode-quota/opencode-go.json`. Each account is queried independently, so an expired cookie does not hide quota from the other accounts.

Use `opencodeGoWindows` to choose **5h**, **Weekly**, and/or **Monthly** windows for all configured accounts.
