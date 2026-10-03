import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { AttendanceStatusSchema } from "@orbit/contracts";
import type {
  DoctorDetailResponse,
  DoctorListResponse,
  StaffAttendanceResponse,
  StaffListResponse,
} from "@orbit/contracts";
import { formText } from "../../lib/form";
import { ScrollRegion, SurfaceHeading } from "../workspace/components";
import { withClient, type WorkspaceEnvironment } from "../workspace/environment";
import { ErpBack } from "./back";
import { erpMutation, type ErpActionResult } from "./home";
import {
  ATTENDANCE_LABEL,
  AttendanceChip,
  clock,
  CredentialChip,
  day,
  duration,
  ErpDisclosure,
  facilityFromUrl,
  Field,
  FormMessage,
  label,
  Pager,
  workedText,
  useErp,
  useErpHref,
} from "./shared";

const STAFF_TYPES = ["nurse", "technician", "administrative", "support"] as const;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function DepartmentSelect({ name = "departmentId", defaultValue }: { name?: string; defaultValue?: string }) {
  const { reference } = useErp();
  return (
    <select className="orbit-select" name={name} defaultValue={defaultValue} required>
      {reference.departments.map((department) => (
        <option key={department.departmentId} value={department.departmentId}>
          {department.name}
        </option>
      ))}
    </select>
  );
}

