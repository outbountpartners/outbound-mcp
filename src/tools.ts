// Tool catalogue for the Outbound Partners MCP server.
// Each tool maps to one v1 API endpoint. The MCP server is a thin proxy.

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  // HTTP plan: how to call the v1 API.
  http: {
    method: 'GET' | 'POST' | 'PATCH';
    pathTemplate: string;             // e.g. '/v1/meetings/{id}'
    pathParams?: string[];            // names that come from input (e.g. ['id'])
    queryParams?: string[];           // names that go in URL ?…
    bodyParams?: string[] | '*';      // names that go in JSON body ('*' = pass all remaining)
  };
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean };
}

const uuidSchema = { type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };

const paginationProps = {
  limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
  offset: { type: 'integer', minimum: 0, default: 0 },
};

const meetingOutcomes = ['scheduled', 'pending', 'completed', 'cancelled', 'no_show', 'rescheduled', 'to_be_rescheduled'];

export const TOOLS: ToolDef[] = [
  // System
  {
    name: 'health',
    description: 'Liveness check for the portal API. No auth required.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    http: { method: 'GET', pathTemplate: '/health' },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'whoami',
    description: 'Returns the label, scopes, and rate limit of the calling API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    http: { method: 'GET', pathTemplate: '/whoami' },
    annotations: { readOnlyHint: true },
  },

  // Meetings
  {
    name: 'meetings_list',
    description: 'List meetings booked by SDRs. Filter by client, SDR, campaign, outcome, date range. Returns normalized fields (sub_status as string[], contact as object, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: uuidSchema,
        sdr_id: uuidSchema,
        campaign_id: uuidSchema,
        outcome: { type: 'string', enum: meetingOutcomes },
        sub_status: { type: 'string', description: 'Partial-match (case-insensitive)' },
        date_from: { type: 'string', description: 'ISO date or datetime' },
        date_to: { type: 'string', description: 'ISO date or datetime' },
        booked_from: { type: 'string', description: 'ISO date' },
        booked_to: { type: 'string', description: 'ISO date' },
        ...paginationProps,
        sort: { type: 'string', default: '-date' },
      },
      additionalProperties: false,
    },
    http: { method: 'GET', pathTemplate: '/v1/meetings', queryParams: ['client_id', 'sdr_id', 'campaign_id', 'outcome', 'sub_status', 'date_from', 'date_to', 'booked_from', 'booked_to', 'limit', 'offset', 'sort'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'meetings_get',
    description: 'Get a single meeting by id.',
    inputSchema: {
      type: 'object',
      properties: { id: uuidSchema },
      required: ['id'],
      additionalProperties: false,
    },
    http: { method: 'GET', pathTemplate: '/v1/meetings/{id}', pathParams: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'meetings_create',
    description: 'Create a new meeting. Requires client_id, campaign_id, date, company_name, contact, and booked_by (or x-acting-user header).',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'ISO-8601 datetime' },
        timezone: { type: 'string', default: 'UTC+00:00' },
        client_id: uuidSchema,
        campaign_id: uuidSchema,
        company_name: { type: 'string' },
        contact: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            title: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
          required: ['name'],
        },
        sdr_id: uuidSchema,
        booked_by: uuidSchema,
        outcome: { type: 'string', enum: meetingOutcomes, default: 'scheduled' },
        sub_status: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        priority: { type: 'string' },
        timeline: { type: 'string' },
        pipeline: {
          type: 'object',
          properties: {
            value: { type: 'number' },
            currency: { type: 'string', enum: ['USD', 'GBP'] },
            status: { type: 'string', enum: ['closed_won', 'closed_lost'] },
          },
        },
      },
      required: ['date', 'client_id', 'campaign_id', 'company_name', 'contact'],
      additionalProperties: false,
    },
    http: { method: 'POST', pathTemplate: '/v1/meetings', bodyParams: '*' },
  },
  {
    name: 'meetings_update',
    description: 'Update a meeting. Partial — only fields you pass are changed. When client_feedback transitions from empty to non-empty, fires admin email notifications automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        id: uuidSchema,
        date: { type: 'string' },
        outcome: { type: 'string', enum: meetingOutcomes },
        sub_status: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        outcome_notes: { type: 'string' },
        client_feedback: { type: 'string' },
        ae_feedback: { type: 'string' },
        priority: { type: 'string' },
        timeline: { type: 'string' },
        challenge: { type: 'string' },
        follow_up: { type: 'string' },
        call_recording_url: { type: 'string' },
        pipeline: {
          type: 'object',
          properties: { value: { type: 'number' }, currency: { type: 'string', enum: ['USD', 'GBP'] }, status: { type: 'string', enum: ['closed_won', 'closed_lost'] } },
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    http: { method: 'PATCH', pathTemplate: '/v1/meetings/{id}', pathParams: ['id'], bodyParams: '*' },
  },
  {
    name: 'meetings_submit_feedback',
    description: 'Convenience tool: write client_feedback to a meeting. Triggers admin email notifications when transitioning empty → non-empty.',
    inputSchema: {
      type: 'object',
      properties: { id: uuidSchema, message: { type: 'string' } },
      required: ['id', 'message'],
      additionalProperties: false,
    },
    // Use the meetings_update endpoint with just client_feedback.
    http: { method: 'PATCH', pathTemplate: '/v1/meetings/{id}', pathParams: ['id'], bodyParams: ['client_feedback'] },
  },

  // Clients
  {
    name: 'clients_list',
    description: 'List clients. Default returns Active only; pass status=Inactive or status=all to see others.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['Active', 'Inactive', 'all'], default: 'Active' },
        client_type: { type: 'string', enum: ['client', 'internal'] },
        industry: { type: 'string' },
        parent_client_id: uuidSchema,
        search: { type: 'string', description: 'ILIKE on name' },
        ...paginationProps,
      },
      additionalProperties: false,
    },
    http: { method: 'GET', pathTemplate: '/v1/clients', queryParams: ['status', 'client_type', 'industry', 'parent_client_id', 'search', 'limit', 'offset'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'clients_get',
    description: 'Get a single client by id, including campaign_count and user_count.',
    inputSchema: { type: 'object', properties: { id: uuidSchema }, required: ['id'], additionalProperties: false },
    http: { method: 'GET', pathTemplate: '/v1/clients/{id}', pathParams: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'clients_create',
    description: 'Create a new client. Requires name, industry, and primary_contact (name/email/phone).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        industry: { type: 'string' },
        primary_contact: {
          type: 'object',
          properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } },
          required: ['name', 'email', 'phone'],
        },
        status: { type: 'string', enum: ['Active', 'Inactive'], default: 'Active' },
        client_type: { type: 'string', enum: ['client', 'internal'], default: 'client' },
        parent_client_id: uuidSchema,
        start_date: { type: 'string' },
        renewal_date: { type: 'string' },
        mrr_gbp: { type: 'number' },
      },
      required: ['name', 'industry', 'primary_contact'],
      additionalProperties: false,
    },
    http: { method: 'POST', pathTemplate: '/v1/clients', bodyParams: '*' },
  },
  {
    name: 'clients_update',
    description: 'Update a client. Useful for status flips, MRR changes, churn capture.',
    inputSchema: {
      type: 'object',
      properties: {
        id: uuidSchema,
        name: { type: 'string' },
        status: { type: 'string', enum: ['Active', 'Inactive'] },
        mrr_gbp: { type: 'number' },
        renewal_date: { type: 'string' },
        renewal_status: { type: 'string', enum: ['Pending', 'Renewed', 'Did not renew'] },
        churn_reason: {
          type: 'string',
          enum: ['Budget cut', 'Internal hire', 'Change in strategy', 'Poor performance', 'Product market shift', 'Timing not right', 'Stakeholder change', 'Procurement or legal delay', 'Moved to competitor', 'Other'],
        },
        churn_reason_notes: { type: 'string' },
        internal_notes: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    http: { method: 'PATCH', pathTemplate: '/v1/clients/{id}', pathParams: ['id'], bodyParams: '*' },
  },

  // Campaigns
  {
    name: 'campaigns_list',
    description: 'List campaigns. Default returns active only; pass status=all to include completed.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: uuidSchema,
        status: { type: 'string', enum: ['active', 'paused', 'completed', 'all'], default: 'active' },
        campaign_type: { type: 'string', enum: ['client', 'internal'] },
        search: { type: 'string' },
        ...paginationProps,
      },
      additionalProperties: false,
    },
    http: { method: 'GET', pathTemplate: '/v1/campaigns', queryParams: ['client_id', 'status', 'campaign_type', 'search', 'limit', 'offset'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'campaigns_get',
    description: 'Get a single campaign with monthly targets/progress maps.',
    inputSchema: { type: 'object', properties: { id: uuidSchema }, required: ['id'], additionalProperties: false },
    http: { method: 'GET', pathTemplate: '/v1/campaigns/{id}', pathParams: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'campaigns_create',
    description: 'Create a new campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        client_id: uuidSchema,
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        overall_target: { type: 'integer', minimum: 0 },
        status: { type: 'string', enum: ['active', 'paused', 'completed'], default: 'active' },
        monthly_meeting_target: { type: 'integer', minimum: 0 },
        monthly_targets: { type: 'object', description: 'Map of YYYY-MM → integer target' },
      },
      required: ['name', 'client_id', 'start_date', 'end_date', 'overall_target'],
      additionalProperties: false,
    },
    http: { method: 'POST', pathTemplate: '/v1/campaigns', bodyParams: '*' },
  },
  {
    name: 'campaigns_update',
    description: 'Update a campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        id: uuidSchema,
        name: { type: 'string' },
        status: { type: 'string', enum: ['active', 'paused', 'completed'] },
        overall_target: { type: 'integer' },
        monthly_meeting_target: { type: 'integer' },
        monthly_targets: { type: 'object' },
        notes: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    http: { method: 'PATCH', pathTemplate: '/v1/campaigns/{id}', pathParams: ['id'], bodyParams: '*' },
  },

  // Users
  {
    name: 'users_list',
    description: 'List portal users. Includes deactivated when is_active=false or all. Default shows active only.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['admin', 'super_admin', 'sdr', 'client_user'] },
        is_active: { type: 'string', enum: ['true', 'false', 'all'], default: 'true' },
        client_id: uuidSchema,
        location: { type: 'string', enum: ['UK', 'SA'] },
        search: { type: 'string' },
        ...paginationProps,
      },
      additionalProperties: false,
    },
    http: { method: 'GET', pathTemplate: '/v1/users', queryParams: ['role', 'is_active', 'client_id', 'location', 'search', 'limit', 'offset'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'users_get',
    description: 'Get a single user with deactivated_at populated from Supabase auth.',
    inputSchema: { type: 'object', properties: { id: uuidSchema }, required: ['id'], additionalProperties: false },
    http: { method: 'GET', pathTemplate: '/v1/users/{id}', pathParams: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'users_invite',
    description: 'Invite a new user (creates invitation row, optionally sends email). Super-admin scope required (users:write).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        role: { type: 'string', enum: ['admin', 'super_admin', 'sdr', 'client_user'] },
        client_id: uuidSchema,
        location: { type: 'string', enum: ['UK', 'SA'] },
        visible_campaign_ids: { type: 'array', items: uuidSchema },
        meetings_only_access: { type: 'boolean' },
        hide_performance_metrics: { type: 'boolean' },
        send_email: { type: 'boolean', default: true },
      },
      required: ['name', 'email', 'role'],
      additionalProperties: false,
    },
    http: { method: 'POST', pathTemplate: '/v1/users', bodyParams: '*' },
  },
  {
    name: 'users_update',
    description: 'Update a user. Setting is_active=false deactivates (routes through Supabase auth). Super-admin scope required.',
    inputSchema: {
      type: 'object',
      properties: {
        id: uuidSchema,
        name: { type: 'string' },
        role: { type: 'string', enum: ['admin', 'super_admin', 'sdr', 'client_user'] },
        is_active: { type: 'boolean' },
        client_id: uuidSchema,
        location: { type: 'string', enum: ['UK', 'SA'] },
        meetings_only_access: { type: 'boolean' },
        hide_performance_metrics: { type: 'boolean' },
        can_view_client_overview: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    http: { method: 'PATCH', pathTemplate: '/v1/users/{id}', pathParams: ['id'], bodyParams: '*' },
  },
  {
    name: 'users_deactivate',
    description: 'Deactivate a user (shorthand for users_update with is_active=false). Bans them in Supabase auth.',
    inputSchema: { type: 'object', properties: { id: uuidSchema }, required: ['id'], additionalProperties: false },
    http: { method: 'PATCH', pathTemplate: '/v1/users/{id}', pathParams: ['id'], bodyParams: [] },
    annotations: { destructiveHint: true },
  },
  {
    name: 'users_reactivate',
    description: 'Reactivate a previously deactivated user (shorthand for users_update with is_active=true).',
    inputSchema: { type: 'object', properties: { id: uuidSchema }, required: ['id'], additionalProperties: false },
    http: { method: 'PATCH', pathTemplate: '/v1/users/{id}', pathParams: ['id'], bodyParams: [] },
  },

  // Leaderboard
  {
    name: 'leaderboard_get',
    description: 'Period-aggregated SDR rankings (dials, meetings booked, meetings seen). Periods: today, yesterday, this_week, last_week, this_month, last_month, this_quarter, last_quarter, this_year, last_year, all_time.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year', 'all_time'], default: 'this_week' },
        location: { type: 'string', enum: ['UK', 'SA'] },
        include_inactive: { type: 'string', enum: ['true', 'false'], default: 'false' },
      },
      additionalProperties: false,
    },
    http: { method: 'GET', pathTemplate: '/v1/leaderboard', queryParams: ['period', 'location', 'include_inactive'] },
    annotations: { readOnlyHint: true },
  },

  // Commission
  {
    name: 'commission_get',
    description: 'Per-SDR monthly target + commission progress. Use targets_only=true for the cheap target-only mode.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
        sdr_id: uuidSchema,
        targets_only: { type: 'string', enum: ['true', 'false'], default: 'false' },
        include_inactive: { type: 'string', enum: ['true', 'false'], default: 'false' },
      },
      additionalProperties: false,
    },
    http: { method: 'GET', pathTemplate: '/v1/commission', queryParams: ['month', 'sdr_id', 'targets_only', 'include_inactive'] },
    annotations: { readOnlyHint: true },
  },
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find(t => t.name === name);
}

// MCP wire format for tools/list.
export function toolsListResponse(): { tools: object[] } {
  return {
    tools: TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    })),
  };
}
