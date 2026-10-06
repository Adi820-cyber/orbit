import { z } from 'zod';
import { CurrencyCodeSchema, ErpDisclosureFields, ErpVersionSchema } from './erp-common.ts';

/*
 * The services a hospital provides (ERP_PLAN §5.4): one organization-wide
 * catalogue, and per facility whether each service is offered there. Tariffs
 * are optional illustrative demo prices, never real ones.
 */

export const ServiceCategorySchema = z.enum([
  'consultation',
  'diagnostics-lab',
  'diagnostics-imaging',
  'procedure',
  'inpatient-stay',
  'day-care',
  'emergency',
  'therapy',
]);
export type ServiceCategory = z.infer<typeof ServiceCategorySchema>;

export const ServiceUnitSchema = z.enum(['per-visit', 'per-test', 'per-day', 'per-procedure', 'per-session']);
export type ServiceUnit = z.infer<typeof ServiceUnitSchema>;

export const ServiceCodeSchema = z.string().regex(/^[A-Z0-9-]{3,16}$/, 'use 3–16 capital letters, digits or hyphens');

export const ServiceSchema = z.strictObject({
  serviceId: z.uuid(),
  serviceCode: z.string().min(1),
  name: z.string().min(1),
  category: ServiceCategorySchema,
  departmentId: z.uuid(),
  unit: ServiceUnitSchema,
  isActive: z.boolean(),
  version: ErpVersionSchema,
});
export type Service = z.infer<typeof ServiceSchema>;

/** Whether a service is offered at one facility. Null fields mean "not configured there yet". */
export const ServiceAvailabilitySchema = z.strictObject({
  facilityId: z.uuid(),
  isAvailable: z.boolean(),
  illustrativeTariff: z.number().nonnegative().nullable(),
  version: ErpVersionSchema,
});
export type ServiceAvailability = z.infer<typeof ServiceAvailabilitySchema>;

export const ServiceCatalogueQuerySchema = z.object({
  /** With a facility: each service's availability there. */
  facilityId: z.uuid().optional(),
  category: ServiceCategorySchema.optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ServiceCatalogueQuery = z.infer<typeof ServiceCatalogueQuerySchema>;

/** `GET /api/erp/services` */
export const ServiceCatalogueResponseSchema = z.strictObject({
  facilityId: z.uuid().nullable(),
  items: z.array(
    z.strictObject({
      service: ServiceSchema,
      availability: ServiceAvailabilitySchema.nullable(),
    }),
  ),
  /** The organization currency of `illustrativeTariff` (ADR 0022). */
  currency: CurrencyCodeSchema,
  ...ErpDisclosureFields,
});
export type ServiceCatalogueResponse = z.infer<typeof ServiceCatalogueResponseSchema>;

/** `POST /api/erp/services` — admins only. */
export const CreateServiceRequestSchema = z.strictObject({
  serviceCode: ServiceCodeSchema,
  name: z.string().trim().min(1).max(120),
  category: ServiceCategorySchema,
  departmentId: z.uuid(),
  unit: ServiceUnitSchema,
});
export type CreateServiceRequest = z.infer<typeof CreateServiceRequestSchema>;

/** `PATCH /api/erp/services/:serviceId` — admins only. Retiring is `isActive: false`. */
export const UpdateServiceRequestSchema = z.strictObject({
  version: ErpVersionSchema,
  name: z.string().trim().min(1).max(120).optional(),
  category: ServiceCategorySchema.optional(),
  departmentId: z.uuid().optional(),
  unit: ServiceUnitSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateServiceRequest = z.infer<typeof UpdateServiceRequestSchema>;

export const ServiceResponseSchema = z.strictObject({
  service: ServiceSchema,
  ...ErpDisclosureFields,
});
export type ServiceResponse = z.infer<typeof ServiceResponseSchema>;

export const ServiceParamsSchema = z.strictObject({ serviceId: z.uuid() });

export const AvailabilityParamsSchema = z.strictObject({
  facilityId: z.uuid(),
  serviceId: z.uuid(),
});

/**
 * `PUT /api/erp/facilities/:facilityId/services/:serviceId`. Adding a service
 * to a facility for the first time is admins only (omit `version`); after that
 * either operator role may switch it for a facility it can see.
 */
export const SetAvailabilityRequestSchema = z.strictObject({
  isAvailable: z.boolean(),
  illustrativeTariff: z.number().nonnegative().max(10_000_000).nullable().optional(),
  version: ErpVersionSchema.optional(),
});
export type SetAvailabilityRequest = z.infer<typeof SetAvailabilityRequestSchema>;

export const AvailabilityResponseSchema = z.strictObject({
  serviceId: z.uuid(),
  availability: ServiceAvailabilitySchema,
  ...ErpDisclosureFields,
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;
