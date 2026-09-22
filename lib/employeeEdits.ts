/*
 * Employee Editing — maker-checker changes to a live (Active/On Leave) employee's bio-data and
 * sub-entity lists. One edit request snapshots the
 * employee's current editable fields plus their sub-entity lists into shadow tables the maker
 * can freely amend; on approval, the whole snapshot replaces the live rows.
 */
import { one, all, run, tx, nextSequence, audit } from './db.ts';
import { AppError } from './errors.ts';
import { diffFields, logTableChange } from './changeLog.ts';
import {
  EMPLOYEE_EDITABLE_FIELDS, type EmployeeEditableField, type EmployeeInput,
  getEmployee, listNextOfKin, listBeneficiaries, listDependants, listEmergencyContacts,
  listProfessionalBodies, listWorkHistory, listBankAccounts,
  replaceNextOfKin, replaceBeneficiaries, replaceDependants, replaceEmergencyContacts,
  replaceProfessionalBodies, replaceWorkHistory, replaceBankAccounts, PAYROLL_SALARY_FIELDS, normalisePayrollFields, syncContractSalary,
} from './employees.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, Employee, EmployeeEditRequest, EmployeeEditRequestView,
  EmployeeEditNextOfKin, EmployeeEditBeneficiary, EmployeeEditDependant, EmployeeEditEmergencyContact,
  EmployeeEditProfessionalBody, EmployeeEditWorkHistory, EmployeeEditBankAccount,
} from './types.ts';
import { assertContactColumns, assertContactRows } from './validate.ts';
import { applySalaryScaleToEmployee } from './salaryScales.ts';

export type EmployeeEditView = 'open' | 'pending' | 'approved' | 'processed';

const VIEW_CLAUSE: Record<EmployeeEditView, string> = {
  open: "e.status = 'Open'",
  pending: "e.status = 'Pending Approval'",
  approved: "e.status = 'Approved'",
  processed: "e.status = 'Processed'",
};

const SELECT_EDIT = `
  SELECT e.*, emp.employee_no, emp.first_name AS employee_first_name, emp.last_name AS employee_last_name,
         jg.name AS job_grade_name, cj.job_id AS company_job_code, cj.name AS company_job_name, ppg.code AS posting_group_code, ppg.name AS posting_group_name, c.name AS county_name, sc.name AS sub_county_name,
         gd1.code AS global_dimension_1_code, gd1.name AS global_dimension_1_name,
         gd2.code AS global_dimension_2_code, gd2.name AS global_dimension_2_name
  FROM employee_edit_request e
  JOIN employee emp ON emp.id = e.employee_id
  LEFT JOIN hr_job_grade jg ON jg.id = e.job_grade_id
  LEFT JOIN company_job cj ON cj.id = e.company_job_id
  LEFT JOIN payroll_posting_group ppg ON ppg.id = e.posting_group_id
  LEFT JOIN county c ON c.id = e.county_id
  LEFT JOIN sub_county sc ON sc.id = e.sub_county_id
  LEFT JOIN global_dimension_1_value gd1 ON gd1.id = e.global_dimension_1_id
  LEFT JOIN global_dimension_2_value gd2 ON gd2.id = e.global_dimension_2_id`;

export const EDIT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'no', label: 'Request No.', type: 'text', column: 'e.no' },
  { key: 'global_dimension_1_id', label: 'Global Dimension 1', type: 'select', column: 'e.global_dimension_1_id' },
  { key: 'global_dimension_2_id', label: 'Global Dimension 2', type: 'select', column: 'e.global_dimension_2_id' },
  { key: 'created_by', label: 'Created By', type: 'text', column: 'e.created_by' },
  { key: 'created_at', label: 'Created', type: 'date', column: 'e.created_at', datetime: true },
];

const SORT_COLUMNS: Record<string, string> = {
  no: 'e.no', employee: 'emp.first_name', status: 'e.status', created_at: 'e.created_at',
};

