import {
  BriefResponseSchema,
  ErrorEnvelopeSchema,
  KpiListResponseSchema,
  MeResponseSchema,
  type BriefResponse,
  type ErrorCode,
  type KpiListResponse,
  type MeResponse,
} from "@orbit/contracts";

interface ContractParser<T> {
  parse(value: unknown): T;
}

export interface BriefPagePayload {
  brief: BriefResponse;
  kpis: KpiListResponse;
  membership: MeResponse;
}

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

async function parseJson(response: Response): Promise<unknown> {
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

async function request<T>(
  path: string,
  accessToken: string,
  schema: ContractParser<T>,
): Promise<T> {
  const url = `${apiBaseUrl()}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new ApiRequestError(
      "unavailable",
      "Orbit could not reach the decision service.",
      503,
    );
  }

  const body = await parseJson(response);

  if (!response.ok) {
    const parsedError = ErrorEnvelopeSchema.safeParse(body);

    if (parsedError.success) {
      throw new ApiRequestError(
        parsedError.data.error.code,
        parsedError.data.error.message,
        response.status,
      );
    }

    throw new ApiRequestError(
      "invalid_response",
      "Orbit received an unexpected error response.",
      response.status,
    );
  }

  try {
    return schema.parse(body);
  } catch {
    throw new ApiRequestError(
      "invalid_response",
      "Orbit received data that did not match the shared contract.",
      response.status,
    );
  }
}

export async function getBriefPagePayload(
  accessToken: string,
): Promise<BriefPagePayload> {
  const [membership, brief, kpis] = await Promise.all([
    request("/api/me", accessToken, MeResponseSchema),
    request("/api/brief", accessToken, BriefResponseSchema),
    request("/api/kpi", accessToken, KpiListResponseSchema),
  ]);

  return { brief, kpis, membership };
}
