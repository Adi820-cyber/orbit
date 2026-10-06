import {
  ActionListResponseSchema,
  ActionDetailResponseSchema,
  ActionResponseSchema,
  AskPromptsResponseSchema,
  AskQuestionRequestSchema,
  AskQuestionResponseSchema,
  AskRequestSchema,
  AskResponseSchema,
  AuditListResponseSchema,
  BriefResponseSchema,
  ChatbotRequestSchema,
  ChatbotResponseSchema,
  CreateActionRequestSchema,
  DelegateActionRequestSchema,
  EntityDirectoryResponseSchema,
  ErrorEnvelopeSchema,
  IdentityResponseSchema,
  InboxResponseSchema,
  KpiDetailQuerySchema,
  KpiDetailResponseSchema,
  KpiListResponseSchema,
  MeResponseSchema,
  OperationsResponseSchema,
  RevenueFeedResponseSchema,
  PermittedAssigneesResponseSchema,
  TransitionActionRequestSchema,
  type AskRequest,
  type CreateActionRequest,
  type DelegateActionRequest,
  type ErrorCode,
  type Grain,
  type KpiDetailQuery,
  type TransitionActionRequest,
} from "@orbit/contracts";
import { createErpClient } from "./erp-api";

export interface ContractParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface ApiRequest {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  query?: URLSearchParams;
  body?: unknown;
}

export interface ApiReply {
  status: number;
  body: unknown;
}

/**
 * Moves one request to the decision service and back. The production
 * transport is HTTP; the dev-only preview swaps in an in-memory fixture so the
 * same contract parsing below runs either way.
 */
export type ApiTransport = (request: ApiRequest) => Promise<ApiReply>;

export class ApiConfigurationError extends Error {
  constructor() {
    super("Orbit's API connection is not configured.");
    this.name = "ApiConfigurationError";
  }
}

export class ApiRequestError extends Error {
  readonly code: ErrorCode | "invalid_response";
  readonly status: number;