export interface ListEmployeeEditsOptions {
  view?: EmployeeEditView; search?: string; filters?: FilterCondition[]; sort?: SortState | null;
  /** Employee Self Service: only requests against this employee's record. */
  employeeId?: number | null;
}

export const listEmployeeEditRequests = (
  { view, search = '', filters = [], sort = null, employeeId = null }: ListEmployeeEditsOptions = {},
): Promise<EmployeeEditRequestView[]> => {
  const { clause, params } = buildFilterClause(EDIT_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(SORT_COLUMNS, sort, 'e.no DESC');
  return all<EmployeeEditRequestView>(
    `${SELECT_EDIT}
     WHERE (e.no ILIKE @like OR emp.employee_no ILIKE @like OR emp.first_name ILIKE @like OR emp.last_name ILIKE @like)
       ${view ? `AND ${VIEW_CLAUSE[view]}` : ''}
       ${employeeId ? 'AND e.employee_id = @employeeId' : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, ...(employeeId ? { employeeId } : {}), ...params },
  );
};

export const getEmployeeEditRequest = (no: string): Promise<EmployeeEditRequestView | undefined> =>
  one<EmployeeEditRequestView>(`${SELECT_EDIT} WHERE e.no = ?`, no);

export const hasAnyEmployeeEditRequests = async (view?: EmployeeEditView): Promise<boolean> =>
  !!(await one(`SELECT 1 FROM employee_edit_request e WHERE ${view ? VIEW_CLAUSE[view] : '1=1'} LIMIT 1`));

export const getOpenEmployeeEditRequest = (employeeId: number): Promise<EmployeeEditRequest | undefined> =>
  one<EmployeeEditRequest>(
    "SELECT * FROM employee_edit_request WHERE employee_id = ? AND status != 'Processed' ORDER BY no DESC",
    employeeId,
  );

/** Snapshots the employee's current values + sub-entity lists into a fresh, editable request. */
export async function createEmployeeEditRequest(employeeId: number, user: Actor): Promise<{ no: string }> {
  const emp = await getEmployee(employeeId);
  if (!emp) throw new AppError('Employee not found', 'NOT_FOUND');
  if (!['ACTIVE', 'ON_LEAVE'].includes(emp.status)) {
    throw new AppError('Only an active employee can have their details edited', 'VALIDATION');
  }
  const inFlight = await getOpenEmployeeEditRequest(employeeId);
  if (inFlight) {
    throw new AppError(`${emp.employee_no} already has an edit request in flight (${inFlight.no})`, 'DUPLICATE_REQUEST');
  }

  const no = await nextSequence('EMPLOYEE_EDIT');
  const values = EMPLOYEE_EDITABLE_FIELDS.map((f) => (emp as unknown as Record<string, string | number | null>)[f]);

  await tx(async () => {
    await run(
      `INSERT INTO employee_edit_request (no, employee_id, created_at, created_by, photo_image, signature_image, ${[...EMPLOYEE_EDITABLE_FIELDS, ...PAYROLL_SALARY_FIELDS].join(',')})
       VALUES (?,?,?,?,?,?${[...EMPLOYEE_EDITABLE_FIELDS, ...PAYROLL_SALARY_FIELDS].map(() => ',?').join('')})`,
      no, employeeId, new Date().toISOString(), user.username, emp.photo_image, emp.signature_image, ...values,
      ...PAYROLL_SALARY_FIELDS.map((f) => (emp as unknown as Record<string, unknown>)[f] ?? null),
    );
    const [nok, ben, dep, ec, pb, wh, bank] = await Promise.all([
      listNextOfKin(employeeId), listBeneficiaries(employeeId), listDependants(employeeId),
      listEmergencyContacts(employeeId), listProfessionalBodies(employeeId), listWorkHistory(employeeId),
      listBankAccounts(employeeId),
    ]);
    await replaceEditNextOfKin(no, nok);
    await replaceEditBeneficiaries(no, ben);
    await replaceEditDependants(no, dep);
    await replaceEditEmergencyContacts(no, ec);
    await replaceEditProfessionalBodies(no, pb);
    await replaceEditWorkHistory(no, wh);
    await replaceEditBankAccounts(no, bank);

    const changes = [
      { field: 'employee_id', oldValue: null, newValue: employeeId },
      ...EMPLOYEE_EDITABLE_FIELDS.map((f, i) => ({ field: f, oldValue: null, newValue: values[i] })),
    ];
    await logTableChange('employee_edit_request', no, 'Insertion', changes, user);
  });
  return { no };
}

export async function updateEmployeeEditRequest(no: string, body: EmployeeInput, user: Actor): Promise<EmployeeEditRequestView> {
  assertContactColumns(body as Record<string, unknown>);
  const req = await one<EmployeeEditRequest>('SELECT * FROM employee_edit_request WHERE no = ?', no);
  if (!req) throw new AppError('Edit request not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open edit request can be edited', 'VALIDATION');

  const cols = EMPLOYEE_EDITABLE_FIELDS.filter((f) => body[f] !== undefined) as EmployeeEditableField[];
  const payroll = Object.entries(normalisePayrollFields(body as Record<string, unknown>));
  if (cols.length || payroll.length) {
    await run(
      `UPDATE employee_edit_request SET ${[...cols.map((c) => `${c}=?`), ...payroll.map(([c]) => `${c}=?`)].join(',')} WHERE no=?`,
      ...cols.map((c) => body[c]!), ...payroll.map(([, v]) => v ?? null), no,
    );
    const changes = diffFields(req as unknown as Record<string, unknown>, Object.fromEntries(cols.map((c) => [c, body[c]])));
    await logTableChange('employee_edit_request', no, 'Modification', changes, user);
  }
  return (await getEmployeeEditRequest(no))!;
}

export async function submitEmployeeEditRequest(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const req = await one<EmployeeEditRequest>('SELECT * FROM employee_edit_request WHERE no = ?', no);
  if (!req) throw new AppError('Edit request not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open edit request can be submitted for approval', 'VALIDATION');

  const matched = await findMatchingWorkflow('EMPLOYEE_EDIT', await pickConditionFields('EMPLOYEE_EDIT', req));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');

  await tx(async () => {
    await run("UPDATE employee_edit_request SET status = 'Pending Approval' WHERE no = ?", no);
    await logTableChange('employee_edit_request', no, 'Modification', [{ field: 'status', oldValue: 'Open', newValue: 'Pending Approval' }], user);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'EMPLOYEE_EDIT', entityId: no, requestedBy: user.username, amount: 0 });
  });
  const after = await one<{ status: string }>('SELECT status FROM employee_edit_request WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

/** Deletes an Open edit request outright — its proposed sub-entity rows go with it; the live
 *  employee record is untouched since nothing has been applied. Creator only, as with the other
 *  document deletes. */
export async function deleteEmployeeEditRequest(no: string, user: Actor): Promise<{ orphanedAssets: string[] }> {
  const req = await one<Pick<EmployeeEditRequest, 'status' | 'created_by' | 'employee_id' | 'photo_image' | 'signature_image'>>('SELECT status, created_by, employee_id, photo_image, signature_image FROM employee_edit_request WHERE no = ?', no);
  if (!req) throw new AppError('Edit request not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open, not-yet-submitted edit request can be deleted', 'VALIDATION');
  if (req.created_by !== user.username) throw new AppError('Only the person who raised this request can delete it', 'NOT_CREATOR');
  await tx(async () => {
    for (const t of ['employee_edit_next_of_kin', 'employee_edit_beneficiary', 'employee_edit_dependant', 'employee_edit_emergency_contact',
      'employee_edit_professional_body', 'employee_edit_work_history', 'employee_edit_bank_account']) {
      await run(`DELETE FROM ${t} WHERE edit_no = ?`, no);
    }
    await run('DELETE FROM employee_edit_request WHERE no = ?', no);
  });
  await audit(user, 'EMPLOYEE_EDIT_DELETE', 'employee_edit_request', no, { employeeId: req.employee_id });
  // Images uploaded onto the request that never reached the employee are orphans now.
  const live = await one<{ photo_image: string | null; signature_image: string | null }>('SELECT photo_image, signature_image FROM employee WHERE id = ?', req.employee_id);
  return {
    orphanedAssets: [req.photo_image, req.signature_image].filter((v): v is string => !!v && v !== live?.photo_image && v !== live?.signature_image),
  };
}

/**
 * Sets (or clears) the proposed passport photo / specimen signature on an Open request — the
 * request's own copy, applied onto the employee only when the request is. Returns the value it
 * replaced and whether that value is still the live employee's (in which case it must not be
 * destroyed in media storage).
 */
export async function setEditRequestImage(
  no: string, kind: 'photo' | 'signature', publicId: string | null, user: Actor,
): Promise<{ previous: string | null; previousIsLive: boolean }> {
  const col = kind === 'photo' ? 'photo_image' : 'signature_image';
  const req = await one<EmployeeEditRequest>('SELECT * FROM employee_edit_request WHERE no = ?', no);
  if (!req) throw new AppError('Edit request not found', 'NOT_FOUND');
  if (req.status !== 'Open') throw new AppError('Only an open edit request can be edited', 'VALIDATION');
  if (req.created_by !== user.username) throw new AppError('Only the person who raised this request can change it', 'NOT_CREATOR');
  const live = await one<{ photo_image: string | null; signature_image: string | null }>('SELECT photo_image, signature_image FROM employee WHERE id = ?', req.employee_id);
  const previous = req[col];
  await run(`UPDATE employee_edit_request SET ${col} = ? WHERE no = ?`, publicId, no);
  await logTableChange('employee_edit_request', no, 'Modification', [{ field: col, oldValue: previous, newValue: publicId }], user);
  return { previous, previousIsLive: !!previous && previous === live?.[col] };
}

export async function cancelEmployeeEditApproval(no: string, user: Actor): Promise<void> {
  const req = await one<Pick<EmployeeEditRequest, 'status' | 'created_by'>>('SELECT status, created_by FROM employee_edit_request WHERE no = ?', no);
  if (!req) throw new AppError('Edit request not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('EMPLOYEE_EDIT', no);
  const requestedBy = routed?.requested_by ?? req.created_by;
  if (requestedBy !== user.username) throw new AppError('Only the person who submitted this request can cancel it', 'NOT_REQUESTER');
  await run("UPDATE employee_edit_request SET status = 'Open' WHERE no = ?", no);
  await logTableChange('employee_edit_request', no, 'Modification', [{ field: 'status', oldValue: req.status, newValue: 'Open' }], user);
}

export async function approveEmployeeEdit(no: string, user: Actor): Promise<void> {
  const req = await one<EmployeeEditRequest>('SELECT * FROM employee_edit_request WHERE no = ?', no);
  if (!req) throw new AppError('Edit request not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be approved', 'VALIDATION');
  await run("UPDATE employee_edit_request SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
  const changes = diffFields(req as unknown as Record<string, unknown>, { status: 'Approved', decision_reason: null });
  await logTableChange('employee_edit_request', no, 'Modification', changes, user);
}

export async function rejectEmployeeEdit(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a request', 'VALIDATION');
  const req = await one<EmployeeEditRequest>('SELECT * FROM employee_edit_request WHERE no = ?', no);
  if (!req) throw new AppError('Edit request not found', 'NOT_FOUND');
  if (req.status !== 'Pending Approval') throw new AppError('Only a request pending approval can be rejected', 'VALIDATION');
  await run("UPDATE employee_edit_request SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  const changes = diffFields(req as unknown as Record<string, unknown>, { status: 'Open', decision_reason: reason });
  await logTableChange('employee_edit_request', no, 'Modification', changes, user);
}

/** Approved -> applies onto the live employee + every sub-entity list, then marks Processed. */
export async function processEmployeeEdit(no: string, user: Actor): Promise<{ employeeId: number; orphanedAssets: string[] }> {
  const orphaned: string[] = [];
  const result = await tx(async () => {
    const req = await one<EmployeeEditRequest>('SELECT * FROM employee_edit_request WHERE no = ?', no);
    if (!req) throw new AppError('Edit request not found', 'NOT_FOUND');
    if (req.status !== 'Approved') throw new AppError('Only an approved request can be applied', 'VALIDATION');

    const body: Record<string, unknown> = {};
    for (const f of EMPLOYEE_EDITABLE_FIELDS) body[f] = (req as unknown as Record<string, unknown>)[f];
    // A move onto a Company Job takes effect here: the post must still be free when it applies.
    const placed = await one<{ company_job_id: number | null }>('SELECT company_job_id FROM employee WHERE id = ?', req.employee_id);
    if (body.company_job_id && Number(body.company_job_id) !== (placed?.company_job_id ?? null)) {
      const { assertJobCanTakeEmployee } = await import('./companyJobs.ts');
      await assertJobCanTakeEmployee(Number(body.company_job_id), req.employee_id);
    }
    const cols = EMPLOYEE_EDITABLE_FIELDS;
    await run(`UPDATE employee SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...cols.map((c) => body[c] ?? null), req.employee_id);
    // The proposed Payroll Salary Card goes across with the rest.
    const r = req as unknown as Record<string, unknown>;
    const liveScale = await one<{ salary_scale_id: number | null }>('SELECT salary_scale_id FROM employee WHERE id = ?', req.employee_id);
    await run(
      `UPDATE employee SET ${PAYROLL_SALARY_FIELDS.map((c) => `${c}=?`).join(',')} WHERE id=?`,
      ...PAYROLL_SALARY_FIELDS.map((c) => (c === 'payment_mode' ? (r[c] ?? 'Bank Transfer') : c === 'basic_pay_cents' ? Number(r[c] ?? 0) : (r[c] ?? null))), req.employee_id,
    );
    // A changed notch confers its Basic Pay and benefits; the request's own Basic Pay (HR's
    // manual figure) then wins, and either way reaches the contract the payroll run reads.
    if ((r.salary_scale_id ?? null) !== (liveScale?.salary_scale_id ?? null)) {
      await applySalaryScaleToEmployee(req.employee_id, (r.salary_scale_id as number | null) ?? null, user);
      await run('UPDATE employee SET basic_pay_cents = ? WHERE id = ?', Number(r.basic_pay_cents ?? 0), req.employee_id);
    }
    await syncContractSalary(req.employee_id, Number(r.basic_pay_cents ?? 0));
    // The proposed photo / signature replace the live ones. Media files the employee no longer
    // references are reported back for the caller to destroy — storage clean-up is not the
    // ledger's business, and a failed delete there must not roll this back.
    const live = await one<{ photo_image: string | null; signature_image: string | null }>('SELECT photo_image, signature_image FROM employee WHERE id = ?', req.employee_id);
    await run('UPDATE employee SET photo_image = ?, signature_image = ? WHERE id = ?', req.photo_image, req.signature_image, req.employee_id);
    orphaned.push(...[live?.photo_image, live?.signature_image].filter((v): v is string => !!v && v !== req.photo_image && v !== req.signature_image));

    const [nok, ben, dep, ec, pb, wh, bank] = await Promise.all([
      listEditNextOfKin(no), listEditBeneficiaries(no), listEditDependants(no),
      listEditEmergencyContacts(no), listEditProfessionalBodies(no), listEditWorkHistory(no), listEditBankAccounts(no),
    ]);
    await replaceNextOfKin(req.employee_id, nok);
    await replaceBeneficiaries(req.employee_id, ben);
    await replaceDependants(req.employee_id, dep.map((r) => ({ ...r, status: 'ACTIVE' })));
    await replaceEmergencyContacts(req.employee_id, ec);
    await replaceProfessionalBodies(req.employee_id, pb);
    await replaceWorkHistory(req.employee_id, wh);
    await replaceBankAccounts(req.employee_id, bank);

    await run("UPDATE employee_edit_request SET status = 'Processed' WHERE no = ?", no);
    const changes = diffFields(req as unknown as Record<string, unknown>, { status: 'Processed' });
    await logTableChange('employee_edit_request', no, 'Modification', changes, user);
    return { employeeId: req.employee_id };
  });
  return { ...result, orphanedAssets: orphaned };
}

