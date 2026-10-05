import type { ServiceCategory, StaffType } from '@orbit/contracts';
import { isoWeekday, weekNumber } from './clock.ts';
import type { SimRates } from './config.ts';
import { GIVEN_NAMES, SURNAMES } from './names.ts';
import { hashInt, rngFor, type Rand } from './rng.ts';

/*
 * What the simulated hospital intends to do. Everything here is a pure
 * function of (seed, id, date), with no clock and no I/O, so the same input
 * always plans the same behaviour and a restart never re-decides a day.
 * Nothing here is clinical: visits have a type, a length and a list of service
 * categories, never a diagnosis or a note (ADR 0016 §4).
 */

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface AttendancePlan {
  absent: boolean;
  /** Minutes after the shift starts that the person arrives (negative = early). */
  inOffsetMinutes: number;
  /** Minutes after the shift ends that they leave; null = they forget to punch out. */
  outOffsetMinutes: number | null;
  /** Minutes after the shift ends that a forgotten out-punch gets noticed and fixed. */
  fixAfterMinutes: number;
}

export function attendancePlan(seed: string, staffId: string, shiftDate: string, rates: SimRates, absenceMultiplier = 1): AttendancePlan {
  const rand = rngFor(seed, 'attendance', staffId, shiftDate);
  // Draw in a fixed order, so a rate change moves a threshold, never the stream.
  const absentRoll = rand.unit();
  const lateRoll = rand.unit();
  const onTimeOffset = rand.int(-12, 6);
  const lateOffset = rand.int(12, 45);
  const missingRoll = rand.unit();
  const earlyRoll = rand.unit();
  const earlyOffset = -rand.int(25, 70);
  const normalOut = rand.int(0, 25);
  const fixAfterMinutes = rand.int(8 * 60, 20 * 60);
  return {
    absent: absentRoll < Math.min(0.9, rates.absent * absenceMultiplier),
    inOffsetMinutes: lateRoll < rates.late ? lateOffset : onTimeOffset,
    outOffsetMinutes: missingRoll < rates.missingOut ? null : earlyRoll < rates.earlyExit ? earlyOffset : normalOut,
    fixAfterMinutes,
  };
}

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------

export interface RosterStaff {
  staffId: string;
  staffType: StaffType;
}

export interface ShiftRef {
  shiftTemplateId: string;
  code: string;
}

/**
 * The shift a person would normally work on a date, or null for a rest day.
 * Two adjacent rest days a week (weekends for office roles), nurses rotate
 * morning → afternoon → night by week, others keep a fixed pattern.
 */
export function rosterPlan(seed: string, person: RosterStaff, date: string, shifts: readonly ShiftRef[]): string | null {
  const byCode = (code: string) => shifts.find((shift) => shift.code === code)?.shiftTemplateId ?? null;
  const weekday = isoWeekday(date);
  const h = hashInt(seed, 'roster', person.staffId);

  const office = person.staffType === 'administrative';
  const restA = (h % 7) + 1;
  const restB = (restA % 7) + 1;
  if (office ? weekday >= 6 : weekday === restA || weekday === restB) return null;

  switch (person.staffType) {
    case 'nurse':
      return byCode((['M', 'A', 'N'] as const)[(weekNumber(date) + (h % 3)) % 3] ?? 'M');
    case 'doctor':
      return byCode(h % 2 === 0 ? 'M' : 'G');
    case 'administrative':
      return byCode('G');
    case 'technician':
    case 'support':
      return byCode(h % 2 === 0 ? 'M' : 'A');
  }
}

// ---------------------------------------------------------------------------
// Patients and visits
// ---------------------------------------------------------------------------

export type EncounterType = 'outpatient' | 'emergency' | 'day-care' | 'inpatient';

export interface PlannedService {
  category: ServiceCategory;
  /** Minutes after the visit starts. Always before the visit ends. */
  offsetMinutes: number;
  quantity: number;
}

export interface VisitPlan {
  lengthMinutes: number;
  services: PlannedService[];
}

