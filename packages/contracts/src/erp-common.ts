import { z } from 'zod';
import { ProvenanceSchema, DisclosureSchema } from './common.ts';
import { OperatorRoleIdSchema } from './roles.ts';

/*
 * Hospital operations (ERP) contracts, shared by services/api and apps/web
 * (ADR 0016, docs/orbit/ERP_PLAN.md). Every record is synthetic; every response
 * carries `provenance: 'illustrative'` and the ERP disclosure, and the UI
 * renders both.
 *
 * Ids are uuids end to end. Dates are ISO `YYYY-MM-DD`; instants are ISO
 * date-times with an offset. Missing is never zero: a value that does not
 * exist is `null`, never `0`.
 */

/** The disclosure rendered on every ERP surface. */
export const ERP_DISCLOSURE =
  'Fictional demonstration records. No real patient or employee data; not for clinical or employment decisions.';

/** Fields every ERP response carries. Spread into each response schema. */
export const ErpDisclosureFields = {
  provenance: ProvenanceSchema,
  disclosure: DisclosureSchema,
} as const;

/** ISO 4217 currency code of the organization, e.g. INR. */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const ErpDateSchema = z.iso.date();
export const ErpInstantSchema = z.iso.datetime({ offset: true });
/** `HH:MM`, 24-hour. */
export const ErpTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM');
/** `YYYY-MM`. */
export const ErpMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');

/** Offset pagination for ERP lists; bounded so no response nears the 4.5 MB limit (ARCH §11.4). */
export const ErpPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ErpPageQuery = z.infer<typeof ErpPageQuerySchema>;

export const ErpPageSchema = z.strictObject({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});
export type ErpPage = z.infer<typeof ErpPageSchema>;

/** Optimistic locking: every update names the version it read (ARCH §10). */
export const ErpVersionSchema = z.number().int().min(1);

/** A facility the operator can work with. */
export const ErpFacilitySchema = z.strictObject({
  facilityId: z.uuid(),
  name: z.string().min(1),
});
export type ErpFacility = z.infer<typeof ErpFacilitySchema>;

export const DepartmentSchema = z.strictObject({
  departmentId: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
});
export type Department = z.infer<typeof DepartmentSchema>;

export const SpecialtySchema = z.strictObject({
  specialtyId: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
});
export type Specialty = z.infer<typeof SpecialtySchema>;

/** A presenting condition a visit may record (ADR 0023). Not a diagnosis. */
export const ConditionSchema = z.strictObject({
  conditionId: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ShiftTemplateSchema = z.strictObject({
  shiftTemplateId: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  startTime: ErpTimeSchema,
  endTime: ErpTimeSchema,
  breakMinutes: z.number().int().min(0),
  crossesMidnight: z.boolean(),
});
export type ShiftTemplate = z.infer<typeof ShiftTemplateSchema>;

/** Organization-wide thresholds. Illustrative demo configuration, not policy. */
export const ErpSettingsSchema = z.strictObject({
  lateGraceMinutes: z.number().int().min(0),
  earlyExitGraceMinutes: z.number().int().min(0),
  punchWindowBeforeMinutes: z.number().int().min(0),
  punchWindowAfterMinutes: z.number().int().min(0),
  credentialWarningDays: z.number().int().min(0),
  /** IANA zone shift times are interpreted in (the organization's). */
  timeZone: z.string().min(1),
  version: ErpVersionSchema,
});
export type ErpSettings = z.infer<typeof ErpSettingsSchema>;

/** `GET /api/erp/reference` — options for every ERP form, in one call. */
export const ErpReferenceResponseSchema = z.strictObject({
  operatorRole: OperatorRoleIdSchema,
  facilities: z.array(ErpFacilitySchema),
  departments: z.array(DepartmentSchema),
  specialties: z.array(SpecialtySchema),
  shiftTemplates: z.array(ShiftTemplateSchema),
  /** Active presenting conditions, by name. */
  conditions: z.array(ConditionSchema),
  /** Null until an admin has configured the organization. */
  settings: ErpSettingsSchema.nullable(),
  ...ErpDisclosureFields,
});
export type ErpReferenceResponse = z.infer<typeof ErpReferenceResponseSchema>;

/** A facility-scoped request. `facilityId` may be omitted by a hospital operator (it defaults to theirs). */
export const ErpFacilityQuerySchema = z.object({
  facilityId: z.uuid().optional(),
});

export const ErpAuditActionSchema = z.enum(['viewed', 'created', 'updated', 'punched', 'decided']);
export type ErpAuditAction = z.infer<typeof ErpAuditActionSchema>;

export const ErpAuditTargetTypeSchema = z.enum([
  'patient',
  'encounter',
  'service_delivery',
  'staff',
  'doctor',
  'service',
  'facility_service',
  'roster',
  'punch',
  'correction',
  'settings',
]);
export type ErpAuditTargetType = z.infer<typeof ErpAuditTargetTypeSchema>;

/** Who viewed or changed which record — never the record's contents. */
export const ErpAuditEventSchema = z.strictObject({
  eventId: z.uuid(),
  occurredAt: ErpInstantSchema,
  actorRole: OperatorRoleIdSchema,
  action: ErpAuditActionSchema,
  targetType: ErpAuditTargetTypeSchema,
  targetId: z.uuid(),
  requestId: z.string().min(1),
});
export type ErpAuditEvent = z.infer<typeof ErpAuditEventSchema>;

/** `GET /api/erp/audit` — admins only. */
export const ErpAuditResponseSchema = z.strictObject({
  items: z.array(ErpAuditEventSchema),
  page: ErpPageSchema,
  ...ErpDisclosureFields,
});
export type ErpAuditResponse = z.infer<typeof ErpAuditResponseSchema>;