/* --------------------------------------------------------------- shadow-table replace helpers */

export const listEditNextOfKin = (editNo: string): Promise<EmployeeEditNextOfKin[]> =>
  all('SELECT * FROM employee_edit_next_of_kin WHERE edit_no = ? ORDER BY id', editNo);
export async function replaceEditNextOfKin(editNo: string, rows: Omit<EmployeeEditNextOfKin, 'id' | 'edit_no'>[]): Promise<void> {
  const clean = rows.filter((r) => r.full_name?.trim());
  assertContactRows(clean as unknown as Record<string, unknown>[]);
  await run('DELETE FROM employee_edit_next_of_kin WHERE edit_no = ?', editNo);
  for (const r of clean) {
    await run(
      'INSERT INTO employee_edit_next_of_kin (edit_no, full_name, relationship, id_no, phone, email) VALUES (?,?,?,?,?,?)',
      editNo, r.full_name.trim(), r.relationship || null, r.id_no || null, r.phone || null, r.email || null,
    );
  }
}

export const listEditBeneficiaries = (editNo: string): Promise<EmployeeEditBeneficiary[]> =>
  all('SELECT * FROM employee_edit_beneficiary WHERE edit_no = ? ORDER BY id', editNo);
export async function replaceEditBeneficiaries(editNo: string, rows: Omit<EmployeeEditBeneficiary, 'id' | 'edit_no'>[]): Promise<void> {
  const clean = rows.filter((r) => r.full_name?.trim()).map((r) => ({ ...r, percentage: Number(r.percentage) || 0 }));
  assertContactRows(clean as unknown as Record<string, unknown>[]);
  if (clean.length) {
    const total = Math.round(clean.reduce((s, r) => s + r.percentage, 0) * 100) / 100;
    if (total > 100.01) throw new AppError(`Beneficiary percentages cannot exceed 100% (currently ${total}%)`, 'VALIDATION');
  }
  await run('DELETE FROM employee_edit_beneficiary WHERE edit_no = ?', editNo);
  for (const r of clean) {
    await run(
      `INSERT INTO employee_edit_beneficiary (edit_no, full_name, id_no, date_of_birth, relationship, gender, phone, email, percentage, is_minor)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      editNo, r.full_name.trim(), r.id_no || null, r.date_of_birth || null, r.relationship || null,
      r.gender || null, r.phone || null, r.email || null, r.percentage, !!r.is_minor,
    );
  }
}

export const listEditDependants = (editNo: string): Promise<EmployeeEditDependant[]> =>
  all('SELECT * FROM employee_edit_dependant WHERE edit_no = ? ORDER BY id', editNo);
export async function replaceEditDependants(editNo: string, rows: Omit<EmployeeEditDependant, 'id' | 'edit_no'>[]): Promise<void> {
  const clean = rows.filter((r) => r.full_name?.trim());
  await run('DELETE FROM employee_edit_dependant WHERE edit_no = ?', editNo);
  for (const r of clean) {
    await run(
      'INSERT INTO employee_edit_dependant (edit_no, full_name, id_or_birth_cert_no, date_of_birth, relationship, gender, is_student) VALUES (?,?,?,?,?,?,?)',
      editNo, r.full_name.trim(), r.id_or_birth_cert_no || null, r.date_of_birth || null, r.relationship || null, r.gender || null, !!r.is_student,
    );
  }
}

export const listEditEmergencyContacts = (editNo: string): Promise<EmployeeEditEmergencyContact[]> =>
  all('SELECT * FROM employee_edit_emergency_contact WHERE edit_no = ? ORDER BY id', editNo);
export async function replaceEditEmergencyContacts(editNo: string, rows: Omit<EmployeeEditEmergencyContact, 'id' | 'edit_no'>[]): Promise<void> {
  const clean = rows.filter((r) => r.full_name?.trim());
  assertContactRows(clean as unknown as Record<string, unknown>[]);
  await run('DELETE FROM employee_edit_emergency_contact WHERE edit_no = ?', editNo);
  for (const r of clean) {
    await run(
      'INSERT INTO employee_edit_emergency_contact (edit_no, full_name, relationship, phone, alt_phone, email) VALUES (?,?,?,?,?,?)',
      editNo, r.full_name.trim(), r.relationship || null, r.phone || null, r.alt_phone || null, r.email || null,
    );
  }
}

export const listEditProfessionalBodies = (editNo: string): Promise<EmployeeEditProfessionalBody[]> =>
  all('SELECT * FROM employee_edit_professional_body WHERE edit_no = ? ORDER BY id', editNo);
export async function replaceEditProfessionalBodies(editNo: string, rows: Omit<EmployeeEditProfessionalBody, 'id' | 'edit_no'>[]): Promise<void> {
  const clean = rows.filter((r) => r.body_name?.trim());
  await run('DELETE FROM employee_edit_professional_body WHERE edit_no = ?', editNo);
  for (const r of clean) {
    await run(
      'INSERT INTO employee_edit_professional_body (edit_no, body_name, membership_no, from_date, to_date) VALUES (?,?,?,?,?)',
      editNo, r.body_name.trim(), r.membership_no || null, r.from_date || null, r.to_date || null,
    );
  }
}

export const listEditWorkHistory = (editNo: string): Promise<EmployeeEditWorkHistory[]> =>
  all('SELECT * FROM employee_edit_work_history WHERE edit_no = ? ORDER BY id', editNo);
export async function replaceEditWorkHistory(editNo: string, rows: Omit<EmployeeEditWorkHistory, 'id' | 'edit_no'>[]): Promise<void> {
  const clean = rows.filter((r) => r.institution?.trim());
  await run('DELETE FROM employee_edit_work_history WHERE edit_no = ?', editNo);
  for (const r of clean) {
    await run(
      'INSERT INTO employee_edit_work_history (edit_no, institution, position_held, from_date, to_date, reason_for_leaving) VALUES (?,?,?,?,?,?)',
      editNo, r.institution.trim(), r.position_held || null, r.from_date || null, r.to_date || null, r.reason_for_leaving || null,
    );
  }
}

export const listEditBankAccounts = (editNo: string): Promise<EmployeeEditBankAccount[]> =>
  all('SELECT * FROM employee_edit_bank_account WHERE edit_no = ? ORDER BY id', editNo);
export async function replaceEditBankAccounts(editNo: string, rows: Omit<EmployeeEditBankAccount, 'id' | 'edit_no'>[]): Promise<void> {
  const clean = rows.filter((r) => r.account_no?.trim()).map((r) => ({ ...r, percentage: Number(r.percentage) || 0 }));
  if (clean.length) {
    const total = Math.round(clean.reduce((s, r) => s + r.percentage, 0) * 100) / 100;
    if (Math.abs(total - 100) > 0.01) throw new AppError(`Bank account split percentages must add up to 100% (currently ${total}%)`, 'VALIDATION');
  }
  await run('DELETE FROM employee_edit_bank_account WHERE edit_no = ?', editNo);
  for (const r of clean) {
    await run(
      'INSERT INTO employee_edit_bank_account (edit_no, bank_code, branch, account_no, percentage) VALUES (?,?,?,?,?)',
      editNo, r.bank_code || null, r.branch || null, r.account_no.trim(), r.percentage,
    );
  }
}