export function visitPlan(seed: string, encounterId: string, type: EncounterType): VisitPlan {
  const rand = rngFor(seed, 'visit', encounterId);
  const services: PlannedService[] = [];
  const add = (category: ServiceCategory, offsetMinutes: number, quantity = 1) => services.push({ category, offsetMinutes, quantity });

  let lengthMinutes: number;
  switch (type) {
    case 'outpatient':
      lengthMinutes = rand.int(30, 150);
      add('consultation', rand.int(3, 10));
      if (rand.chance(0.35)) add('diagnostics-lab', rand.int(15, 30));
      if (rand.chance(0.15)) add('diagnostics-imaging', rand.int(20, 40));
      if (rand.chance(0.08)) add('therapy', rand.int(25, 45));
      break;
    case 'emergency':
      lengthMinutes = rand.int(90, 360);
      add('emergency', rand.int(5, 15));
      if (rand.chance(0.6)) add('diagnostics-lab', rand.int(30, 60));
      if (rand.chance(0.4)) add('diagnostics-imaging', rand.int(50, 90));
      break;
    case 'day-care':
      lengthMinutes = rand.int(180, 360);
      add('day-care', rand.int(10, 30));
      add('diagnostics-lab', rand.int(5, 15));
      break;
    case 'inpatient': {
      const days = rand.int(2, 6);
      lengthMinutes = days * 1440 + rand.int(0, 600);
      add('consultation', rand.int(20, 60));
      add('diagnostics-lab', rand.int(60, 180));
      // One ward-day per day of the stay, recorded as the day begins.
      for (let day = 0; day < days; day += 1) add('inpatient-stay', 120 + day * 1440);
      if (rand.chance(0.2)) add('procedure', rand.int(1440, Math.max(1441, lengthMinutes - 300)));
      break;
    }
  }
  const latest = lengthMinutes - 5;
  return { lengthMinutes, services: services.map((service) => ({ ...service, offsetMinutes: Math.min(service.offsetMinutes, latest) })) };
}

/** Who performs a service of each category. */
export function performerTypes(category: ServiceCategory): readonly StaffType[] {
  switch (category) {
    case 'consultation':
    case 'emergency':
    case 'procedure':
      return ['doctor'];
    case 'diagnostics-lab':
    case 'diagnostics-imaging':
      return ['technician'];
    case 'inpatient-stay':
    case 'therapy':
    case 'day-care':
      return ['nurse'];
  }
}

/** Department code a visit of each type starts in (matched against the organization's codes). */
export function departmentCodeFor(type: EncounterType): string {
  switch (type) {
    case 'emergency':
      return 'EMER';
    case 'inpatient':
      return 'WARD';
    case 'outpatient':
    case 'day-care':
      return 'OPD';
  }
}

/** Relative arrivals by local hour of day, from quiet nights to a late-morning peak. */
const HOURLY_WEIGHT = [
  0.2, 0.15, 0.12, 0.12, 0.15, 0.3, 0.6, 1.0, 1.5, 1.8, 1.9, 1.7, 1.4, 1.3, 1.4, 1.5, 1.5, 1.4, 1.2, 0.9, 0.7, 0.5, 0.35, 0.25,
] as const;
const WEIGHT_TOTAL = HOURLY_WEIGHT.reduce((sum, weight) => sum + weight, 0);

/** Expected new arrivals during one tick at one facility. */
export function expectedArrivals(options: { staffCount: number; visitsPerStaffPerDay: number; hour: number; tickSeconds: number; demand: number }): number {
  const daily = options.staffCount * options.visitsPerStaffPerDay * options.demand;
  const weight = HOURLY_WEIGHT[Math.min(23, Math.max(0, options.hour))] ?? 1;
  return ((daily * weight) / WEIGHT_TOTAL) * (options.tickSeconds / 3600);
}

export function visitType(rand: Rand): EncounterType {
  const roll = rand.unit();
  return roll < 0.64 ? 'outpatient' : roll < 0.8 ? 'emergency' : roll < 0.88 ? 'day-care' : 'inpatient';
}

export interface PatientProfile {
  displayName: string;
  sex: 'female' | 'male' | 'other' | 'unknown';
  birthYear: number;
}

export function patientProfile(rand: Rand, currentYear: number): PatientProfile {
  const roll = rand.unit();
  return {
    displayName: `${rand.pick(GIVEN_NAMES)} ${rand.pick(SURNAMES)}`,
    sex: roll < 0.49 ? 'female' : roll < 0.97 ? 'male' : roll < 0.99 ? 'other' : 'unknown',
    birthYear: rand.int(1935, currentYear),
  };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export const CORRECTION_REASONS = [
  'Forgot to punch out at handover',
  'Left through the staff entrance, punch point was busy',
  'Punch point queue at shift end',
  'Called away to a ward before punching out',
] as const;

export const REJECTION_NOTES = ['Times do not match the roster', 'Please check with the ward lead first', 'Duplicate of an earlier request'] as const;

/** How long an admin takes to act on a correction, in minutes (a person is not instant). */
export function decisionDelayMinutes(seed: string, correctionId: string): number {
  return rngFor(seed, 'decision', correctionId).int(5, 45);
}

export function approves(seed: string, correctionId: string): boolean {
  return rngFor(seed, 'verdict', correctionId).unit() < 0.9;
}

/** Calendar days after which an expired or expiring credential is renewed (spread across people). */
export function renewalLagDays(seed: string, staffId: string): number {
  return hashInt(seed, 'renewal', staffId) % 6;
}
