import { describe, expect, it } from "vitest";
import {
  buildReference,
  HISTORY_END,
  parseCsv,
  weeksShift,
  type ClinicTables,
  type HospitalTables,
} from "../reference.ts";

const csv = (text: string) => parseCsv(text.trim());

function hospital(): HospitalTables {
  return {
    admission: csv(`admission_id,admission_date,discharge_date,admission_type,admission_status,patient_id,department_id,ward_id,bed_id,disease_id
1,2025-12-01,2025-12-05,Emergency,Discharged,1,3,2,1,1
2,2025-11-10,2025-11-12,Elective,Discharged,2,2,1,2,2
3,2020-01-05,2020-01-07,Elective,Discharged,3,2,1,3,2`),
    bed: csv(`bed_id,bed_number,bed_status,ward_id
1,1-1,Occupied,1
2,1-2,Available,2`),
    billing: csv(`bill_id,bill_date,total_amount,insurance_covered_amount,patient_payable_amount,payment_status,payment_mode,admission_id
1,2025-01-01,1000,800,200,Paid,Insurance,1
2,2024-01-01,500,0,500,Pending,Cash,2`),
    billing_detail: csv(`billing_detail_id,charge_type,reference_id,amount,bill_id
1,Room,1.0,600,1
2,Procedure,,300,1
3,Drug,,100,1
4,Room,2.0,500,2`),
    department: csv(`department_id,department_name,department_type,floor_number,status
2,Internal Medicine,Clinical,2,Active
3,Surgery,Clinical,3,Active
7,Radiology,Diagnostic,1,Active`),
    diagnostic_test: csv(`test_id,test_name,test_category,standard_cost,department_id
1,X-Ray Chest,Radiology,1328,7
5,Complete Blood Count,Pathology,400,8`),
    disease: csv(`disease_id,disease_name,disease_category
1,Gallstones,Surgical
2,Stroke,Neurological`),
    doctor: csv(`doctor_id,employee_id,specialization,qualification,experience_years
1,10,Surgery,MS,12
2,11,General Medicine,MD,8`),
    drug: csv(`drug_id,drug_name,brand_name,drug_category,unit_cost,manufacturer_id
1,Earum,"Bhakta, Dass and Chakraborty",Antibiotic,252,1`),
    drug_inventory: csv(`inventory_id,current_stock,reorder_level,inventory_status,last_restock_date,drug_id
1,40,100,Low,2025-04-21,1`),
    drug_manufacturer: csv(`manufacturer_id,manufacturer_name,country,reliability_rating,contract_status
1,"Dora, Yogi and Deshpande",USA,2.5,Active`),
    employee: csv(`employee_id,employee_name,gender,role,employment_type,date_of_joining,department_id
10,Real Looking Name,Male,Doctor,Full-time,2015-04-17,3
11,Another Name,Female,Doctor,Contract,2026-01-20,2
12,Nurse Name,Female,Nurse,Full-time,2019-01-01,2
13,Nurse Two,Male,Nurse,Full-time,2019-01-01,3`),
    insurance_provider: csv(`insurance_provider_id,provider_name,provider_type,contact_details,coverage_limit
1,Bhatti Group Health Insurance,Private,0312415859,1500000`),
    patient: csv(`patient_id,gender,date_of_birth,blood_group,city,contact_number
1,Female,1987-08-24,O-,East Stephanieberg,+1-792-342-0981
2,Male,1960-05-18,A-,Manuelbury,793-725-0800
3,Other,2023-02-01,B+,Somewhere,555-0100`),
    patient_diagnostic: csv(`patient_diagnostic_id,test_date,result_status,admission_id,test_id,doctor_id
1,2025-12-01,Abnormal,1,1,1
2,2025-12-03,Normal,1,5,2`),
    patient_insurance: csv(`patient_insurance_id,policy_number,coverage_percentage,policy_start_date,policy_end_date,patient_id,insurance_provider_id
1,POL55116683,50,2020-01-01,2022-12-31,1,1`),
    prescription: csv(`prescription_id,dosage,frequency,duration_days,admission_id,drug_id
1,1 tablet,Twice a day,12,1,1`),
    staff_assignment: csv(`assignment_id,employee_id,ward_id,shift
1,12,1,Morning`),
    ward: csv(`ward_id,ward_name,ward_type,total_beds,department_id
1,General Ward,General,10,2
2,ICU Ward,ICU,5,3`),
  };
}

