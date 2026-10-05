import type { z } from 'zod';
import {
  AddScheduleSlotRequestSchema,
  AttendanceBoardResponseSchema,
  AvailabilityResponseSchema,
  CorrectionListResponseSchema,
  CorrectionResponseSchema,
  CreateDoctorRequestSchema,
  CreateServiceRequestSchema,
  CreateStaffRequestSchema,
  DecideCorrectionRequestSchema,
  DeliveryResponseSchema,
  DoctorListResponseSchema,
  DoctorResponseSchema,
  EncounterListResponseSchema,
  EncounterResponseSchema,
  ErpReferenceResponseSchema,
  ErrorEnvelopeSchema,
  OpenEncounterRequestSchema,
  PatientResponseSchema,
  PatientSearchResponseSchema,
  RecordDeliveryRequestSchema,
  RecordPunchRequestSchema,
  RecordPunchResponseSchema,
  RegisterPatientRequestSchema,
  RequestCorrectionRequestSchema,
  RosterDayResponseSchema,
  ScheduleSlotResponseSchema,
  ServiceCatalogueResponseSchema,
  ServiceResponseSchema,
  SetAvailabilityRequestSchema,
  SetRosterRequestSchema,
  SetRosterResponseSchema,
  StaffListResponseSchema,
  StaffResponseSchema,
  UpdateDoctorRequestSchema,
  UpdateEncounterRequestSchema,
} from '@orbit/contracts';
import type { TokenSource } from './auth.ts';

/*
 * The simulator's view of the ERP API. It is the same HTTP API the web app
 * uses: every request is parsed against `@orbit/contracts` before it is sent
 * and every response after it arrives, so the simulator can never write
 * something the API contract would refuse, and a contract change fails loudly.
 *
 * It signs in as a real operator account. Role, facility and scope are decided
 * by the API from that login (never sent by the client), so what the simulator
 * may do is exactly what that account may do.
 */

export class SimApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  constructor(message: string, status: number, code: string, requestId: string | null) {
    super(message);
    this.name = 'SimApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

type Input<S extends z.ZodType> = z.input<S>;

/** What the engine needs from the ERP, so tests can stand in a fake. */
export interface ErpApi {
  reference(): Promise<z.infer<typeof ErpReferenceResponseSchema>>;
  board(query: { facilityId: string; date: string }): Promise<z.infer<typeof AttendanceBoardResponseSchema>>;
  roster(query: { facilityId: string; date: string }): Promise<z.infer<typeof RosterDayResponseSchema>>;
  setRoster(body: Input<typeof SetRosterRequestSchema>): Promise<z.infer<typeof SetRosterResponseSchema>>;
  punch(body: Input<typeof RecordPunchRequestSchema>): Promise<z.infer<typeof RecordPunchResponseSchema>>;
  corrections(query: Query): Promise<z.infer<typeof CorrectionListResponseSchema>>;
  requestCorrection(body: Input<typeof RequestCorrectionRequestSchema>): Promise<z.infer<typeof CorrectionResponseSchema>>;
  decideCorrection(correctionId: string, body: Input<typeof DecideCorrectionRequestSchema>): Promise<z.infer<typeof CorrectionResponseSchema>>;
  doctors(query: Query): Promise<z.infer<typeof DoctorListResponseSchema>>;
  updateDoctor(staffId: string, body: Input<typeof UpdateDoctorRequestSchema>): Promise<z.infer<typeof DoctorResponseSchema>>;
  services(query: Query): Promise<z.infer<typeof ServiceCatalogueResponseSchema>>;
  patients(query: Query): Promise<z.infer<typeof PatientSearchResponseSchema>>;
  registerPatient(body: Input<typeof RegisterPatientRequestSchema>): Promise<z.infer<typeof PatientResponseSchema>>;
  openEncounter(body: Input<typeof OpenEncounterRequestSchema>): Promise<z.infer<typeof EncounterResponseSchema>>;
  encounters(query: Query): Promise<z.infer<typeof EncounterListResponseSchema>>;
  updateEncounter(encounterId: string, body: Input<typeof UpdateEncounterRequestSchema>): Promise<z.infer<typeof EncounterResponseSchema>>;
  recordDelivery(encounterId: string, body: Input<typeof RecordDeliveryRequestSchema>): Promise<z.infer<typeof DeliveryResponseSchema>>;
  // Used only to set up an empty hospital (bootstrap.ts).
  staff(query: Query): Promise<z.infer<typeof StaffListResponseSchema>>;
  createStaff(body: Input<typeof CreateStaffRequestSchema>): Promise<z.infer<typeof StaffResponseSchema>>;
  createDoctor(body: Input<typeof CreateDoctorRequestSchema>): Promise<z.infer<typeof DoctorResponseSchema>>;
  addScheduleSlot(staffId: string, body: Input<typeof AddScheduleSlotRequestSchema>): Promise<z.infer<typeof ScheduleSlotResponseSchema>>;
  createService(body: Input<typeof CreateServiceRequestSchema>): Promise<z.infer<typeof ServiceResponseSchema>>;
  setAvailability(facilityId: string, serviceId: string, body: Input<typeof SetAvailabilityRequestSchema>): Promise<z.infer<typeof AvailabilityResponseSchema>>;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createErpApi(options: {
  baseUrl: string;
  tokens: TokenSource;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Delays between retries; overridden in tests. */
  retryDelaysMs?: readonly number[];
}): ErpApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retryDelays = options.retryDelaysMs ?? [500, 2000];

