// MCP server — Streamable HTTP transport, JSON-RPC 2.0.
// Exposes the v1 portal API as a tool catalogue for LLM agents
// (Claude Desktop, ChatGPT, n8n, Anthropic/OpenAI APIs, etc.).
//
// Auth: the MCP client sends a Portal API key via:
//   - x-api-key header (preferred)
//   - or Authorization: Bearer <key>
// We forward the key to the v1 API on every tool call.
//
// Reference: Model Context Protocol 2025-06-18 (streamable HTTP).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { TOOLS, findTool, toolsListResponse, type ToolDef } from "./tools.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, x-acting-user, content-type, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

const API_BASE = `${Deno.env.get('SUPABASE_URL')}/functions/v1/api`;
const MCP_PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'outbound-partners-mcp', version: '1.0.0' };

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 helpers
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: number | string | null | undefined, result: unknown): object {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: number | string | null | undefined, code: number, message: string, data?: unknown): object {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// ---------------------------------------------------------------------------
// API key extraction (from headers)
// ---------------------------------------------------------------------------

function extractApiKey(req: Request): string | null {
  const x = req.headers.get('x-api-key');
  if (x) return x;
  const authz = req.headers.get('authorization');
  if (authz?.startsWith('Bearer ')) return authz.slice(7);
  return null;
}

// ---------------------------------------------------------------------------
// Tool invocation — translate the MCP call into an HTTP request to /api/v1/*
// ---------------------------------------------------------------------------

interface ToolCallResult {
  status: number;
  body: unknown;
  isError: boolean;
}

async function invokeTool(tool: ToolDef, args: Record<string, unknown>, apiKey: string, actingUser: string | null): Promise<ToolCallResult> {
  // Resolve path
  let path = tool.http.pathTemplate;
  if (tool.http.pathParams) {
    for (const param of tool.http.pathParams) {
      const value = args[param];
      if (typeof value !== 'string') {
        return { status: 400, body: { error: { code: 'invalid_argument', message: `Missing or invalid path param: ${param}` } }, isError: true };
      }
      path = path.replace(`{${param}}`, encodeURIComponent(value));
    }
  }

  // Query string
  const url = new URL(`${API_BASE}${path}`);
  const usedKeys = new Set<string>(tool.http.pathParams ?? []);
  if (tool.http.queryParams) {
    for (const param of tool.http.queryParams) {
      const value = args[param];
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(param, String(value));
      usedKeys.add(param);
    }
  }

  // Body
  let body: BodyInit | undefined;
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
  };
  if (actingUser) headers['x-acting-user'] = actingUser;

  if (tool.http.bodyParams) {
    let bodyObj: Record<string, unknown> = {};
    if (tool.http.bodyParams === '*') {
      for (const [k, v] of Object.entries(args)) {
        if (!usedKeys.has(k)) bodyObj[k] = v;
      }
    } else {
      for (const param of tool.http.bodyParams) {
        if (args[param] !== undefined) bodyObj[param] = args[param];
      }
    }
    body = JSON.stringify(bodyObj);
  }

  try {
    const resp = await fetch(url.toString(), { method: tool.http.method, headers, body });
    const text = await resp.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    return { status: resp.status, body: parsed, isError: !resp.ok };
  } catch (err) {
    return {
      status: 502,
      body: { error: { code: 'upstream_error', message: (err as Error).message } },
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// MCP method handlers
// ---------------------------------------------------------------------------

async function handleRpcMessage(msg: JsonRpcRequest, apiKey: string | null, actingUser: string | null): Promise<object | null> {
  switch (msg.method) {
    case 'initialize': {
      return rpcResult(msg.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: {
          tools: { listChanged: false },
        },
        instructions:
          'Outbound Partners portal API as MCP tools. Each tool maps to a v1 REST endpoint. ' +
          'Authentication is via the x-api-key (or Authorization: Bearer) header set on the MCP connection. ' +
          'Scopes are enforced server-side per the underlying API key.',
      });
    }

    case 'notifications/initialized':
    case 'initialized':
      // Notification — no response.
      return null;

    case 'ping':
      return rpcResult(msg.id, {});

    case 'tools/list':
      return rpcResult(msg.id, toolsListResponse());

    case 'tools/call': {
      if (!apiKey) {
        return rpcError(msg.id, -32001, 'Authentication required: pass your Portal API key via x-api-key header or Authorization: Bearer.');
      }
      const params = msg.params ?? {};
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const tool = findTool(name);
      if (!tool) {
        return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      }
      const result = await invokeTool(tool, args, apiKey, actingUser);
      // MCP content envelope: text content with the JSON payload.
      return rpcResult(msg.id, {
        content: [
          {
            type: 'text',
            text: typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2),
          },
        ],
        isError: result.isError,
        structuredContent: typeof result.body === 'object' && result.body !== null ? result.body : undefined,
      });
    }

    case 'resources/list':
      return rpcResult(msg.id, { resources: [] });

    case 'prompts/list':
      return rpcResult(msg.id, { prompts: [] });

    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname;

  // Discovery endpoint — useful for humans poking the URL.
  if (req.method === 'GET' && (path.endsWith('/mcp') || path.endsWith('/mcp/'))) {
    return jsonResponse({
      ok: true,
      message: 'Outbound Partners MCP server',
      protocol: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      server: SERVER_INFO,
      auth: { header: 'x-api-key', alternative: 'Authorization: Bearer <key>' },
      tool_count: TOOLS.length,
      docs: 'https://github.com/outbountpartners/outbound-mcp',
    });
  }

  // /tools convenience: return the tool catalogue without going through JSON-RPC.
  if (req.method === 'GET' && path.endsWith('/tools')) {
    return jsonResponse(toolsListResponse());
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST required for MCP JSON-RPC messages' }, 405);
  }

  const apiKey = extractApiKey(req);
  const actingUser = req.headers.get('x-acting-user');

  // Parse body — supports both single message and JSON-RPC batch.
  let body: unknown;
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : null;
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'), 400);
  }

  if (!body) return jsonResponse(rpcError(null, -32600, 'Invalid Request'), 400);

  // Batch handling
  if (Array.isArray(body)) {
    const responses: object[] = [];
    for (const msg of body) {
      if (typeof msg !== 'object' || msg === null) {
        responses.push(rpcError(null, -32600, 'Invalid Request'));
        continue;
      }
      const result = await handleRpcMessage(msg as JsonRpcRequest, apiKey, actingUser);
      if (result) responses.push(result);
    }
    // All-notifications batch → 204
    if (responses.length === 0) return new Response(null, { status: 204, headers: corsHeaders });
    return jsonResponse(responses);
  }

  // Single message
  const msg = body as JsonRpcRequest;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return jsonResponse(rpcError(msg.id, -32600, 'Invalid Request'), 400);
  }

  const result = await handleRpcMessage(msg, apiKey, actingUser);
  if (!result) return new Response(null, { status: 204, headers: corsHeaders });

  return jsonResponse(result);
});
