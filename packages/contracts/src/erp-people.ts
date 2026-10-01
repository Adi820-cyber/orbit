import { z } from 'zod';
import {
  ErpDateSchema,
  ErpDisclosureFields,
  ErpPageQuerySchema,
  ErpPageSchema,
  ErpTimeSchema,
  ErpVersionSchema,
} from './erp-common.ts';

/*
 * Staff and doctors (ERP_PLAN §5.2–5.3). A doctor is a staff member with a
 * doctor profile, so one person has one record and attendance covers doctors
 * too. Minimal by design: no salary, contact, bank, government-id or
 * performance fields exist anywhere in these shapes.
 */

export const StaffTypeSchema = z.enum(['doctor', 'nurse', 'technician', 'administrative', 'support']);
export type StaffType = z.infer<typeof StaffTypeSchema>;

export const EmploymentStatusSchema = z.enum(['active', 'on-leave', 'exited']);
export type EmploymentStatus = z.infer<typeof EmploymentStatusSchema>;

/** Synthetic, visibly fictional codes (mirrors the database CHECKs). */
export const EmployeeCodeSchema = z.string().regex(/^[A-Z0-9-]{3,20}$/, 'use 3–20 capital letters, digits or hyphens');
export const RegistrationNumberSchema = z.string().regex(/^DEMO-REG-[0-9]{4,8}$/, 'use the DEMO-REG-0000 format');

const NameSchema = z.string().trim().min(1).max(120);
const DesignationSchema = z.string().trim().min(1).max(80);

export const StaffSchema = z.strictObject({
  staffId: z.uuid(),
  facilityId: z.uuid(),
  departmentId: z.uuid(),
  employeeCode: z.string().min(1),
  displayName: z.string().min(1),
  staffType: StaffTypeSchema,
  designation: z.string().min(1),
  employmentStatus: EmploymentStatusSchema,
  joinedOn: ErpDateSchema,
  exitedOn: ErpDateSchema.nullable(),
  isCriticalRole: z.boolean(),
  version: ErpVersionSchema,
});
export type Staff = z.infer<typeof StaffSchema>;

export const StaffListQuerySchema = ErpPageQuerySchema.extend({
  facilityId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  staffType: StaffTypeSchema.optional(),
  employmentStatus: EmploymentStatusSchema.optional(),
  q: z.string().trim().min(1).max(60).optional(),
});
export type StaffListQuery = z.infer<typeof StaffListQuerySchema>;

export const StaffListResponseSchema = z.strictObject({
  items: z.array(StaffSchema),
  page: ErpPageSchema,
  ...ErpDisclosureFields,
});
export type StaffListResponse = z.infer<typeof StaffListResponseSchema>;

export const StaffResponseSchema = z.strictObject({
  staff: StaffSchema,
  ...ErpDisclosureFields,
});
export type StaffResponse = z.infer<typeof StaffResponseSchema>;

/** `POST /api/erp/staff` — admins only. Doctors are created through `POST /api/erp/doctors`. */
export const CreateStaffRequestSchema = z.strictObject({
  facilityId: z.uuid(),
  departmentId: z.uuid(),
  employeeCode: EmployeeCodeSchema,
  displayName: NameSchema,
  staffType: StaffTypeSchema.exclude(['doctor']),
  designation: DesignationSchema,
  joinedOn: ErpDateSchema,
  isCriticalRole: z.boolean().default(false),
});
export type CreateStaffRequest = z.infer<typeof CreateStaffRequestSchema>;

