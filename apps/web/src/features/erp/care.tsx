import { useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import type {
  BillListResponse,
  CoverageResponse,
  DoctorListResponse,
  EncounterDetailResponse,
  EncounterListResponse,
  ErpAuditResponse,
  PatientDetailResponse,
  PatientSearchResponse,
  ServiceCatalogueResponse,
  StaffListResponse,
} from "@orbit/contracts";
import { formText } from "../../lib/form";
import { ScrollRegion, SurfaceHeading } from "../workspace/components";
import { mutate, withClient, type WorkspaceEnvironment } from "../workspace/environment";
import { erpMutation, type ErpActionResult } from "./home";
import { ErpBack } from "./back";
import { CoveragePanel, VisitBilling } from "./billing";
import {
  day,
  ErpDisclosure,
  facilityFromUrl,
  Field,
  FormMessage,
  instantFromLocal,
  label,
  money,
  Pager,
  useErp,
  useErpHref,
  when,
} from "./shared";

const ENCOUNTER_TYPES = ["outpatient", "emergency", "day-care", "inpatient"] as const;
const SERVICE_CATEGORIES = [
  "consultation", "diagnostics-lab", "diagnostics-imaging", "procedure", "inpatient-stay", "day-care", "emergency", "therapy",
] as const;
const SERVICE_UNITS = ["per-visit", "per-test", "per-day", "per-procedure", "per-session"] as const;

function facilityParam(request: Request) {
  const facility = facilityFromUrl(request);
  return facility ? `?facility=${encodeURIComponent(facility)}` : "";
}

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

export function patientsLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<PatientSearchResponse | null> => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    // Search only: no "list every patient" (ERP_PLAN §5.1).
    if (q.length < 2) return null;
    return withClient(environment, request, (client) => client.erp.patients({ q, page: url.searchParams.get("page") }));
  };
}

export function patientsAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs) => {
    const form = await request.formData();
    const result = await mutate(environment, request, (client) =>
      client.erp.registerPatient({
        homeFacilityId: formText(form, "homeFacilityId"),
        displayName: formText(form, "displayName"),
        sex: formText(form, "sex"),
        birthYear: Number(formText(form, "birthYear")),
        confirmNotDuplicate: form.get("confirmNotDuplicate") === "on",
      }),
    );
    if (!result.ok) return result;
    return redirect(`/erp/patients/${encodeURIComponent(result.value.patient.patientId)}${facilityParam(request)}`);
  };
}