  /**
   * One request. `retry` is only set for calls that are safe to repeat: reads,
   * and writes carrying an idempotency key (a repeat is a replay, never a
   * duplicate).
   */
  async function call<S extends z.ZodType>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    schema: S,
    extra: { query?: Query; body?: unknown; retry: boolean },
  ): Promise<z.infer<S>> {
    const url = new URL(`${options.baseUrl}${path}`);
    for (const [key, value] of Object.entries(extra.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    let reauthenticated = false;
    for (let attempt = 0; ; attempt += 1) {
      // Signing in is outside the network guard: a sign-in problem must surface as one, not as "unreachable".
      const token = await options.tokens.token();
      let response: Response | null = null;
      let networkFailure = false;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(extra.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(extra.body === undefined ? {} : { body: JSON.stringify(extra.body) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        networkFailure = true;
      }

      if (response?.status === 401 && !reauthenticated) {
        reauthenticated = true;
        options.tokens.invalidate();
        continue;
      }
      const delay = retryDelays[attempt];
      if (extra.retry && delay !== undefined && (networkFailure || (response && RETRYABLE_STATUS.has(response.status)))) {
        await sleep(delay);
        continue;
      }
      if (!response) {
        throw new SimApiError('The ERP API could not be reached', 0, 'unreachable', null);
      }

      const text = await response.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (!response.ok) {
        const envelope = ErrorEnvelopeSchema.safeParse(json);
        throw envelope.success
          ? new SimApiError(envelope.data.error.message, response.status, envelope.data.error.code, envelope.data.error.requestId)
          : new SimApiError(`The ERP API answered ${response.status}`, response.status, 'unexpected', null);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new SimApiError('The ERP API response did not match the shared contract', 502, 'invalid_response', null);
      }
      return parsed.data;
    }
  }

  const get = <S extends z.ZodType>(path: string, schema: S, query?: Query) => call('GET', path, schema, { ...(query ? { query } : {}), retry: true });
  // async so that a body the contract rejects is a rejected promise, like every other failure, never a synchronous throw.
  const send = async <B extends z.ZodType, S extends z.ZodType>(
    method: 'POST' | 'PATCH' | 'PUT',
    path: string,
    bodySchema: B,
    body: unknown,
    schema: S,
    retry = false,
  ) => call(method, path, schema, { body: bodySchema.parse(body), retry });
  const id = encodeURIComponent;

  return {
    reference: () => get('/api/erp/reference', ErpReferenceResponseSchema),
    board: (query) => get('/api/erp/attendance/board', AttendanceBoardResponseSchema, query),
    roster: (query) => get('/api/erp/rosters', RosterDayResponseSchema, query),
    setRoster: (body) => send('PUT', '/api/erp/rosters', SetRosterRequestSchema, body, SetRosterResponseSchema),
    punch: (body) => send('POST', '/api/erp/attendance/punches', RecordPunchRequestSchema, body, RecordPunchResponseSchema, true),
    corrections: (query) => get('/api/erp/attendance/corrections', CorrectionListResponseSchema, query),
    requestCorrection: (body) => send('POST', '/api/erp/attendance/corrections', RequestCorrectionRequestSchema, body, CorrectionResponseSchema),
    decideCorrection: (correctionId, body) =>
      send('POST', `/api/erp/attendance/corrections/${id(correctionId)}/decision`, DecideCorrectionRequestSchema, body, CorrectionResponseSchema),
    doctors: (query) => get('/api/erp/doctors', DoctorListResponseSchema, query),
    updateDoctor: (staffId, body) => send('PATCH', `/api/erp/doctors/${id(staffId)}`, UpdateDoctorRequestSchema, body, DoctorResponseSchema),
    services: (query) => get('/api/erp/services', ServiceCatalogueResponseSchema, query),
    patients: (query) => get('/api/erp/patients', PatientSearchResponseSchema, query),
    registerPatient: (body) => send('POST', '/api/erp/patients', RegisterPatientRequestSchema, body, PatientResponseSchema),
    openEncounter: (body) => send('POST', '/api/erp/encounters', OpenEncounterRequestSchema, body, EncounterResponseSchema),
    encounters: (query) => get('/api/erp/encounters', EncounterListResponseSchema, query),
    updateEncounter: (encounterId, body) =>
      send('PATCH', `/api/erp/encounters/${id(encounterId)}`, UpdateEncounterRequestSchema, body, EncounterResponseSchema),
    recordDelivery: (encounterId, body) =>
      send('POST', `/api/erp/encounters/${id(encounterId)}/services`, RecordDeliveryRequestSchema, body, DeliveryResponseSchema, true),
    staff: (query) => get('/api/erp/staff', StaffListResponseSchema, query),
    createStaff: (body) => send('POST', '/api/erp/staff', CreateStaffRequestSchema, body, StaffResponseSchema),
    createDoctor: (body) => send('POST', '/api/erp/doctors', CreateDoctorRequestSchema, body, DoctorResponseSchema),
    addScheduleSlot: (staffId, body) =>
      send('POST', `/api/erp/doctors/${id(staffId)}/schedule`, AddScheduleSlotRequestSchema, body, ScheduleSlotResponseSchema),
    createService: (body) => send('POST', '/api/erp/services', CreateServiceRequestSchema, body, ServiceResponseSchema),
    setAvailability: (facilityId, serviceId, body) =>
      send('PUT', `/api/erp/facilities/${id(facilityId)}/services/${id(serviceId)}`, SetAvailabilityRequestSchema, body, AvailabilityResponseSchema),
  };
}