function SpecialtySelect({ defaultValue }: { defaultValue?: string }) {
  const { reference } = useErp();
  return (
    <select className="orbit-select" name="specialtyId" defaultValue={defaultValue} required>
      {reference.specialties.map((specialty) => (
        <option key={specialty.specialtyId} value={specialty.specialtyId}>
          {specialty.name}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Staff list
// ---------------------------------------------------------------------------

export function staffListLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    return withClient(environment, request, (client) =>
      client.erp.staff({
        facilityId: facilityFromUrl(request),
        q: url.searchParams.get("q"),
        staffType: url.searchParams.get("type"),
        employmentStatus: url.searchParams.get("status"),
        page: url.searchParams.get("page"),
      }),
    );
  };
}

export function staffListAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<ErpActionResult> => {
    const form = await request.formData();
    const doctor = formText(form, "kind") === "doctor";
    const base = {
      facilityId: formText(form, "facilityId"),
      departmentId: formText(form, "departmentId"),
      employeeCode: formText(form, "employeeCode").trim().toUpperCase(),
      displayName: formText(form, "displayName"),
      designation: formText(form, "designation"),
      joinedOn: formText(form, "joinedOn"),
      isCriticalRole: form.get("isCriticalRole") === "on",
    };
    return doctor
      ? erpMutation(
          environment,
          request,
          (client) =>
            client.erp.createDoctor({
              ...base,
              specialtyId: formText(form, "specialtyId"),
              registrationNumber: formText(form, "registrationNumber").trim().toUpperCase(),
              credentialExpiresOn: formText(form, "credentialExpiresOn"),
              employmentType: formText(form, "employmentType") || "employed",
            }),
          `Doctor ${base.displayName} added.`,
        )
      : erpMutation(
          environment,
          request,
          (client) => client.erp.createStaff({ ...base, staffType: formText(form, "staffType") }),
          `${base.displayName} added.`,
        );
  };
}

function AddPersonForm({ doctor }: { doctor: boolean }) {
  const { facilityId } = useErp();
  return (
    <details className="erp-details">
      <summary>{doctor ? "Add a doctor" : "Add staff"}</summary>
      <Form method="post" className="erp-form-grid">
        <input type="hidden" name="kind" value={doctor ? "doctor" : "staff"} />
        <input type="hidden" name="facilityId" value={facilityId} />
        <Field label="Full name (fictional)">
          <input className="orbit-input" name="displayName" required maxLength={120} />
        </Field>
        <Field label="Employee code" hint="Capital letters, digits and hyphens.">
          <input className="orbit-input" name="employeeCode" required pattern="[A-Za-z0-9-]{3,20}" />
        </Field>
        {doctor ? null : (
          <Field label="Staff type">
            <select className="orbit-select" name="staffType">
              {STAFF_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Designation">
          <input className="orbit-input" name="designation" required maxLength={80} defaultValue={doctor ? "Attending physician" : ""} />
        </Field>
        <Field label="Department">
          <DepartmentSelect />
        </Field>
        <Field label="Joined on">
          <input className="orbit-input" type="date" name="joinedOn" required />
        </Field>
        {doctor ? (
          <>
            <Field label="Specialty">
              <SpecialtySelect />
            </Field>
            <Field label="Registration number" hint="Fictional format DEMO-REG-0000.">
              <input className="orbit-input" name="registrationNumber" required pattern="DEMO-REG-[0-9]{4,8}" />
            </Field>
            <Field label="Credential expires on">
              <input className="orbit-input" type="date" name="credentialExpiresOn" required />
            </Field>
            <Field label="Employment">
              <select className="orbit-select" name="employmentType">
                <option value="employed">Employed</option>
                <option value="visiting">Visiting</option>
                <option value="consultant">Consultant</option>
              </select>
            </Field>
          </>
        ) : null}
        <label className="erp-check">
          <input type="checkbox" name="isCriticalRole" /> Critical role
        </label>
        <button className="orbit-button" type="submit">Add</button>
      </Form>
    </details>
  );
}

export function StaffListRoute() {
  const list = useLoaderData<StaffListResponse>();
  const result = useActionData<ErpActionResult>();
  const { isAdmin, facilityName, facilityId, departmentName } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();

  return (
    <>
      <title>Staff | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title="Staff"
        description="Everyone who works at this facility, including doctors. Records hold no salary, contact or identity-document details."
      />
      <ErpDisclosure />
      <FormMessage result={result} />
      <Form method="get" className="erp-toolbar">
        {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
        <Field label="Search">
          <input className="orbit-input" name="q" defaultValue={search.get("q") ?? ""} placeholder="Name or code" />
        </Field>
        <Field label="Type">
          <select className="orbit-select" name="type" defaultValue={search.get("type") ?? ""}>
            <option value="">All</option>
            {["doctor", ...STAFF_TYPES].map((type) => <option key={type} value={type}>{label(type)}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="orbit-select" name="status" defaultValue={search.get("status") ?? ""}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="on-leave">On leave</option>
            <option value="exited">Exited</option>
          </select>
        </Field>
        <button className="orbit-button" data-variant="secondary" type="submit">Filter</button>
      </Form>
      {isAdmin ? (
        <div className="erp-actions-row">
          <AddPersonForm doctor={false} />
          <AddPersonForm doctor />
        </div>
      ) : null}

      <ScrollRegion label="Staff">
        <table className="workspace-table erp-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Code</th>
              <th scope="col">Type</th>
              <th scope="col">Department</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((staff) => (
              <tr key={staff.staffId}>
                <th scope="row">
                  <Link className="workspace-inline-link" to={href(`/staff/${staff.staffId}`)}>{staff.displayName}</Link>
                  <span className="erp-sub">{staff.designation}{staff.isCriticalRole ? " · critical role" : ""}</span>
                </th>
                <td className="workspace-reference">{staff.employeeCode}</td>
                <td>{label(staff.staffType)}</td>
                <td>{departmentName(staff.departmentId)}</td>
                <td>{label(staff.employmentStatus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <Pager
        {...list.page}
        href={(page) => href("/staff", { q: search.get("q") ?? undefined, type: search.get("type") ?? undefined, status: search.get("status") ?? undefined, page: String(page) })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Staff detail with a month of attendance
// ---------------------------------------------------------------------------

export function staffDetailLoader(environment: WorkspaceEnvironment) {
  return async ({ request, params }: LoaderFunctionArgs) => {
    const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    return withClient(environment, request, (client) => client.erp.staffAttendance(params["staffId"] ?? "", month));
  };
}

export function staffDetailAction(environment: WorkspaceEnvironment) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ErpActionResult> => {
    const form = await request.formData();
    const status = formText(form, "employmentStatus");
    const exitedOn = formText(form, "exitedOn");
    return erpMutation(
      environment,
      request,
      (client) =>
        client.erp.updateStaff(params["staffId"] ?? "", {
          version: Number(formText(form, "version")),
          designation: formText(form, "designation"),
          departmentId: formText(form, "departmentId"),
          employmentStatus: status,
          exitedOn: status === "exited" ? exitedOn : null,
          isCriticalRole: form.get("isCriticalRole") === "on",
        }),
      "Saved.",
    );
  };
}

export function StaffDetailRoute() {
  const data = useLoaderData<StaffAttendanceResponse>();
  const result = useActionData<ErpActionResult>();
  const { isAdmin, facilityName, departmentName, shiftName } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();
  const { staff } = data;

  return (
    <>
      <title>{`${staff.displayName} | Orbit hospital operations`}</title>
      <ErpBack to={href("/staff")} />
      <SurfaceHeading
        eyebrow={`${label(staff.staffType)} · ${facilityName(staff.facilityId)}`}
        title={staff.displayName}
        description={`${staff.designation}, ${departmentName(staff.departmentId)}. Employee code ${staff.employeeCode}. Joined ${day(staff.joinedOn)}.`}
      />
      <ErpDisclosure />
      <FormMessage result={result} />

      <div className="erp-two-column">
        <section className="workspace-panel" aria-labelledby="profile-heading">
          <h2 id="profile-heading">Profile</h2>
          <dl className="erp-facts">
            <div><dt>Status</dt><dd>{label(staff.employmentStatus)}{staff.exitedOn ? ` (left ${day(staff.exitedOn)})` : ""}</dd></div>
            <div><dt>Critical role</dt><dd>{staff.isCriticalRole ? "Yes" : "No"}</dd></div>
            <div><dt>Department</dt><dd>{departmentName(staff.departmentId)}</dd></div>
          </dl>
          {staff.staffType === "doctor" ? (
            <Link className="workspace-inline-link" to={href(`/doctors/${staff.staffId}`)}>Credentials and schedule</Link>
          ) : null}
          {isAdmin ? (
            <details className="erp-details">
              <summary>Edit</summary>
              <Form method="post" className="erp-form-grid">
                <input type="hidden" name="version" value={staff.version} />
                <Field label="Designation">
                  <input className="orbit-input" name="designation" defaultValue={staff.designation} required maxLength={80} />
                </Field>
                <Field label="Department">
                  <DepartmentSelect defaultValue={staff.departmentId} />
                </Field>
                <Field label="Status">
                  <select className="orbit-select" name="employmentStatus" defaultValue={staff.employmentStatus}>
                    <option value="active">Active</option>
                    <option value="on-leave">On leave</option>
                    <option value="exited">Exited</option>
                  </select>
                </Field>
                <Field label="Exit date" hint="Required when the status is Exited.">
                  <input className="orbit-input" type="date" name="exitedOn" defaultValue={staff.exitedOn ?? ""} />
                </Field>
                <label className="erp-check">
                  <input type="checkbox" name="isCriticalRole" defaultChecked={staff.isCriticalRole} /> Critical role
                </label>
                <button className="orbit-button" type="submit">Save</button>
              </Form>
            </details>
          ) : null}
        </section>

        <section className="workspace-panel" aria-labelledby="month-heading">
          <h2 id="month-heading">Attendance, {data.month}</h2>
          <Form method="get" className="erp-toolbar">
            {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
            <Field label="Month">
              <input className="orbit-input" type="month" name="month" defaultValue={data.month} />
            </Field>
            <button className="orbit-button" data-variant="secondary" type="submit">Show</button>
          </Form>
          <ul className="erp-counts" aria-label="Month counts">
            <li><strong>{duration(data.workedMinutes)}</strong> worked on complete days</li>
            {AttendanceStatusSchema.options
              .filter((status) => data.counts[status] > 0)
              .map((status) => (
                <li key={status}><strong>{data.counts[status]}</strong> {ATTENDANCE_LABEL[status].toLowerCase()}</li>
              ))}
          </ul>
        </section>
      </div>

      <ScrollRegion label="Days">
        <table className="workspace-table erp-table">
          <caption>Times are UTC</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Shift</th>
              <th scope="col">Status</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
              <th scope="col">Worked</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((attendance) => (
              <tr key={attendance.shiftDate}>
                <th scope="row">{day(attendance.shiftDate)}</th>
                <td>{attendance.shiftTemplateId ? `${shiftName(attendance.shiftTemplateId)} ${clock(attendance.shiftStart)}–${clock(attendance.shiftEnd)}` : "—"}</td>
                <td>
                  <AttendanceChip status={attendance.status} />
                  {attendance.corrected ? <span className="erp-sub">Corrected</span> : null}
                </td>
                <td>{clock(attendance.firstIn)}</td>
                <td>{clock(attendance.lastOut)}</td>
                <td>{workedText(attendance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}

// ---------------------------------------------------------------------------
// Doctors
// ---------------------------------------------------------------------------

export function doctorsLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    return withClient(environment, request, (client) =>
      client.erp.doctors({
        facilityId: facilityFromUrl(request),
        q: url.searchParams.get("q"),
        credentialStatus: url.searchParams.get("credential"),
        page: url.searchParams.get("page"),
      }),
    );
  };
}

export function DoctorsRoute() {
  const list = useLoaderData<DoctorListResponse>();
  const result = useActionData<ErpActionResult>();
  const { isAdmin, facilityName, facilityId, specialtyName } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();

  return (
    <>
      <title>Doctors | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title="Doctors"
        description="Specialty, fictional registration number and credential status. A doctor whose credential is expired or suspended cannot be assigned to visits or services."
      />
      <ErpDisclosure />
      <FormMessage result={result} />
      <Form method="get" className="erp-toolbar">
        {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
        <Field label="Search">
          <input className="orbit-input" name="q" defaultValue={search.get("q") ?? ""} placeholder="Name or registration" />
        </Field>
        <Field label="Credential">
          <select className="orbit-select" name="credential" defaultValue={search.get("credential") ?? ""}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="expiring">Expiring</option>
            <option value="expired">Expired</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        <button className="orbit-button" data-variant="secondary" type="submit">Filter</button>
      </Form>
      {isAdmin ? <AddPersonForm doctor /> : null}

      <ScrollRegion label="Doctors">
        <table className="workspace-table erp-table">
          <thead>
            <tr>
              <th scope="col">Doctor</th>
              <th scope="col">Specialty</th>
              <th scope="col">Registration</th>
              <th scope="col">Credential</th>
              <th scope="col">Expires</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((doctor) => (
              <tr key={doctor.staffId}>
                <th scope="row">
                  <Link className="workspace-inline-link" to={href(`/doctors/${doctor.staffId}`)}>{doctor.displayName}</Link>
                  <span className="erp-sub">{doctor.designation} · {label(doctor.employmentType)}</span>
                </th>
                <td>{specialtyName(doctor.specialtyId)}</td>
                <td className="workspace-reference">{doctor.registrationNumber}</td>
                <td><CredentialChip status={doctor.credentialStatus} /></td>
                <td>{day(doctor.credentialExpiresOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <Pager {...list.page} href={(page) => href("/doctors", { q: search.get("q") ?? undefined, credential: search.get("credential") ?? undefined, page: String(page) })} />
    </>
  );
}

export function doctorDetailLoader(environment: WorkspaceEnvironment) {
  return async ({ request, params }: LoaderFunctionArgs) =>
    withClient(environment, request, (client) => client.erp.doctor(params["staffId"] ?? ""));
}

export function doctorDetailAction(environment: WorkspaceEnvironment) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ErpActionResult> => {
    const form = await request.formData();
    const staffId = params["staffId"] ?? "";
    switch (formText(form, "intent")) {
      case "credential":
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.updateDoctor(staffId, {
              version: Number(formText(form, "version")),
              specialtyId: formText(form, "specialtyId"),
              credentialExpiresOn: formText(form, "credentialExpiresOn"),
              credentialSuspended: form.get("credentialSuspended") === "on",
            }),
          "Credential saved.",
        );
      case "add-slot":
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.addScheduleSlot(staffId, {
              facilityId: formText(form, "facilityId"),
              weekday: Number(formText(form, "weekday")),
              startTime: formText(form, "startTime"),
              endTime: formText(form, "endTime"),
            }),
          "Consultation slot added.",
        );
      case "retire-slot":
        return erpMutation(
          environment,
          request,
          (client) => client.erp.updateScheduleSlot(formText(form, "slotId"), { isActive: formText(form, "isActive") === "true" }),
          "Slot updated.",
        );
      default:
        return { ok: false, code: "invalid_request", message: "Unknown request." };
    }
  };
}

export function DoctorDetailRoute() {
  const { doctor, schedule } = useLoaderData<DoctorDetailResponse>();
  const result = useActionData<ErpActionResult>();
  const { isAdmin, facilityName, specialtyName, departmentName } = useErp();
  const href = useErpHref();

  return (
    <>
      <title>{`${doctor.displayName} | Orbit hospital operations`}</title>
      <ErpBack to={href("/doctors")} />
      <SurfaceHeading
        eyebrow={`${specialtyName(doctor.specialtyId)} · ${facilityName(doctor.facilityId)}`}
        title={doctor.displayName}
        description={`${doctor.designation}, ${departmentName(doctor.departmentId)}. Registration ${doctor.registrationNumber} (fictional).`}
        aside={<CredentialChip status={doctor.credentialStatus} />}
      />
      <ErpDisclosure />
      <FormMessage result={result} />

      <div className="erp-two-column">
        <section className="workspace-panel" aria-labelledby="credential-heading">
          <h2 id="credential-heading">Credential</h2>
          <dl className="erp-facts">
            <div><dt>Status</dt><dd><CredentialChip status={doctor.credentialStatus} /></dd></div>
            <div><dt>Expires</dt><dd>{day(doctor.credentialExpiresOn)}</dd></div>
            <div><dt>Suspended</dt><dd>{doctor.credentialSuspended ? "Yes" : "No"}</dd></div>
            <div><dt>Employment</dt><dd>{label(doctor.employmentType)}</dd></div>
          </dl>
          <Link className="workspace-inline-link" to={href(`/staff/${doctor.staffId}`)}>Attendance</Link>
          {isAdmin ? (
            <details className="erp-details">
              <summary>Update credential</summary>
              <Form method="post" className="erp-form-grid">
                <input type="hidden" name="intent" value="credential" />
                <input type="hidden" name="version" value={doctor.version} />
                <Field label="Specialty">
                  <SpecialtySelect defaultValue={doctor.specialtyId} />
                </Field>
                <Field label="Expires on">
                  <input className="orbit-input" type="date" name="credentialExpiresOn" defaultValue={doctor.credentialExpiresOn} required />
                </Field>
                <label className="erp-check">
                  <input type="checkbox" name="credentialSuspended" defaultChecked={doctor.credentialSuspended} /> Suspended
                </label>
                <button className="orbit-button" type="submit">Save</button>
              </Form>
            </details>
          ) : null}
        </section>

        <section className="workspace-panel" aria-labelledby="schedule-heading">
          <h2 id="schedule-heading">Consultation schedule</h2>
          {schedule.length ? (
            <ul className="erp-list">
              {schedule.map((slot) => (
                <li key={slot.slotId} data-inactive={!slot.isActive || undefined}>
                  <span>
                    {WEEKDAYS[slot.weekday - 1]} {slot.startTime}–{slot.endTime} · {facilityName(slot.facilityId)}
                    {slot.isActive ? "" : " (retired)"}
                  </span>
                  {isAdmin ? (
                    <Form method="post" className="erp-inline-form">
                      <input type="hidden" name="intent" value="retire-slot" />
                      <input type="hidden" name="slotId" value={slot.slotId} />
                      <input type="hidden" name="isActive" value={slot.isActive ? "false" : "true"} />
                      <button className="orbit-button" data-variant="quiet" type="submit">{slot.isActive ? "Retire" : "Restore"}</button>
                    </Form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-empty">No consultation slots.</p>
          )}
          {isAdmin ? (
            <details className="erp-details">
              <summary>Add a slot</summary>
              <Form method="post" className="erp-form-grid">
                <input type="hidden" name="intent" value="add-slot" />
                <input type="hidden" name="facilityId" value={doctor.facilityId} />
                <Field label="Day">
                  <select className="orbit-select" name="weekday">
                    {WEEKDAYS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                  </select>
                </Field>
                <Field label="From">
                  <input className="orbit-input" type="time" name="startTime" required defaultValue="09:00" />
                </Field>
                <Field label="To">
                  <input className="orbit-input" type="time" name="endTime" required defaultValue="12:00" />
                </Field>
                <button className="orbit-button" type="submit">Add slot</button>
              </Form>
            </details>
          ) : null}
        </section>
      </div>
    </>
  );
}