  constructor(
    code: ErrorCode | "invalid_response",
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

function apiBaseUrl() {
  const value = import.meta.env.VITE_API_BASE_URL?.trim();

  if (!value) {
    throw new ApiConfigurationError();
  }

  return value.replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiRequestError(
      "invalid_response",
      "Orbit received an unreadable response.",
      response.status,
    );
  }
}

export function httpTransport(accessToken: string): ApiTransport {
  return async (request) => {
    const search = request.query?.toString();
    const url = `${apiBaseUrl()}${request.path}${search ? `?${search}` : ""}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    let response: Response;

    if (request.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    try {
      response = await fetch(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
    } catch {
      throw new ApiRequestError(
        "unavailable",
        "Orbit could not reach the decision service.",
        503,
      );
    }

    return { status: response.status, body: await readJson(response) };
  };
}

function pageQuery(cursor?: string | null) {
  const query = new URLSearchParams();

  if (cursor) {
    query.set("cursor", cursor);
  }

  return query;
}

/** Parses before sending, so the client never emits a payload the contract rejects. */
export function outgoing<T>(schema: ContractParser<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new ApiRequestError(
      "invalid_request",
      "Orbit could not send this request because it is incomplete.",
      400,
    );
  }

  return parsed.data;
}

export function createApiClient(transport: ApiTransport) {
  async function call<T>(request: ApiRequest, schema: ContractParser<T>): Promise<T> {
    const reply = await transport(request);

    if (reply.status >= 400) {
      const parsedError = ErrorEnvelopeSchema.safeParse(reply.body);

      if (parsedError.success) {
        throw new ApiRequestError(
          parsedError.data.error.code,
          parsedError.data.error.message,
          reply.status,
        );
      }

      throw new ApiRequestError(
        "invalid_response",
        "Orbit received an unexpected error response.",
        reply.status,
      );
    }

    const parsed = schema.safeParse(reply.body);

    if (!parsed.success) {
      throw new ApiRequestError(
        "invalid_response",
        "Orbit received data that did not match the shared contract.",
        reply.status,
      );
    }

    return parsed.data;
  }

  return {
    me: () => call({ method: "GET", path: "/api/me" }, MeResponseSchema),
    /** Either account kind: a leader (workbook role) or an ERP operator (ADR 0016). */
    identity: () => call({ method: "GET", path: "/api/me" }, IdentityResponseSchema),
    erp: createErpClient(call),
    brief: () => call({ method: "GET", path: "/api/brief" }, BriefResponseSchema),
    inbox: (cursor?: string | null) =>
      call({ method: "GET", path: "/api/inbox", query: pageQuery(cursor) }, InboxResponseSchema),
    kpiList: () => call({ method: "GET", path: "/api/kpi" }, KpiListResponseSchema),
    kpiDetail: async (assignmentId: string, detail: KpiDetailQuery) => {
      const parsed = outgoing(KpiDetailQuerySchema, detail);
      const query = new URLSearchParams({ grain: parsed.grain, entityId: parsed.entityId });

      if (parsed.breakdown) query.set("breakdown", parsed.breakdown);
      if (parsed.from) query.set("from", parsed.from);
      if (parsed.to) query.set("to", parsed.to);

      return call(
        { method: "GET", path: `/api/kpi/${encodeURIComponent(assignmentId)}`, query },
        KpiDetailResponseSchema,
      );
    },
    operations: (days?: number) =>
      call(
        { method: "GET", path: "/api/operations", ...(days ? { query: new URLSearchParams({ days: String(days) }) } : {}) },
        OperationsResponseSchema,
      ),
    revenue: (days?: number) =>
      call(
        { method: "GET", path: "/api/revenue", ...(days ? { query: new URLSearchParams({ days: String(days) }) } : {}) },
        RevenueFeedResponseSchema,
      ),
    entities: () => call({ method: "GET", path: "/api/entities" }, EntityDirectoryResponseSchema),
    askPrompts: () => call({ method: "GET", path: "/api/ask/prompts" }, AskPromptsResponseSchema),
    askQuestion: async (question: string) =>
      call(
        { method: "POST", path: "/api/ask/question", body: outgoing(AskQuestionRequestSchema, { question }) },
        AskQuestionResponseSchema,
      ),
    ask: async (request: AskRequest) =>
      call(
        { method: "POST", path: "/api/ask", body: outgoing(AskRequestSchema, request) },
        AskResponseSchema,
      ),
    actions: (cursor?: string | null) =>
      call({ method: "GET", path: "/api/actions", query: pageQuery(cursor) }, ActionListResponseSchema),
    action: (actionId: string) =>
      call(
        { method: "GET", path: `/api/actions/${encodeURIComponent(actionId)}` },
        ActionDetailResponseSchema,
      ),
    delegates: (actionId: string) =>
      call(
        { method: "GET", path: `/api/actions/${encodeURIComponent(actionId)}/delegates` },
        PermittedAssigneesResponseSchema,
      ),
    delegateAction: async (actionId: string, request: DelegateActionRequest) =>
      call(
        {
          method: "POST",
          path: `/api/actions/${encodeURIComponent(actionId)}/delegations`,
          body: outgoing(DelegateActionRequestSchema, request),
        },
        ActionResponseSchema,
      ),
    assignees: (target: { assignmentId: string; grain: Grain; entityId: string }) =>
      call(
        {
          method: "GET",
          path: "/api/actions/assignees",
          query: new URLSearchParams(target),
        },
        PermittedAssigneesResponseSchema,
      ),
    createAction: async (request: CreateActionRequest) =>
      call(
        {
          method: "POST",
          path: "/api/actions",
          body: outgoing(CreateActionRequestSchema, request),
        },
        ActionResponseSchema,
      ),
    transitionAction: async (actionId: string, request: TransitionActionRequest) =>
      call(
        {
          method: "POST",
          path: `/api/actions/${encodeURIComponent(actionId)}/transitions`,
          body: outgoing(TransitionActionRequestSchema, request),
        },
        ActionResponseSchema,
      ),
    audit: (cursor?: string | null) =>
      call({ method: "GET", path: "/api/audit", query: pageQuery(cursor) }, AuditListResponseSchema),
    chatbot: async (message: string) =>
      call(
        { method: "POST", path: "/api/chatbot", body: outgoing(ChatbotRequestSchema, { message }) },
        ChatbotResponseSchema,
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
