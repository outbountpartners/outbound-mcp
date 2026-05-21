# outbound-mcp

**MCP server for the Outbound Partners Portal API.** Cross-provider — works with Claude Desktop, Claude Code, ChatGPT, n8n, and anything else that speaks the Model Context Protocol (2025-06-18 spec, Streamable HTTP transport).

## What it does

Exposes the [Outbound Partners Portal v1 API](https://github.com/outbountpartners/outbound-api-spec) as a tool catalogue an LLM agent can call. The server is a thin proxy: it receives the user's Portal API key at session-init, forwards calls to the v1 API, and returns the JSON response wrapped in the MCP content envelope.

## Live endpoint

```
https://sirhkzqpdgarrcyqnjtl.supabase.co/functions/v1/mcp
```

- **GET** for discovery / health (no auth needed)
- **GET /mcp/tools** for the raw tool catalogue (no auth needed)
- **POST** for JSON-RPC 2.0 messages (auth required for `tools/call`)

Browse the discovery URL to see protocol version, server info, transport, and tool count.

## Tools

23 tools across 6 resources. Each tool maps to one v1 API endpoint:

| Resource | Tools |
|---|---|
| **System** | `health`, `whoami` |
| **Meetings** | `meetings_list`, `meetings_get`, `meetings_create`, `meetings_update`, `meetings_submit_feedback` |
| **Clients** | `clients_list`, `clients_get`, `clients_create`, `clients_update` |
| **Campaigns** | `campaigns_list`, `campaigns_get`, `campaigns_create`, `campaigns_update` |
| **Users** | `users_list`, `users_get`, `users_invite`, `users_update`, `users_deactivate`, `users_reactivate` |
| **Leaderboard** | `leaderboard_get` |
| **Commission** | `commission_get` |

Each carries:
- Full JSON Schema for arguments (validated server-side too)
- `annotations.readOnlyHint: true` on GET-style tools
- `annotations.destructiveHint: true` on `users_deactivate` so compliant clients prompt before invoking

## Authentication

Get a Portal API key from the `/api` admin page inside the portal (admin/super_admin only). Pass it on every MCP request via:

- `x-api-key: opk_live_...` header (preferred)
- or `Authorization: Bearer opk_live_...`

Scopes are enforced server-side by the v1 API based on the key's permissions. If your key lacks a scope, you'll get a `403 insufficient_scope` error from the underlying API surfaced through the MCP response.

## Connect from clients

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "outbound-partners": {
      "url": "https://sirhkzqpdgarrcyqnjtl.supabase.co/functions/v1/mcp",
      "transport": "http",
      "headers": {
        "x-api-key": "opk_live_..."
      }
    }
  }
}
```

### ChatGPT (with MCP support)

In the GPT or workspace settings, add a Custom MCP server:

- URL: `https://sirhkzqpdgarrcyqnjtl.supabase.co/functions/v1/mcp`
- Header: `x-api-key: opk_live_...`

### n8n

The n8n MCP node accepts the URL + headers directly. Drop in an `MCP Client` node, set the URL, add the `x-api-key` header.

### Programmatic (Anthropic / OpenAI SDK)

```python
# Claude
from anthropic import Anthropic
client = Anthropic()
response = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Show me the leaderboard"}],
    mcp_servers=[{
        "type": "url",
        "url": "https://sirhkzqpdgarrcyqnjtl.supabase.co/functions/v1/mcp",
        "name": "outbound",
        "authorization_token": "opk_live_..."
    }]
)
```

## Quick smoke test

```bash
# Discovery
curl https://sirhkzqpdgarrcyqnjtl.supabase.co/functions/v1/mcp

# Initialize handshake
curl -X POST -H 'Content-Type: application/json' -H 'x-api-key: opk_live_...' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  https://sirhkzqpdgarrcyqnjtl.supabase.co/functions/v1/mcp

# List tools
curl -X POST -H 'Content-Type: application/json' -H 'x-api-key: opk_live_...' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  https://sirhkzqpdgarrcyqnjtl.supabase.co/functions/v1/mcp

# Call a tool
curl -X POST -H 'Content-Type: application/json' -H 'x-api-key: opk_live_...' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"leaderboard_get","arguments":{"period":"this_week"}}}' \
  https://sirhkzqpdgarrcyqnjtl.supabase.co/functions/v1/mcp
```

## Architecture

The canonical source lives in [`outbound-partners-client-dashboard`](https://github.com/outbountpartners/outbound-partners-client-dashboard) under `supabase/functions/mcp/`. This repo is a public mirror updated when the canonical source changes.

```
LLM client (Claude / ChatGPT / n8n)
    │ JSON-RPC over HTTP POST
    ▼
mcp edge function (this code)
    │ HTTP forwarding (x-api-key passed through)
    ▼
api edge function (/v1/* router)
    │
    ▼
Supabase Postgres
```

Zero new infra — runs on Supabase's existing edge runtime (Deno). No env vars to configure beyond what Supabase auto-injects.

## Self-host

Want to deploy your own instance? Drop `src/index.ts` and `src/tools.ts` into a Supabase edge function (or any Deno HTTP server) and point `API_BASE` at your v1 API. The MCP layer is stateless — no DB schema, no secrets of its own.

## Source

- [`src/index.ts`](./src/index.ts) — HTTP server + JSON-RPC 2.0 dispatcher + tool invocation
- [`src/tools.ts`](./src/tools.ts) — Tool catalogue with JSON Schema inputs

## Versioning

Current MCP protocol version: `2025-06-18`. Server version: `1.0.0`.

## Maintainer

Rai — rai@outboundpartners.com