export function PatientsRoute() {
  const results = useLoaderData<PatientSearchResponse | null>();
  const failure = useActionData<ErpActionResult>();
  const { facilityName, facilityId } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();
  const duplicate = failure && !failure.ok && failure.code === "conflict";

  return (
    <>
      <title>Patients | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title="Patients"
        description="Search by name or MRN, or register a new patient. Records hold a birth year only, and no contact, identity, insurance or clinical details. Every record you open is logged."
      />
      <ErpDisclosure />

      <Form method="get" className="erp-toolbar">
        {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
        <Field label="Name or MRN" hint="At least two characters.">
          <input className="orbit-input" name="q" defaultValue={search.get("q") ?? ""} minLength={2} required />
        </Field>
        <button className="orbit-button" type="submit">Search</button>
      </Form>

      {results ? (
        results.items.length ? (
          <>
            <ScrollRegion label="Patients found">
              <table className="workspace-table erp-table">
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    <th scope="col">MRN</th>
                    <th scope="col">Sex</th>
                    <th scope="col">Birth year</th>
                    <th scope="col">Registered at</th>
                  </tr>
                </thead>
                <tbody>
                  {results.items.map((patient) => (
                    <tr key={patient.patientId}>
                      <th scope="row">
                        <Link className="workspace-inline-link" to={href(`/patients/${patient.patientId}`)}>{patient.displayName}</Link>
                      </th>
                      <td className="workspace-reference">{patient.mrn}</td>
                      <td>{label(patient.sex)}</td>
                      <td>{patient.birthYear}</td>
                      <td>{facilityName(patient.homeFacilityId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
            <Pager {...results.page} href={(page) => href("/patients", { q: search.get("q") ?? undefined, page: String(page) })} />
          </>
        ) : (
          <p className="workspace-empty">No patient you can see matches “{search.get("q")}”.</p>
        )
      ) : null}

      <section className="workspace-panel" aria-labelledby="register-heading">
        <h2 id="register-heading">Register a patient</h2>
        <FormMessage result={failure} />
        <Form method="post" className="erp-form-grid">
          <input type="hidden" name="homeFacilityId" value={facilityId} />
          <Field label="Full name (fictional)">
            <input className="orbit-input" name="displayName" required maxLength={120} />
          </Field>
          <Field label="Sex">
            <select className="orbit-select" name="sex" defaultValue="unknown">
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
          <Field label="Birth year">
            <input className="orbit-input" type="number" name="birthYear" min={1900} max={new Date().getUTCFullYear()} required />
          </Field>
          {duplicate ? (
            <label className="erp-check">
              <input type="checkbox" name="confirmNotDuplicate" /> I checked: this is a different person
            </label>
          ) : null}
          <button className="orbit-button" type="submit">Register</button>
        </Form>
      </section>
    </>
  );
}

export interface PatientPageData {
  detail: PatientDetailResponse;
  doctors: DoctorListResponse;
  coverage: CoverageResponse;
}

export function patientDetailLoader(environment: WorkspaceEnvironment) {
  return async ({ request, params }: LoaderFunctionArgs): Promise<PatientPageData> =>
    withClient(environment, request, async (client) => {
      const [detail, doctors, coverage] = await Promise.all([
        client.erp.patient(params["patientId"] ?? ""),
        client.erp.doctors({ facilityId: facilityFromUrl(request), credentialStatus: undefined, pageSize: 100 }),
        client.erp.coverage(params["patientId"] ?? ""),
      ]);
      return { detail, doctors, coverage };
    });
}

export function patientDetailAction(environment: WorkspaceEnvironment) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const form = await request.formData();
    if (formText(form, "intent") === "open-visit") {
      const doctor = formText(form, "attendingDoctorId");
      const result = await mutate(environment, request, (client) =>
        client.erp.openEncounter({
          patientId: params["patientId"] ?? "",
          facilityId: formText(form, "facilityId"),
          departmentId: formText(form, "departmentId"),
          encounterType: formText(form, "encounterType"),
          ...(doctor ? { attendingDoctorId: doctor } : {}),
        }),
      );
      if (!result.ok) return result;
      return redirect(`/erp/visits/${encodeURIComponent(result.value.encounter.encounterId)}${facilityParam(request)}`);
    }
    if (formText(form, "intent") === "coverage") {
      const payerType = formText(form, "payerType");
      const version = formText(form, "version");
      const payerName = formText(form, "payerName").trim();
      return erpMutation(
        environment,
        request,
        (client) =>
          client.erp.setCoverage(params["patientId"] ?? "", {
            payerType,
            coveragePercent: payerType === "self-pay" ? 0 : Number(formText(form, "coveragePercent")),
            ...(payerType !== "self-pay" && payerName ? { payerName } : {}),
            ...(version ? { version: Number(version) } : {}),
          }),
        "Insurance cover saved.",
      );
    }
    return erpMutation(
      environment,
      request,
      (client) =>
        client.erp.updatePatient(params["patientId"] ?? "", {
          version: Number(formText(form, "version")),
          displayName: formText(form, "displayName"),
          status: formText(form, "status"),
        }),
      "Patient updated.",
    );
  };
}

export function PatientDetailRoute() {
  const { detail, doctors, coverage } = useLoaderData<PatientPageData>();
  const result = useActionData<ErpActionResult>();
  const { facilityName, facilityId, departmentName, reference } = useErp();
  const href = useErpHref();
  const { patient, encounters } = detail;
  const practising = doctors.items.filter((doctor) => doctor.employmentStatus === "active" && ["active", "expiring"].includes(doctor.credentialStatus));

  return (
    <>
      <title>{`${patient.displayName} | Orbit hospital operations`}</title>
      <ErpBack to={href("/patients")} />
      <SurfaceHeading
        eyebrow={`Patient · ${patient.mrn}`}
        title={patient.displayName}
        description={`${label(patient.sex)}, born ${patient.birthYear}. Registered at ${facilityName(patient.homeFacilityId)} on ${day(patient.createdAt.slice(0, 10))}. Status: ${label(patient.status)}.`}
      />
      <ErpDisclosure />
      <FormMessage result={result} />

      <div className="erp-two-column">
        <section className="workspace-panel" aria-labelledby="visit-heading">
          <h2 id="visit-heading">Start a visit at {facilityName(facilityId)}</h2>
          <Form method="post" className="erp-form-grid">
            <input type="hidden" name="intent" value="open-visit" />
            <input type="hidden" name="facilityId" value={facilityId} />
            <Field label="Visit type">
              <select className="orbit-select" name="encounterType">
                {ENCOUNTER_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select className="orbit-select" name="departmentId" defaultValue={reference.departments.find((department) => department.code === "OPD")?.departmentId}>
                {reference.departments.map((department) => (
                  <option key={department.departmentId} value={department.departmentId}>{department.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Attending doctor" hint="Only doctors with a valid credential are listed.">
              <select className="orbit-select" name="attendingDoctorId" defaultValue="">
                <option value="">Not assigned yet</option>
                {practising.map((doctor) => <option key={doctor.staffId} value={doctor.staffId}>{doctor.displayName}</option>)}
              </select>
            </Field>
            <button className="orbit-button" type="submit" disabled={patient.status !== "active"}>Start visit</button>
          </Form>
        </section>

        <section className="workspace-panel" aria-labelledby="edit-patient-heading">
          <h2 id="edit-patient-heading">Correct the record</h2>
          <Form method="post" className="erp-form-grid">
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="version" value={patient.version} />
            <Field label="Full name">
              <input className="orbit-input" name="displayName" defaultValue={patient.displayName} required maxLength={120} />
            </Field>
            <Field label="Status">
              <select className="orbit-select" name="status" defaultValue={patient.status}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="deceased">Deceased</option>
              </select>
            </Field>
            <button className="orbit-button" data-variant="secondary" type="submit">Save</button>
          </Form>
        </section>
      </div>

      <CoveragePanel coverage={coverage.coverage} />

      <section className="workspace-section" aria-labelledby="visits-heading">
        <div className="workspace-section__heading">
          <h2 id="visits-heading">Visits you can see</h2>
        </div>
        {encounters.length ? (
          <ScrollRegion label="Visits">
            <table className="workspace-table erp-table">
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Type</th>
                  <th scope="col">Facility</th>
                  <th scope="col">Department</th>
                  <th scope="col">Doctor</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {encounters.map((encounter) => (
                  <tr key={encounter.encounterId}>
                    <th scope="row">
                      <Link className="workspace-inline-link" to={href(`/visits/${encounter.encounterId}`)}>{when(encounter.startedAt)}</Link>
                    </th>
                    <td>{label(encounter.encounterType)}</td>
                    <td>{facilityName(encounter.facilityId)}</td>
                    <td>{departmentName(encounter.departmentId)}</td>
                    <td>{encounter.attendingDoctorName ?? "—"}</td>
                    <td><VisitStatus status={encounter.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : (
          <p className="workspace-empty">No visits yet.</p>
        )}
      </section>
    </>
  );
}

function VisitStatus({ status }: { status: string }) {
  return (
    <span className="orbit-status" data-state={status === "open" ? "fresh" : status === "closed" ? "ready" : "unavailable"}>
      {label(status)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

export function visitsLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    return withClient(environment, request, (client) =>
      client.erp.encounters({
        facilityId: facilityFromUrl(request),
        status: url.searchParams.get("status"),
        encounterType: url.searchParams.get("type"),
        date: url.searchParams.get("date"),
        page: url.searchParams.get("page"),
      }),
    );
  };
}

export function VisitsRoute() {
  const list = useLoaderData<EncounterListResponse>();
  const { facilityName, facilityId, departmentName } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();
  const filters = { status: search.get("status") ?? undefined, type: search.get("type") ?? undefined, date: search.get("date") ?? undefined };

  return (
    <>
      <title>Visits | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title="Visits"
        description="Outpatient, emergency, day-care and inpatient visits at this facility. Open visits first. To start a visit, find the patient first."
      />
      <ErpDisclosure />
      <Form method="get" className="erp-toolbar">
        {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
        <Field label="Status">
          <select className="orbit-select" name="status" defaultValue={filters.status ?? ""}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Type">
          <select className="orbit-select" name="type" defaultValue={filters.type ?? ""}>
            <option value="">All</option>
            {ENCOUNTER_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}
          </select>
        </Field>
        <Field label="Started on">
          <input className="orbit-input" type="date" name="date" defaultValue={filters.date ?? ""} />
        </Field>
        <button className="orbit-button" data-variant="secondary" type="submit">Filter</button>
      </Form>

      {list.items.length ? (
        <ScrollRegion label="Visits">
          <table className="workspace-table erp-table">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Type</th>
                <th scope="col">Department</th>
                <th scope="col">Doctor</th>
                <th scope="col">Started</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map(({ encounter, patientName, mrn }) => (
                <tr key={encounter.encounterId}>
                  <th scope="row">
                    <Link className="workspace-inline-link" to={href(`/visits/${encounter.encounterId}`)}>{patientName}</Link>
                    <span className="erp-sub">{mrn}</span>
                  </th>
                  <td>{label(encounter.encounterType)}</td>
                  <td>{departmentName(encounter.departmentId)}</td>
                  <td>{encounter.attendingDoctorName ?? "—"}</td>
                  <td>{when(encounter.startedAt)}</td>
                  <td><VisitStatus status={encounter.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p className="workspace-empty">No visits match.</p>
      )}
      <Pager {...list.page} href={(page) => href("/visits", { ...filters, page: String(page) })} />
    </>
  );
}

export interface VisitPageData {
  detail: EncounterDetailResponse;
  bills: BillListResponse;
  services: ServiceCatalogueResponse;
  staff: StaffListResponse;
  doctors: DoctorListResponse;
}

export function visitDetailLoader(environment: WorkspaceEnvironment) {
  return async ({ request, params }: LoaderFunctionArgs): Promise<VisitPageData> =>
    withClient(environment, request, async (client) => {
      const detail = await client.erp.encounter(params["encounterId"] ?? "");
      const facilityId = detail.encounter.facilityId;
      const [services, staff, doctors, bills] = await Promise.all([
        client.erp.services({ facilityId }),
        client.erp.staff({ facilityId, employmentStatus: "active", pageSize: 100 }),
        client.erp.doctors({ facilityId, pageSize: 100 }),
        client.erp.bills({ encounterId: detail.encounter.encounterId, pageSize: 100 }),
      ]);
      return { detail, services, staff, doctors, bills };
    });
}

export function visitDetailAction(environment: WorkspaceEnvironment) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ErpActionResult | Response> => {
    const form = await request.formData();
    const encounterId = params["encounterId"] ?? "";
    switch (formText(form, "intent")) {
      case "add-service": {
        const performedAt = instantFromLocal(formText(form, "performedAt"));
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.recordDelivery(encounterId, {
              serviceId: formText(form, "serviceId"),
              performedByStaffId: formText(form, "performedByStaffId"),
              quantity: Number(formText(form, "quantity") || "1"),
              idempotencyKey: formText(form, "idempotencyKey"),
              ...(performedAt ? { performedAt } : {}),
            }),
          "Service recorded.",
        );
      }
      case "cancel-service":
        return erpMutation(
          environment,
          request,
          (client) => client.erp.updateDelivery(formText(form, "deliveryId"), { version: Number(formText(form, "version")), status: "cancelled" }),
          "Service record cancelled.",
        );
      case "close":
      case "cancel": {
        const endedAt = instantFromLocal(formText(form, "endedAt"));
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.updateEncounter(encounterId, {
              version: Number(formText(form, "version")),
              status: formText(form, "intent") === "close" ? "closed" : "cancelled",
              ...(endedAt ? { endedAt } : {}),
            }),
          formText(form, "intent") === "close" ? "Visit closed." : "Visit cancelled.",
        );
      }
      case "issue-bill": {
        const issued = await mutate(environment, request, (client) =>
          client.erp.issueBill(encounterId, { idempotencyKey: formText(form, "idempotencyKey") }),
        );
        if (!issued.ok) return issued;
        return redirect(`/erp/billing/${encodeURIComponent(issued.value.bill.billId)}${facilityParam(request)}`);
      }
      case "assign-doctor":
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.updateEncounter(encounterId, {
              version: Number(formText(form, "version")),
              attendingDoctorId: formText(form, "attendingDoctorId") || null,
            }),
          "Attending doctor updated.",
        );
      default:
        return { ok: false, code: "invalid_request", message: "Unknown request." };
    }
  };
}

export function VisitDetailRoute() {
  const { detail, services, staff, doctors, bills } = useLoaderData<VisitPageData>();
  const result = useActionData<ErpActionResult>();
  const { facilityName, departmentName } = useErp();
  const href = useErpHref();
  const { encounter, patient, deliveries } = detail;
  const open = encounter.status === "open";
  const offered = services.items.filter((item) => item.service.isActive && item.availability?.isAvailable);
  const practising = doctors.items.filter((doctor) => ["active", "expiring"].includes(doctor.credentialStatus));
  // Fixed per render of this page: a double submit replays rather than recording twice.
  const [deliveryKey] = useState(() => crypto.randomUUID());
  const completed = deliveries.filter((delivery) => delivery.status === "completed");
  // Doctors first; the attending doctor is preselected. Who may perform which service is not restricted here.
  const performers = [...staff.items.filter((person) => person.staffType === "doctor"), ...staff.items.filter((person) => person.staffType !== "doctor")];

  return (
    <>
      <title>{`Visit for ${patient.displayName} | Orbit hospital operations`}</title>
      <ErpBack to={href("/visits")} />
      <SurfaceHeading
        eyebrow={`${label(encounter.encounterType)} visit · ${facilityName(encounter.facilityId)}`}
        title={patient.displayName}
        description={`${patient.mrn}. ${departmentName(encounter.departmentId)}. Started ${when(encounter.startedAt)}${encounter.endedAt ? `, ended ${when(encounter.endedAt)}` : ""}.`}
        aside={<VisitStatus status={encounter.status} />}
      />
      <ErpDisclosure />
      <FormMessage result={result} />
      <p>
        <Link className="workspace-inline-link" to={href(`/patients/${patient.patientId}`)}>Patient record</Link>
      </p>

      <section className="workspace-section" aria-labelledby="services-heading">
        <div className="workspace-section__heading">
          <h2 id="services-heading">Services delivered</h2>
          <p>{completed.length} recorded. Amounts come from this hospital's price list; every amount is illustrative, none is a real charge.</p>
        </div>
        {deliveries.length ? (
          <ScrollRegion label="Services delivered">
            <table className="workspace-table erp-table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Performed by</th>
                  <th scope="col">When</th>
                  <th scope="col">Qty</th>
                  <th scope="col" data-numeric="true">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.deliveryId}>
                    <th scope="row">
                      {delivery.serviceName}
                      <span className="erp-sub">{delivery.serviceCode} · {label(delivery.category)}</span>
                    </th>
                    <td>{delivery.performedByName}</td>
                    <td>{when(delivery.performedAt)}</td>
                    <td>{delivery.quantity} {label(delivery.unit).toLowerCase()}</td>
                    <td data-numeric="true">{delivery.illustrativeAmount === null ? "No price set" : <span className="is-illustrative">{money(delivery.illustrativeAmount, bills.currency)}</span>}</td>
                    <td>
                      {delivery.status === "completed" ? (
                        <Form method="post" className="erp-inline-form">
                          <input type="hidden" name="intent" value="cancel-service" />
                          <input type="hidden" name="deliveryId" value={delivery.deliveryId} />
                          <input type="hidden" name="version" value={delivery.version} />
                          <span className="orbit-status" data-state="ready">Completed</span>
                          <button className="orbit-button" data-variant="quiet" type="submit">Cancel</button>
                        </Form>
                      ) : (
                        <span className="orbit-status" data-state="unavailable">Cancelled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : (
          <p className="workspace-empty">No services recorded yet.</p>
        )}
      </section>

      <VisitBilling bills={bills} visitStatus={encounter.status} completedServices={completed.length} />

      {encounter.status !== "cancelled" ? (
        <section className="workspace-panel" aria-labelledby="add-service-heading">
          <h2 id="add-service-heading">Record a service</h2>
          {offered.length ? (
            <Form method="post" className="erp-form-grid">
              <input type="hidden" name="intent" value="add-service" />
              <input type="hidden" name="idempotencyKey" value={deliveryKey} />
              <Field label="Service" hint="Only services offered at this facility.">
                <select className="orbit-select" name="serviceId" required>
                  {offered.map(({ service }) => <option key={service.serviceId} value={service.serviceId}>{service.name}</option>)}
                </select>
              </Field>
              <Field label="Performed by">
                <select className="orbit-select" name="performedByStaffId" required defaultValue={encounter.attendingDoctorId ?? undefined}>
                  {performers.map((person) => (
                    <option key={person.staffId} value={person.staffId}>{person.displayName} ({label(person.staffType)})</option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity">
                <input className="orbit-input" type="number" name="quantity" min={1} max={100} defaultValue={1} />
              </Field>
              <Field label="Performed at (UTC)" hint={open ? "Leave empty for now." : "Must fall within the visit."}>
                <input className="orbit-input" type="datetime-local" name="performedAt" required={!open} />
              </Field>
              <button className="orbit-button" type="submit">Record service</button>
            </Form>
          ) : (
            <p className="workspace-empty">No services are offered at this facility yet.</p>
          )}
        </section>
      ) : null}

      {open ? (
        <div className="erp-two-column">
          <section className="workspace-panel" aria-labelledby="doctor-heading">
            <h2 id="doctor-heading">Attending doctor</h2>
            <Form method="post" className="erp-form-grid">
              <input type="hidden" name="intent" value="assign-doctor" />
              <input type="hidden" name="version" value={encounter.version} />
              <Field label="Doctor">
                <select className="orbit-select" name="attendingDoctorId" defaultValue={encounter.attendingDoctorId ?? ""}>
                  <option value="">Not assigned</option>
                  {practising.map((doctor) => <option key={doctor.staffId} value={doctor.staffId}>{doctor.displayName}</option>)}
                </select>
              </Field>
              <button className="orbit-button" data-variant="secondary" type="submit">Save</button>
            </Form>
          </section>
          <section className="workspace-panel" aria-labelledby="close-heading">
            <h2 id="close-heading">Finish the visit</h2>
            <Form method="post" className="erp-form-grid">
              <input type="hidden" name="version" value={encounter.version} />
              <Field label="Ended at (UTC)" hint="Leave empty for now.">
                <input className="orbit-input" type="datetime-local" name="endedAt" />
              </Field>
              <button className="orbit-button" name="intent" value="close" type="submit">
                {encounter.encounterType === "inpatient" ? "Discharge" : "Close visit"}
              </button>
              <button className="orbit-button" data-variant="danger" name="intent" value="cancel" type="submit" disabled={completed.length > 0}>
                Cancel visit
              </button>
            </Form>
          </section>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Services catalogue
// ---------------------------------------------------------------------------

export function servicesLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    return withClient(environment, request, (client) =>
      client.erp.services({
        facilityId: facilityFromUrl(request) ?? undefined,
        category: url.searchParams.get("category"),
        includeInactive: url.searchParams.get("inactive") === "true" ? "true" : undefined,
      }),
    );
  };
}

export function servicesAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<ErpActionResult> => {
    const form = await request.formData();
    switch (formText(form, "intent")) {
      case "create":
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.createService({
              serviceCode: formText(form, "serviceCode").trim().toUpperCase(),
              name: formText(form, "name"),
              category: formText(form, "category"),
              departmentId: formText(form, "departmentId"),
              unit: formText(form, "unit"),
            }),
          "Service added to the catalogue. Offer it at a facility to use it.",
        );
      case "availability": {
        const version = formText(form, "version");
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.setAvailability(formText(form, "facilityId"), formText(form, "serviceId"), {
              isAvailable: formText(form, "isAvailable") === "true",
              ...(version ? { version: Number(version) } : {}),
            }),
          formText(form, "isAvailable") === "true" ? "Service offered here." : "Service withdrawn here.",
        );
      }
      case "price": {
        const price = formText(form, "price").trim();
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.setAvailability(formText(form, "facilityId"), formText(form, "serviceId"), {
              isAvailable: formText(form, "isAvailable") === "true",
              illustrativeTariff: price === "" ? null : Math.round(Number(price) * 100) / 100,
              version: Number(formText(form, "version")),
            }),
          price === "" ? "Price removed." : "Price saved.",
        );
      }
      case "active":
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.updateService(formText(form, "serviceId"), {
              version: Number(formText(form, "version")),
              isActive: formText(form, "isActive") === "true",
            }),
          "Catalogue updated.",
        );
      default:
        return { ok: false, code: "invalid_request", message: "Unknown request." };
    }
  };
}

export function ServicesRoute() {
  const catalogue = useLoaderData<ServiceCatalogueResponse>();
  const result = useActionData<ErpActionResult>();
  const { isAdmin, facilityName, facilityId, departmentName, reference } = useErp();
  const [search] = useSearchParams();

  return (
    <>
      <title>Services | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title="Services"
        description={`The organization's service catalogue, which services this facility offers, and their prices in ${catalogue.currency}. A service can be recorded in a visit only where it is offered, and billed only once it has a price. Prices are illustrative.`}
      />
      <ErpDisclosure />
      <FormMessage result={result} />
      <Form method="get" className="erp-toolbar">
        {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
        <Field label="Category">
          <select className="orbit-select" name="category" defaultValue={search.get("category") ?? ""}>
            <option value="">All</option>
            {SERVICE_CATEGORIES.map((category) => <option key={category} value={category}>{label(category)}</option>)}
          </select>
        </Field>
        {isAdmin ? (
          <label className="erp-check">
            <input type="checkbox" name="inactive" value="true" defaultChecked={search.get("inactive") === "true"} /> Include retired
          </label>
        ) : null}
        <button className="orbit-button" data-variant="secondary" type="submit">Filter</button>
      </Form>

      {isAdmin ? (
        <details className="erp-details">
          <summary>Add a service to the catalogue</summary>
          <Form method="post" className="erp-form-grid">
            <input type="hidden" name="intent" value="create" />
            <Field label="Code" hint="3–16 capital letters, digits or hyphens.">
              <input className="orbit-input" name="serviceCode" required pattern="[A-Za-z0-9-]{3,16}" />
            </Field>
            <Field label="Name">
              <input className="orbit-input" name="name" required maxLength={120} />
            </Field>
            <Field label="Category">
              <select className="orbit-select" name="category">
                {SERVICE_CATEGORIES.map((category) => <option key={category} value={category}>{label(category)}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select className="orbit-select" name="departmentId">
                {reference.departments.map((department) => <option key={department.departmentId} value={department.departmentId}>{department.name}</option>)}
              </select>
            </Field>
            <Field label="Unit">
              <select className="orbit-select" name="unit">
                {SERVICE_UNITS.map((unit) => <option key={unit} value={unit}>{label(unit)}</option>)}
              </select>
            </Field>
            <button className="orbit-button" type="submit">Add</button>
          </Form>
        </details>
      ) : null}

      <ScrollRegion label="Service catalogue">
        <table className="workspace-table erp-table">
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">Category</th>
              <th scope="col">Department</th>
              <th scope="col">Unit</th>
              <th scope="col">At {facilityName(facilityId)}</th>
              <th scope="col">Price ({catalogue.currency})</th>
              {isAdmin ? <th scope="col">Catalogue</th> : null}
            </tr>
          </thead>
          <tbody>
            {catalogue.items.map(({ service, availability }) => (
              <tr key={service.serviceId}>
                <th scope="row">
                  {service.name}
                  <span className="erp-sub">{service.serviceCode}{service.isActive ? "" : " · retired"}</span>
                </th>
                <td>{label(service.category)}</td>
                <td>{departmentName(service.departmentId)}</td>
                <td>{label(service.unit)}</td>
                <td>
                  <Form method="post" className="erp-inline-form">
                    <input type="hidden" name="intent" value="availability" />
                    <input type="hidden" name="facilityId" value={facilityId} />
                    <input type="hidden" name="serviceId" value={service.serviceId} />
                    {availability ? <input type="hidden" name="version" value={availability.version} /> : null}
                    <span className="orbit-status" data-state={availability?.isAvailable ? "ready" : "empty"}>
                      {availability?.isAvailable ? "Offered" : "Not offered"}
                    </span>
                    {availability ? (
                      <button className="orbit-button" data-variant="quiet" name="isAvailable" value={availability.isAvailable ? "false" : "true"} type="submit">
                        {availability.isAvailable ? "Withdraw" : "Offer again"}
                      </button>
                    ) : isAdmin && service.isActive ? (
                      <button className="orbit-button" data-variant="quiet" name="isAvailable" value="true" type="submit">Offer here</button>
                    ) : null}
                  </Form>
                </td>
                <td>
                  {availability && isAdmin ? (
                    <Form method="post" className="erp-inline-form">
                      <input type="hidden" name="intent" value="price" />
                      <input type="hidden" name="facilityId" value={facilityId} />
                      <input type="hidden" name="serviceId" value={service.serviceId} />
                      <input type="hidden" name="version" value={availability.version} />
                      <input type="hidden" name="isAvailable" value={availability.isAvailable ? "true" : "false"} />
                      <label className="orbit-visually-hidden" htmlFor={`price-${service.serviceId}`}>Price of {service.name}</label>
                      <input
                        id={`price-${service.serviceId}`}
                        className="orbit-input erp-price-input"
                        type="number"
                        name="price"
                        min={0}
                        max={10000000}
                        step="0.01"
                        defaultValue={availability.illustrativeTariff ?? ""}
                        placeholder="Not set"
                      />
                      <button className="orbit-button" data-variant="quiet" type="submit" aria-label={`Save price of ${service.name}`}>
                        <span aria-hidden="true">Save</span>
                      </button>
                    </Form>
                  ) : availability === null || availability.illustrativeTariff === null ? (
                    <span className="erp-sub">{availability ? "Not set" : "—"}</span>
                  ) : (
                    <span className="is-illustrative">{money(availability.illustrativeTariff, catalogue.currency)}</span>
                  )}
                </td>
                {isAdmin ? (
                  <td>
                    <Form method="post" className="erp-inline-form">
                      <input type="hidden" name="intent" value="active" />
                      <input type="hidden" name="serviceId" value={service.serviceId} />
                      <input type="hidden" name="version" value={service.version} />
                      <button
                        className="orbit-button"
                        data-variant="quiet"
                        name="isActive"
                        value={service.isActive ? "false" : "true"}
                        type="submit"
                        aria-label={`${service.isActive ? "Retire" : "Reinstate"} ${service.name}`}
                      >
                        <span aria-hidden="true">{service.isActive ? "Retire" : "Reinstate"}</span>
                      </button>
                    </Form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}

// ---------------------------------------------------------------------------
// ERP audit trail (admins)
// ---------------------------------------------------------------------------

export function erpAuditLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) => {
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1") || 1;
    return withClient(environment, request, (client) => client.erp.audit({ page }));
  };
}

export function ErpAuditRoute() {
  const audit = useLoaderData<ErpAuditResponse>();
  const href = useErpHref();
  return (
    <>
      <title>Audit trail | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow="Accountability"
        title="Hospital operations audit trail"
        description="Who viewed or changed which record, and when — never the record's contents. Every patient record and visit opened is listed. Application-protected, not a claim of immutability."
      />
      <ErpDisclosure />
      {audit.items.length ? (
        <ScrollRegion label="Audit events">
          <table className="workspace-table erp-table">
            <caption>Most recent first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Account role</th>
                <th scope="col">Action</th>
                <th scope="col">Record</th>
                <th scope="col">Reference</th>
              </tr>
            </thead>
            <tbody>
              {audit.items.map((event) => (
                <tr key={event.eventId}>
                  <td>{when(event.occurredAt)}</td>
                  <td>{label(event.actorRole)}</td>
                  <th scope="row">{label(event.action)}</th>
                  <td>
                    {event.targetType === "patient" ? (
                      <Link className="workspace-inline-link" to={href(`/patients/${event.targetId}`)}>Patient</Link>
                    ) : event.targetType === "encounter" ? (
                      <Link className="workspace-inline-link" to={href(`/visits/${event.targetId}`)}>Visit</Link>
                    ) : (
                      label(event.targetType)
                    )}
                  </td>
                  <td className="workspace-reference">{event.requestId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p className="workspace-empty">No hospital operations activity has been recorded yet.</p>
      )}
      <Pager {...audit.page} href={(page) => href("/audit", { page: String(page) })} />
    </>
  );
}
