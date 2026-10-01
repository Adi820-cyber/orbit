import { z } from 'zod';
import {
  ErpDateSchema,
  ErpDisclosureFields,
  ErpInstantSchema,
  ErpPageQuerySchema,
  ErpPageSchema,
  ErpVersionSchema,
} from './erp-common.ts';
import { ServiceCategorySchema, ServiceUnitSchema } from './erp-services.ts';

/*
 * Patients, visits (encounters) and the services delivered in them
 * (ERP_PLAN §5.1, §5.4). Synthetic and minimal: birth YEAR only, no contact
 * details, identifiers, insurance or clinical content of any kind. Every
 * patient read is audited (ERP_PLAN §7.3).
 */

export const SexSchema = z.enum(['female', 'male', 'other', 'unknown']);
export type Sex = z.infer<typeof SexSchema>;

export const PatientStatusSchema = z.enum(['active', 'inactive', 'deceased']);
export type PatientStatus = z.infer<typeof PatientStatusSchema>;

export const EncounterTypeSchema = z.enum(['outpatient', 'inpatient', 'emergency', 'day-care']);
export type EncounterType = z.infer<typeof EncounterTypeSchema>;

export const EncounterStatusSchema = z.enum(['open', 'closed', 'cancelled']);
export type EncounterStatus = z.infer<typeof EncounterStatusSchema>;

export const DeliveryStatusSchema = z.enum(['completed', 'cancelled']);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

const PatientNameSchema = z.string().trim().min(1).max(120);
const BirthYearSchema = z.number().int().min(1900).max(2100);

export const PatientSchema = z.strictObject({
  patientId: z.uuid(),
  /** Generated, visibly fictional (DEMO-MRN-…). */
  mrn: z.string().min(1),
  displayName: z.string().min(1),
  sex: SexSchema,
  birthYear: z.number().int(),
  status: PatientStatusSchema,
  homeFacilityId: z.uuid(),
  createdAt: ErpInstantSchema,
  version: ErpVersionSchema,
});
export type Patient = z.infer<typeof PatientSchema>;

/**
 * `GET /api/erp/patients`. Search only — there is no "list every patient"
 * endpoint. `q` matches a name fragment or an MRN.
 */
export const PatientSearchQuerySchema = ErpPageQuerySchema.extend({
  q: z.string().trim().min(2).max(60),
});
export type PatientSearchQuery = z.infer<typeof PatientSearchQuerySchema>;

export const PatientSearchResponseSchema = z.strictObject({
  items: z.array(PatientSchema),
  page: ErpPageSchema,
  ...ErpDisclosureFields,
});
export type PatientSearchResponse = z.infer<typeof PatientSearchResponseSchema>;

/**
 * `POST /api/erp/patients`. A visible patient with the same name and birth
 * year is answered with 409 unless `confirmNotDuplicate` is true: possible
 * duplicates are surfaced to a person, never merged automatically.
 */
export const RegisterPatientRequestSchema = z.strictObject({
  homeFacilityId: z.uuid(),
  displayName: PatientNameSchema,
  sex: SexSchema,
  birthYear: BirthYearSchema,
  confirmNotDuplicate: z.boolean().default(false),
});
export type RegisterPatientRequest = z.infer<typeof RegisterPatientRequestSchema>;

export const UpdatePatientRequestSchema = z.strictObject({
  version: ErpVersionSchema,
  displayName: PatientNameSchema.optional(),
  sex: SexSchema.optional(),
  birthYear: BirthYearSchema.optional(),
  status: PatientStatusSchema.optional(),
});
export type UpdatePatientRequest = z.infer<typeof UpdatePatientRequestSchema>;

export const PatientParamsSchema = z.strictObject({ patientId: z.uuid() });

export const EncounterSchema = z.strictObject({
  encounterId: z.uuid(),
  patientId: z.uuid(),
  facilityId: z.uuid(),
  departmentId: z.uuid(),
  attendingDoctorId: z.uuid().nullable(),
  attendingDoctorName: z.string().nullable(),
  encounterType: EncounterTypeSchema,
  status: EncounterStatusSchema,
  startedAt: ErpInstantSchema,
  endedAt: ErpInstantSchema.nullable(),
  version: ErpVersionSchema,
});
export type Encounter = z.infer<typeof EncounterSchema>;

export const PatientResponseSchema = z.strictObject({
  patient: PatientSchema,
  ...ErpDisclosureFields,
});
export type PatientResponse = z.infer<typeof PatientResponseSchema>;

/** `GET /api/erp/patients/:patientId` — the patient and the visits the caller can see. */
export const PatientDetailResponseSchema = z.strictObject({
  patient: PatientSchema,
  encounters: z.array(EncounterSchema),
  ...ErpDisclosureFields,
});
export type PatientDetailResponse = z.infer<typeof PatientDetailResponseSchema>;

export const EncounterListQuerySchema = ErpPageQuerySchema.extend({
  facilityId: z.uuid().optional(),
  status: EncounterStatusSchema.optional(),
  encounterType: EncounterTypeSchema.optional(),
  /** Visits started on this date (facility-local). */
  date: ErpDateSchema.optional(),
});
export type EncounterListQuery = z.infer<typeof EncounterListQuerySchema>;