function clinic(): ClinicTables {
  return {
    appointments: csv(`appointment_id,patient_id,doctor_id,appointment_date,appointment_time,reason_for_visit,status
A001,P001,D001,2023-08-09,9:15:00,Therapy,Completed
A002,P001,D001,2023-06-09,14:30:00,Checkup,No-show
A003,P001,D001,2023-12-30,10:00:00,Checkup,Scheduled`),
    billing: csv(`bill_id,patient_id,treatment_id,bill_date,amount,payment_method,payment_status
B001,P001,T001,2023-08-09,3941.97,Insurance,Paid`),
    doctors: csv(`doctor_id,first_name,last_name,specialization,phone_number,years_experience,hospital_branch,email
D001,David,Taylor,Oncology,8322010158,17,Westside Clinic,dr.david.taylor@hospital.com`),
    patients: csv(`patient_id,first_name,last_name,gender,date_of_birth,contact_number,address,registration_date,insurance_provider,insurance_number,email
P001,David,Williams,F,1955-06-04,6939585183,789 Pine Rd,2022-06-23,WellnessCorp,INS840674,david.williams@mail.com`),
    treatments: csv(`treatment_id,appointment_id,treatment_type,description,cost,treatment_date
T001,A001,Chemotherapy,Basic screening,3941.97,2023-08-09
T002,A002,MRI,Advanced protocol,4158.44,2023-06-09`),
  };
}

describe("parseCsv", () => {
  it("keeps commas and doubled quotes inside quoted fields", () => {
    const rows = parseCsv('id,name\r\n1,"Bhakta, Dass ""and"" Co"\r\n2,plain\r\n');
    expect(rows).toEqual([
      { id: "1", name: 'Bhakta, Dass "and" Co' },
      { id: "2", name: "plain" },
    ]);
  });
});

describe("weeksShift", () => {
  it("moves by whole weeks without passing the end", () => {
    const shift = weeksShift("2025-12-31", "2026-09-30");
    expect(shift % 7).toBe(0);
    expect(shift).toBeLessThanOrEqual(273);
    expect(shift).toBeGreaterThan(273 - 7);
  });
});

describe("buildReference", () => {
  const result = buildReference(hospital(), clinic());

  it("keeps only a fictional name, sex and birth year for patients", () => {
    const sourceText = JSON.stringify([hospital().patient, clinic().patients]);
    for (const p of result.patients) {
      expect(Object.keys(p).sort()).toEqual(["birthYear", "createdAt", "displayName", "facility", "id", "mrn", "sex"]);
      expect(sourceText).not.toContain(p.displayName);
    }
    const out = JSON.stringify(result);
    for (const secret of ["6939585183", "789 Pine Rd", "david.williams@mail.com", "INS840674", "East Stephanieberg", "Real Looking Name"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("never dates anything after the end of the history", () => {
    for (const e of result.encounters) expect(e.endedAt.slice(0, 10) <= HISTORY_END).toBe(true);
    for (const d of result.deliveries) expect(d.performedAt.slice(0, 10) <= HISTORY_END).toBe(true);
    for (const s of result.staff) expect(s.joinedOn <= HISTORY_END).toBe(true);
  });

  it("places every service inside its visit, at a hospital where the performer works", () => {
    const visits = new Map(result.encounters.map((e) => [e.id, e]));
    const staff = new Map(result.staff.map((s) => [s.id, s]));
    for (const d of result.deliveries) {
      const visit = visits.get(d.encounterId)!;
      expect(visit.status).toBe("closed");
      expect(d.performedAt >= visit.startedAt && d.performedAt <= visit.endedAt).toBe(true);
      expect(staff.get(d.performerId)?.facility).toBe(visit.facility);
    }
  });

  it("gives every doctor a credential valid for all their recorded work", () => {
    for (const d of result.doctors) expect(d.credentialExpiresOn > HISTORY_END).toBe(true);
  });

  it("excludes source errors and bookings instead of inventing visits", () => {
    expect(result.manifest.excluded["admission before the patient's birth year"]).toBe(1);
    expect(result.manifest.excluded["appointment still scheduled in the source (a booking, not a visit)"]).toBe(1);
    expect(result.manifest.excluded["treatment on a no-show or cancelled appointment"]).toBe(1);
    const noShow = result.encounters.find((e) => e.type === "outpatient" && e.status === "cancelled");
    expect(noShow?.startedAt).toBe(noShow?.endedAt);
  });

  it("stores clinical and financial detail only as summaries, each for the roles it concerns", () => {
    const stock = result.chunks.find((c) => c.key === "ref:stock:group")!;
    expect(stock.roles).toContain("procurement-head");
    expect(stock.roles).not.toContain("hospital-dho");
    expect(stock.content).toContain("Earum (Antibiotic) 40 in stock against a reorder level of 100");
    const billing = result.chunks.find((c) => c.key === "ref:billing:group")!;
    expect(billing.content).toContain("totalling 1500");
    expect(billing.content).toContain("not converted to USD");
    expect(result.chunks.every((c) => c.content.includes("illustrative"))).toBe(true);
  });

  it("is the same every run", () => {
    expect(JSON.stringify(buildReference(hospital(), clinic()))).toBe(JSON.stringify(result));
  });
});