/** `PATCH /api/erp/staff/:staffId` — admins only. Exiting requires the exit date and vice versa. */
export const UpdateStaffRequestSchema = z
  .strictObject({
    version: ErpVersionSchema,
    departmentId: z.uuid().optional(),
    designation: DesignationSchema.optional(),
    employmentStatus: EmploymentStatusSchema.optional(),
    exitedOn: ErpDateSchema.nullable().optional(),
    isCriticalRole: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.employmentStatus === undefined ||
      (body.employmentStatus === 'exited') === (body.exitedOn !== undefined && body.exitedOn !== null),
    { message: 'An exited person needs an exit date, and only an exited person has one.' },
  );
export type UpdateStaffRequest = z.infer<typeof UpdateStaffRequestSchema>;

export const StaffParamsSchema = z.strictObject({ staffId: z.uuid() });

// ---------------------------------------------------------------------------
// Doctors
// ---------------------------------------------------------------------------

export const CredentialStatusSchema = z.enum(['active', 'expiring', 'expired', 'suspended']);
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;

export const DoctorEmploymentTypeSchema = z.enum(['employed', 'visiting', 'consultant']);
export type DoctorEmploymentType = z.infer<typeof DoctorEmploymentTypeSchema>;

export const DoctorSchema = z.strictObject({
  staffId: z.uuid(),
  facilityId: z.uuid(),
  departmentId: z.uuid(),
  employeeCode: z.string().min(1),
  displayName: z.string().min(1),
  designation: z.string().min(1),
  employmentStatus: EmploymentStatusSchema,
  specialtyId: z.uuid(),
  registrationNumber: z.string().min(1),
  credentialExpiresOn: ErpDateSchema,
  credentialSuspended: z.boolean(),
  /** Derived from expiry, suspension and the organization's warning window, as of today. */
  credentialStatus: CredentialStatusSchema,
  employmentType: DoctorEmploymentTypeSchema,
  version: ErpVersionSchema,
});
export type Doctor = z.infer<typeof DoctorSchema>;


export const ScheduleSlotSchema = z.strictObject({
  slotId: z.uuid(),
  facilityId: z.uuid(),
  weekday: z.number().int().min(1).max(7),
  startTime: ErpTimeSchema,
  endTime: ErpTimeSchema,
  isActive: z.boolean(),
});
export type ScheduleSlot = z.infer<typeof ScheduleSlotSchema>;

export const DoctorListQuerySchema = ErpPageQuerySchema.extend({
  facilityId: z.uuid().optional(),
  specialtyId: z.uuid().optional(),
  credentialStatus: CredentialStatusSchema.optional(),
  q: z.string().trim().min(1).max(60).optional(),
});
export type DoctorListQuery = z.infer<typeof DoctorListQuerySchema>;

export const DoctorListResponseSchema = z.strictObject({
  items: z.array(DoctorSchema),
  page: ErpPageSchema,
  ...ErpDisclosureFields,
});
export type DoctorListResponse = z.infer<typeof DoctorListResponseSchema>;

export const DoctorDetailResponseSchema = z.strictObject({
  doctor: DoctorSchema,
  schedule: z.array(ScheduleSlotSchema),
  ...ErpDisclosureFields,
});
export type DoctorDetailResponse = z.infer<typeof DoctorDetailResponseSchema>;

/** `POST /api/erp/doctors` — admins only. Creates the staff record and the doctor profile together. */
export const CreateDoctorRequestSchema = z.strictObject({
  facilityId: z.uuid(),
  departmentId: z.uuid(),
  employeeCode: EmployeeCodeSchema,
  displayName: NameSchema,
  designation: DesignationSchema,
  joinedOn: ErpDateSchema,
  isCriticalRole: z.boolean().default(false),
  specialtyId: z.uuid(),
  registrationNumber: RegistrationNumberSchema,
  credentialExpiresOn: ErpDateSchema,
  employmentType: DoctorEmploymentTypeSchema.default('employed'),
});
export type CreateDoctorRequest = z.infer<typeof CreateDoctorRequestSchema>;

/** `PATCH /api/erp/doctors/:staffId` — admins only; `version` is the doctor profile's. */
export const UpdateDoctorRequestSchema = z.strictObject({
  version: ErpVersionSchema,
  specialtyId: z.uuid().optional(),
  credentialExpiresOn: ErpDateSchema.optional(),
  credentialSuspended: z.boolean().optional(),
  employmentType: DoctorEmploymentTypeSchema.optional(),
});
export type UpdateDoctorRequest = z.infer<typeof UpdateDoctorRequestSchema>;

/** `POST /api/erp/doctors/:staffId/schedule` — admins only. Consultation slots never cross midnight. */
export const AddScheduleSlotRequestSchema = z
  .strictObject({
    facilityId: z.uuid(),
    weekday: z.number().int().min(1).max(7),
    startTime: ErpTimeSchema,
    endTime: ErpTimeSchema,
  })
  .refine((slot) => slot.endTime > slot.startTime, { message: 'A slot must end after it starts.' });
export type AddScheduleSlotRequest = z.infer<typeof AddScheduleSlotRequestSchema>;

/** `PATCH /api/erp/schedule-slots/:slotId` — admins only. Retiring a slot is `isActive: false`. */
export const UpdateScheduleSlotRequestSchema = z.strictObject({
  isActive: z.boolean(),
});
export type UpdateScheduleSlotRequest = z.infer<typeof UpdateScheduleSlotRequestSchema>;

export const ScheduleSlotResponseSchema = z.strictObject({
  slot: ScheduleSlotSchema,
  ...ErpDisclosureFields,
});
export type ScheduleSlotResponse = z.infer<typeof ScheduleSlotResponseSchema>;

export const DoctorResponseSchema = z.strictObject({
  doctor: DoctorSchema,
  ...ErpDisclosureFields,
});
export type DoctorResponse = z.infer<typeof DoctorResponseSchema>;

export const SlotParamsSchema = z.strictObject({ slotId: z.uuid() });