export const EncounterListItemSchema = z.strictObject({
  encounter: EncounterSchema,
  patientName: z.string().min(1),
  mrn: z.string().min(1),
});
export type EncounterListItem = z.infer<typeof EncounterListItemSchema>;

export const EncounterListResponseSchema = z.strictObject({
  items: z.array(EncounterListItemSchema),
  page: ErpPageSchema,
  ...ErpDisclosureFields,
});
export type EncounterListResponse = z.infer<typeof EncounterListResponseSchema>;

/** `POST /api/erp/encounters`. `startedAt` defaults to now; it may not be in the future. */
export const OpenEncounterRequestSchema = z.strictObject({
  patientId: z.uuid(),
  facilityId: z.uuid(),
  departmentId: z.uuid(),
  encounterType: EncounterTypeSchema,
  attendingDoctorId: z.uuid().optional(),
  startedAt: ErpInstantSchema.optional(),
});
export type OpenEncounterRequest = z.infer<typeof OpenEncounterRequestSchema>;

/**
 * `PATCH /api/erp/encounters/:encounterId`. Closing needs no `endedAt` (it
 * defaults to now); cancelling an encounter with completed services is refused.
 */
export const UpdateEncounterRequestSchema = z.strictObject({
  version: ErpVersionSchema,
  status: z.enum(['closed', 'cancelled']).optional(),
  endedAt: ErpInstantSchema.optional(),
  attendingDoctorId: z.uuid().nullable().optional(),
});
export type UpdateEncounterRequest = z.infer<typeof UpdateEncounterRequestSchema>;

export const EncounterParamsSchema = z.strictObject({ encounterId: z.uuid() });

export const ServiceDeliverySchema = z.strictObject({
  deliveryId: z.uuid(),
  encounterId: z.uuid(),
  serviceId: z.uuid(),
  serviceCode: z.string().min(1),
  serviceName: z.string().min(1),
  category: ServiceCategorySchema,
  unit: ServiceUnitSchema,
  performedByStaffId: z.uuid(),
  performedByName: z.string().min(1),
  quantity: z.number().int().min(1),
  performedAt: ErpInstantSchema,
  status: DeliveryStatusSchema,
  /** Quantity × the facility's illustrative tariff, when one is configured. Never a real charge. */
  illustrativeAmount: z.number().nonnegative().nullable(),
  version: ErpVersionSchema,
});
export type ServiceDelivery = z.infer<typeof ServiceDeliverySchema>;

/** `GET /api/erp/encounters/:encounterId` */
export const EncounterDetailResponseSchema = z.strictObject({
  encounter: EncounterSchema,
  patient: PatientSchema,
  deliveries: z.array(ServiceDeliverySchema),
  ...ErpDisclosureFields,
});
export type EncounterDetailResponse = z.infer<typeof EncounterDetailResponseSchema>;

export const EncounterResponseSchema = z.strictObject({
  encounter: EncounterSchema,
  ...ErpDisclosureFields,
});
export type EncounterResponse = z.infer<typeof EncounterResponseSchema>;

/** `POST /api/erp/encounters/:encounterId/services`. A retry with the same key returns the original. */
export const RecordDeliveryRequestSchema = z.strictObject({
  serviceId: z.uuid(),
  performedByStaffId: z.uuid(),
  quantity: z.number().int().min(1).max(100).default(1),
  performedAt: ErpInstantSchema.optional(),
  idempotencyKey: z.uuid(),
});
export type RecordDeliveryRequest = z.infer<typeof RecordDeliveryRequestSchema>;

export const DeliveryResponseSchema = z.strictObject({
  delivery: ServiceDeliverySchema,
  replayed: z.boolean(),
  ...ErpDisclosureFields,
});
export type DeliveryResponse = z.infer<typeof DeliveryResponseSchema>;

/** `PATCH /api/erp/service-deliveries/:deliveryId` — the only change is cancelling a recorded service. */
export const UpdateDeliveryRequestSchema = z.strictObject({
  version: ErpVersionSchema,
  status: z.literal('cancelled'),
});
export type UpdateDeliveryRequest = z.infer<typeof UpdateDeliveryRequestSchema>;

export const DeliveryParamsSchema = z.strictObject({ deliveryId: z.uuid() });

// ---------------------------------------------------------------------------
// Summary (the ERP home page)
// ---------------------------------------------------------------------------

/** `GET /api/erp/summary` — today at one facility. Counts only; no record contents. */
export const ErpSummaryResponseSchema = z.strictObject({
  facilityId: z.uuid(),
  date: ErpDateSchema,
  asOf: ErpInstantSchema,
  staff: z.strictObject({
    active: z.number().int().min(0),
    rostered: z.number().int().min(0),
    onDuty: z.number().int().min(0),
    late: z.number().int().min(0),
    missingPunch: z.number().int().min(0),
    absent: z.number().int().min(0),
  }),
  encounters: z.strictObject({
    openInpatients: z.number().int().min(0),
    openOther: z.number().int().min(0),
    startedToday: z.number().int().min(0),
  }),
  servicesDeliveredToday: z.number().int().min(0),
  patientsRegisteredToday: z.number().int().min(0),
  pendingCorrections: z.number().int().min(0),
  doctorsNeedingCredentialAttention: z.number().int().min(0),
  ...ErpDisclosureFields,
});
export type ErpSummaryResponse = z.infer<typeof ErpSummaryResponseSchema>;
