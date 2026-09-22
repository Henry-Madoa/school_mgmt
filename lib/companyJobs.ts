/*
 * Company Organogram — AL Tab52203769 "Company Jobs" (Pag52203917 list, Pag52203983 card,
 * Pag52203930 Vacant Positions) with the job's Responsibilities, Requirements and
 * Qualifications sub-tables, plus what AL leaves to the eye: the organogram itself, drawn from
 * "Position Reporting to", with each position's holders and vacancies on the node.
 *
 * A job is a document: Open (drafted by HR) → Pending Approval → Approved (in the establishment;
 * employees can be placed on it, it shows on the chart). An Approved job that is no longer
 * needed is Retired (AL has no delete of an approved job either) — it keeps its history but is
 * off the chart and cannot take new holders.
 */
import { one, all, run, tx, audit, nextSequence } from './db.ts';
import { AppError } from './errors.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import type {
  Actor, HrCompanyJob, HrCompanyJobView, HrCompanyJobResponsibility, HrCompanyJobRequirement, HrCompanyJobQualification,
  CompanyJobHolder, JobQualificationType, JobQualificationPriority, JobCompetencyLevel,
} from './types.ts';
import { JOB_QUALIFICATION_TYPES, JOB_QUALIFICATION_PRIORITIES, JOB_COMPETENCY_LEVELS } from './types.ts';

/* ------------------------------------------------------------------------------- reading */

export type JobView = 'open' | 'pending' | 'approved' | 'retired' | 'all';
const VIEW_CLAUSE: Record<JobView, string> = {
  open: "j.status = 'Open'", pending: "j.status = 'Pending Approval'", approved: "j.status = 'Approved'", retired: "j.status = 'Retired'", all: '1=1',
};

/** Active employees count as occupying a post (AL "Occupied Position": Employee.Status = Active). */
const ACTIVE_STATUSES = "('ACTIVE','ON_LEAVE')";

const SELECT_JOB = `
  SELECT j.*,
         p.job_id AS reports_to_job_code, p.name AS reports_to_job_name,
         g.code AS job_grade_code, g.name AS job_grade_name,
         gd1.name AS global_dimension_1_name, gd2.name AS global_dimension_2_name,
         (SELECT COUNT(*) FROM employee e WHERE e.company_job_id = j.id AND e.status IN ${ACTIVE_STATUSES}) AS occupied,
         GREATEST(j.no_of_posts - (SELECT COUNT(*) FROM employee e WHERE e.company_job_id = j.id AND e.status IN ${ACTIVE_STATUSES}), 0) AS vacant
  FROM company_job j
  LEFT JOIN company_job p ON p.id = j.reports_to_job_id
  LEFT JOIN hr_job_grade g ON g.id = j.job_grade_id
  LEFT JOIN global_dimension_1_value gd1 ON gd1.id = j.global_dimension_1_id
  LEFT JOIN global_dimension_2_value gd2 ON gd2.id = j.global_dimension_2_id`;

const numberise = (j: HrCompanyJobView): HrCompanyJobView => ({ ...j, occupied: Number(j.occupied), vacant: Number(j.vacant), no_of_posts: Number(j.no_of_posts) });

export async function listCompanyJobs(view: JobView = 'all'): Promise<HrCompanyJobView[]> {
  return (await all<HrCompanyJobView>(`${SELECT_JOB} WHERE ${VIEW_CLAUSE[view]} ORDER BY j.job_id`)).map(numberise);
}
export async function getCompanyJob(id: number): Promise<HrCompanyJobView | undefined> {
  const j = await one<HrCompanyJobView>(`${SELECT_JOB} WHERE j.id = ?`, id);
  return j ? numberise(j) : undefined;
}
/** Approved jobs — what an employee may be placed on and what the organogram draws. */
export const listApprovedJobs = (): Promise<HrCompanyJobView[]> => listCompanyJobs('approved');

export const listJobResponsibilities = (jobId: number): Promise<HrCompanyJobResponsibility[]> =>
  all('SELECT * FROM company_job_responsibility WHERE job_id = ? ORDER BY line_no, id', jobId);
export const listJobRequirements = (jobId: number): Promise<HrCompanyJobRequirement[]> =>
  all('SELECT * FROM company_job_requirement WHERE job_id = ? ORDER BY line_no, id', jobId);
export const listJobQualifications = (jobId: number): Promise<HrCompanyJobQualification[]> =>
  all('SELECT * FROM company_job_qualification WHERE job_id = ? ORDER BY priority, qualification_type, id', jobId);

/** The employees on a job — active holders first, then anyone else still linked (on exit etc.). */
export const listJobHolders = (jobId: number): Promise<CompanyJobHolder[]> =>
  all(
    `SELECT id, employee_no, first_name, last_name, status, photo_image, employment_date, manager_id
     FROM employee WHERE company_job_id = ? ORDER BY CASE WHEN status IN ${ACTIVE_STATUSES} THEN 0 ELSE 1 END, first_name, last_name`, jobId,
  );

/* ------------------------------------------------------------------------------- writing */

export interface CompanyJobInput {
  jobId?: string | null; name: string; objective?: string | null;
  reportsToJobId?: number | null; jobGradeId?: number | null;
  globalDimension1Id?: number | null; globalDimension2Id?: number | null;
  noOfPosts?: number; isManagement?: boolean; profession?: string | null;
  skillsCategory?: string | null; skillsCategory2?: string | null; skillsCategory3?: string | null;
}

async function assertNoReportingCycle(jobId: number | null, reportsTo: number | null): Promise<void> {
  if (!jobId || !reportsTo) return;
  if (jobId === reportsTo) throw new AppError('A position cannot report to itself', 'VALIDATION');
  // Walk up from the proposed parent; meeting ourselves means a loop.
  let cur: number | null = reportsTo;
  for (let hops = 0; cur && hops < 100; hops++) {
    if (cur === jobId) throw new AppError('That reporting line would loop back to this position', 'VALIDATION');
    const p: { reports_to_job_id: number | null } | undefined = await one<{ reports_to_job_id: number | null }>('SELECT reports_to_job_id FROM company_job WHERE id = ?', cur);
    cur = p?.reports_to_job_id ?? null;
  }
}

function normalise(input: CompanyJobInput) {
  const name = input.name?.trim();
  if (!name) throw new AppError('The job title is required', 'VALIDATION');
  const posts = Math.max(0, Math.round(Number(input.noOfPosts ?? 1)));
  return {
    name, objective: input.objective?.trim() || null,
    reports_to_job_id: input.reportsToJobId || null, job_grade_id: input.jobGradeId || null,
    global_dimension_1_id: input.globalDimension1Id || null, global_dimension_2_id: input.globalDimension2Id || null,
    no_of_posts: posts, is_management: !!input.isManagement, profession: input.profession?.trim() || null,
    skills_category: input.skillsCategory || null, skills_category_2: input.skillsCategory2 || null, skills_category_3: input.skillsCategory3 || null,
  };
}

export async function createCompanyJob(input: CompanyJobInput, user: Actor): Promise<{ id: number; jobId: string }> {
  const f = normalise(input);
  const jobId = (input.jobId?.trim().toUpperCase()) || await nextSequence('COMPANY_JOB');
  if (await one('SELECT 1 FROM company_job WHERE job_id = ?', jobId)) throw new AppError(`Job ID ${jobId} already exists`, 'DUPLICATE');
  await assertNoReportingCycle(null, f.reports_to_job_id);
  const info = await run(
    `INSERT INTO company_job (job_id, name, objective, reports_to_job_id, job_grade_id, global_dimension_1_id, global_dimension_2_id,
       no_of_posts, is_management, profession, skills_category, skills_category_2, skills_category_3, status, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'Open',?,?)`,
    jobId, f.name, f.objective, f.reports_to_job_id, f.job_grade_id, f.global_dimension_1_id, f.global_dimension_2_id,
    f.no_of_posts, f.is_management, f.profession, f.skills_category, f.skills_category_2, f.skills_category_3,
    new Date().toISOString(), user.username,
  );
  const id = Number(info.lastInsertRowid);
  await audit(user, 'COMPANY_JOB_CREATE', 'company_job', id, { jobId });
  return { id, jobId };
}

/** Everything but the status, while the job is Open. An Approved job's posts and reporting
 *  line change through Reopen → edit → approval again, as AL's card does. */
export async function updateCompanyJob(id: number, input: CompanyJobInput, user: Actor): Promise<void> {
  const job = await one<HrCompanyJob>('SELECT * FROM company_job WHERE id = ?', id);
  if (!job) throw new AppError('Job not found', 'NOT_FOUND');
  if (job.status !== 'Open') throw new AppError('Only an open job can be edited — reopen it first', 'VALIDATION');
  const f = normalise(input);
  await assertNoReportingCycle(id, f.reports_to_job_id);
  await run(
    `UPDATE company_job SET name=?, objective=?, reports_to_job_id=?, job_grade_id=?, global_dimension_1_id=?, global_dimension_2_id=?,
       no_of_posts=?, is_management=?, profession=?, skills_category=?, skills_category_2=?, skills_category_3=? WHERE id=?`,
    f.name, f.objective, f.reports_to_job_id, f.job_grade_id, f.global_dimension_1_id, f.global_dimension_2_id,
    f.no_of_posts, f.is_management, f.profession, f.skills_category, f.skills_category_2, f.skills_category_3, id,
  );
  await audit(user, 'COMPANY_JOB_UPDATE', 'company_job', id, {});
}

export async function deleteCompanyJob(id: number, user: Actor): Promise<void> {
  const job = await one<HrCompanyJob>('SELECT * FROM company_job WHERE id = ?', id);
  if (!job) throw new AppError('Job not found', 'NOT_FOUND');
  if (job.status !== 'Open') throw new AppError('Only an open job can be deleted; retire an approved one instead', 'VALIDATION');
  if (await one('SELECT 1 FROM employee WHERE company_job_id = ?', id)) throw new AppError('Employees are placed on this job — move them first', 'VALIDATION');
  if (await one('SELECT 1 FROM company_job WHERE reports_to_job_id = ?', id)) throw new AppError('Other positions report to this job — re-point them first', 'VALIDATION');
  await run('DELETE FROM company_job WHERE id = ?', id);
  await audit(user, 'COMPANY_JOB_DELETE', 'company_job', id, { jobId: job.job_id });
}

/* ------------------------------------------------------------------------------ the lines */

export async function addJobResponsibility(jobId: number, description: string, user: Actor): Promise<{ id: number }> {
  await assertOpen(jobId);
  const text = description.trim(); if (!text) throw new AppError('Describe the responsibility', 'VALIDATION');
  const next = await one<{ n: number }>('SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM company_job_responsibility WHERE job_id = ?', jobId);
  const info = await run('INSERT INTO company_job_responsibility (job_id, line_no, description) VALUES (?,?,?)', jobId, Number(next?.n ?? 1), text);
  await audit(user, 'COMPANY_JOB_LINE_ADD', 'company_job', jobId, { kind: 'responsibility' });
  return { id: Number(info.lastInsertRowid) };
}
export async function addJobRequirement(jobId: number, description: string, user: Actor): Promise<{ id: number }> {
  await assertOpen(jobId);
  const text = description.trim(); if (!text) throw new AppError('Describe the requirement', 'VALIDATION');
  const next = await one<{ n: number }>('SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM company_job_requirement WHERE job_id = ?', jobId);
  const info = await run('INSERT INTO company_job_requirement (job_id, line_no, description) VALUES (?,?,?)', jobId, Number(next?.n ?? 1), text);
  await audit(user, 'COMPANY_JOB_LINE_ADD', 'company_job', jobId, { kind: 'requirement' });
  return { id: Number(info.lastInsertRowid) };
}
export async function addJobQualification(jobId: number, input: { qualificationType: string; qualification: string; description?: string | null; priority: string; competencyLevel?: string | null }, user: Actor): Promise<{ id: number }> {
  await assertOpen(jobId);
  const q = input.qualification?.trim(); if (!q) throw new AppError('State the qualification', 'VALIDATION');
  const type = (JOB_QUALIFICATION_TYPES as readonly string[]).includes(input.qualificationType) ? input.qualificationType as JobQualificationType : 'OTHER';
  const priority = (JOB_QUALIFICATION_PRIORITIES as readonly string[]).includes(input.priority) ? input.priority as JobQualificationPriority : 'MANDATORY';
  const level = input.competencyLevel && (JOB_COMPETENCY_LEVELS as readonly string[]).includes(input.competencyLevel) ? input.competencyLevel as JobCompetencyLevel : null;
  const info = await run(
    'INSERT INTO company_job_qualification (job_id, qualification_type, qualification, description, priority, competency_level) VALUES (?,?,?,?,?,?)',
    jobId, type, q, input.description?.trim() || null, priority, level,
  );
  await audit(user, 'COMPANY_JOB_LINE_ADD', 'company_job', jobId, { kind: 'qualification' });
  return { id: Number(info.lastInsertRowid) };
}
export async function deleteJobLine(kind: 'responsibility' | 'requirement' | 'qualification', lineId: number, user: Actor): Promise<void> {
  const table = { responsibility: 'company_job_responsibility', requirement: 'company_job_requirement', qualification: 'company_job_qualification' }[kind];
  const row = await one<{ job_id: number }>(`SELECT job_id FROM ${table} WHERE id = ?`, lineId);
  if (!row) throw new AppError('Line not found', 'NOT_FOUND');
  await assertOpen(row.job_id);
  await run(`DELETE FROM ${table} WHERE id = ?`, lineId);
  await audit(user, 'COMPANY_JOB_LINE_DELETE', 'company_job', row.job_id, { kind, lineId });
}
/** The card's line panels save the whole list at once (components/ui/line-rows-editor.tsx). */
export async function setJobResponsibilities(jobId: number, lines: { description: string }[], user: Actor): Promise<void> {
  await assertOpen(jobId);
  const rows = lines.map((l) => l.description?.trim()).filter(Boolean);
  await tx(async () => {
    await run('DELETE FROM company_job_responsibility WHERE job_id = ?', jobId);
    for (const [i, text] of rows.entries()) await run('INSERT INTO company_job_responsibility (job_id, line_no, description) VALUES (?,?,?)', jobId, i + 1, text);
  });
  await audit(user, 'COMPANY_JOB_LINES_SET', 'company_job', jobId, { kind: 'responsibility', count: rows.length });
}
export async function setJobRequirements(jobId: number, lines: { description: string }[], user: Actor): Promise<void> {
  await assertOpen(jobId);
  const rows = lines.map((l) => l.description?.trim()).filter(Boolean);
  await tx(async () => {
    await run('DELETE FROM company_job_requirement WHERE job_id = ?', jobId);
    for (const [i, text] of rows.entries()) await run('INSERT INTO company_job_requirement (job_id, line_no, description) VALUES (?,?,?)', jobId, i + 1, text);
  });
  await audit(user, 'COMPANY_JOB_LINES_SET', 'company_job', jobId, { kind: 'requirement', count: rows.length });
}
export async function setJobQualifications(
  jobId: number,
  lines: { qualification_type: string; qualification: string; description?: string | null; priority: string; competency_level?: string | null }[],
  user: Actor,
): Promise<void> {
  await assertOpen(jobId);
  const rows = lines.filter((l) => l.qualification?.trim()).map((l) => ({
    type: (JOB_QUALIFICATION_TYPES as readonly string[]).includes(l.qualification_type) ? l.qualification_type : 'OTHER',
    qualification: l.qualification.trim(),
    description: l.description?.trim() || null,
    priority: (JOB_QUALIFICATION_PRIORITIES as readonly string[]).includes(l.priority) ? l.priority : 'MANDATORY',
    level: l.competency_level && (JOB_COMPETENCY_LEVELS as readonly string[]).includes(l.competency_level) ? l.competency_level : null,
  }));
  await tx(async () => {
    await run('DELETE FROM company_job_qualification WHERE job_id = ?', jobId);
    for (const r of rows) {
      await run(
        'INSERT INTO company_job_qualification (job_id, qualification_type, qualification, description, priority, competency_level) VALUES (?,?,?,?,?,?)',
        jobId, r.type, r.qualification, r.description, r.priority, r.level,
      );
    }
  });
  await audit(user, 'COMPANY_JOB_LINES_SET', 'company_job', jobId, { kind: 'qualification', count: rows.length });
}

async function assertOpen(jobId: number): Promise<void> {
  const j = await one<{ status: string }>('SELECT status FROM company_job WHERE id = ?', jobId);
  if (!j) throw new AppError('Job not found', 'NOT_FOUND');
  if (j.status !== 'Open') throw new AppError('Only an open job can be edited — reopen it first', 'VALIDATION');
}

/* ------------------------------------------------------------------------------- approval */

export async function submitCompanyJob(id: number, user: Actor): Promise<{ autoApproved: boolean }> {
  const job = await one<HrCompanyJob>('SELECT * FROM company_job WHERE id = ?', id);
  if (!job) throw new AppError('Job not found', 'NOT_FOUND');
  if (job.status !== 'Open') throw new AppError('Only an open job can be sent for approval', 'VALIDATION');
  if (job.reports_to_job_id) {
    const parent = await one<{ status: string; job_id: string }>('SELECT status, job_id FROM company_job WHERE id = ?', job.reports_to_job_id);
    if (parent && parent.status !== 'Approved') throw new AppError(`The position it reports to (${parent.job_id}) must be approved first`, 'VALIDATION');
  }
  const matched = await findMatchingWorkflow('COMPANY_JOB', await pickConditionFields('COMPANY_JOB', job));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE company_job SET status = 'Pending Approval', decision_reason = NULL WHERE id = ?", id);
    await startWorkflow(matched.workflow, matched.steps, { documentType: 'COMPANY_JOB', entityId: String(id), requestedBy: user.username, amount: 0 });
  });
  await audit(user, 'COMPANY_JOB_SUBMIT', 'company_job', id, {});
  const after = await one<{ status: string }>('SELECT status FROM company_job WHERE id = ?', id);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelCompanyJobApproval(id: number, user: Actor): Promise<void> {
  const job = await one<HrCompanyJob>('SELECT * FROM company_job WHERE id = ?', id);
  if (!job) throw new AppError('Job not found', 'NOT_FOUND');
  if (job.status !== 'Pending Approval') throw new AppError('Only a job pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask('COMPANY_JOB', String(id));
  if ((routed?.requested_by ?? job.created_by) !== user.username) throw new AppError('Only the person who submitted this can cancel it', 'NOT_REQUESTER');
  await run("UPDATE company_job SET status = 'Open' WHERE id = ?", id);
  await audit(user, 'COMPANY_JOB_CANCEL_APPROVAL', 'company_job', id, {});
}

export async function approveCompanyJob(id: number, user: Actor): Promise<void> {
  const job = await one<HrCompanyJob>('SELECT * FROM company_job WHERE id = ?', id);
  if (!job) throw new AppError('Job not found', 'NOT_FOUND');
  if (job.status !== 'Pending Approval') throw new AppError('Only a job pending approval can be approved', 'VALIDATION');
  await run("UPDATE company_job SET status = 'Approved', decision_reason = NULL, approved_at = ?, approved_by = ? WHERE id = ?", new Date().toISOString(), user.username, id);
  await audit(user, 'COMPANY_JOB_APPROVE', 'company_job', id, {});
}

export async function rejectCompanyJob(id: number, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required', 'VALIDATION');
  const job = await one<HrCompanyJob>('SELECT * FROM company_job WHERE id = ?', id);
  if (!job) throw new AppError('Job not found', 'NOT_FOUND');
  if (job.status !== 'Pending Approval') throw new AppError('Only a job pending approval can be rejected', 'VALIDATION');
  await run("UPDATE company_job SET status = 'Open', decision_reason = ? WHERE id = ?", reason.trim(), id);
  await audit(user, 'COMPANY_JOB_REJECT', 'company_job', id, { reason });
}

/** AL card "Reopen": an approved job back to Open for changes; holders stay placed meanwhile. */
export async function reopenCompanyJob(id: number, user: Actor): Promise<void> {
  const job = await one<HrCompanyJob>('SELECT * FROM company_job WHERE id = ?', id);
  if (!job) throw new AppError('Job not found', 'NOT_FOUND');
  if (job.status !== 'Approved' && job.status !== 'Retired') throw new AppError('Only an approved or retired job can be reopened', 'VALIDATION');
  await run("UPDATE company_job SET status = 'Open' WHERE id = ?", id);
  await audit(user, 'COMPANY_JOB_REOPEN', 'company_job', id, { from: job.status });
}

/** Retire a position that is no longer in the establishment — it must be empty. */
export async function retireCompanyJob(id: number, reason: string, user: Actor): Promise<void> {
  const job = await getCompanyJob(id);
  if (!job) throw new AppError('Job not found', 'NOT_FOUND');
  if (job.status !== 'Approved') throw new AppError('Only an approved job can be retired', 'VALIDATION');
  if (job.occupied > 0) throw new AppError(`${job.occupied} employee${job.occupied === 1 ? ' is' : 's are'} still on this position — move them first`, 'VALIDATION');
  if (await one("SELECT 1 FROM company_job WHERE reports_to_job_id = ? AND status <> 'Retired'", id)) throw new AppError('Other positions still report to this job — re-point them first', 'VALIDATION');
  if (!reason.trim()) throw new AppError('Give the reason for retiring the position', 'VALIDATION');
  await run("UPDATE company_job SET status = 'Retired', decision_reason = ? WHERE id = ?", `Retired by ${user.username}: ${reason.trim()}`, id);
  await audit(user, 'COMPANY_JOB_RETIRE', 'company_job', id, { reason });
}

/* ------------------------------------------------------------------------------ placement */

/**
 * Placing an employee on a job (AL Employee."Job Code"): only an approved job with a free
 * post takes a new holder (a re-save onto the same job is always fine). Returns what the job
 * implies for the employee's record — title, grade, dimensions — for the caller to default.
 */
export async function assertJobCanTakeEmployee(jobId: number, employeeId: number | null): Promise<HrCompanyJobView> {
  const job = await getCompanyJob(jobId);
  if (!job) throw new AppError('Company job not found', 'NOT_FOUND');
  if (job.status !== 'Approved') throw new AppError(`${job.job_id} — ${job.name} is not an approved position yet`, 'VALIDATION');
  const already = employeeId ? await one('SELECT 1 FROM employee WHERE id = ? AND company_job_id = ?', employeeId, jobId) : null;
  if (!already && job.vacant <= 0) throw new AppError(`${job.job_id} — ${job.name} has no vacant post (${job.occupied} of ${job.no_of_posts} filled)`, 'VALIDATION');
  return job;
}

/** Suggested line manager for a job: the holder of the position it reports to, when there is exactly one. */
export async function suggestedManagerForJob(jobId: number): Promise<CompanyJobHolder | null> {
  const job = await one<{ reports_to_job_id: number | null }>('SELECT reports_to_job_id FROM company_job WHERE id = ?', jobId);
  if (!job?.reports_to_job_id) return null;
  const holders = (await listJobHolders(job.reports_to_job_id)).filter((h) => ['ACTIVE', 'ON_LEAVE'].includes(h.status));
  return holders.length === 1 ? holders[0] : null;
}

/* ------------------------------------------------------------------------------ the chart */

export interface OrgNode {
  job: HrCompanyJobView; holders: CompanyJobHolder[]; children: OrgNode[];
  /** Posts, occupied and vacant across this node and everything under it. */
  subtree: { posts: number; occupied: number; vacant: number; jobs: number };
}

/**
 * The organogram: approved jobs as a forest rooted at the positions that report to nobody,
 * each node carrying its active holders. Vacancies and headcount roll up so a department head
 * can read the size of what sits under them.
 */
export async function getOrganogram(): Promise<{ roots: OrgNode[]; totals: OrgNode['subtree']; unplaced: number }> {
  const jobs = await listCompanyJobs('approved');
  const holders = await all<CompanyJobHolder & { company_job_id: number }>(
    `SELECT id, employee_no, first_name, last_name, status, photo_image, employment_date, manager_id, company_job_id
     FROM employee WHERE company_job_id IS NOT NULL AND status IN ${ACTIVE_STATUSES} ORDER BY employment_date, first_name`,
  );
  const byJob = new Map<number, CompanyJobHolder[]>();
  for (const h of holders) { const l = byJob.get(h.company_job_id) ?? []; l.push(h); byJob.set(h.company_job_id, l); }
  const nodes = new Map<number, OrgNode>(jobs.map((j) => [j.id, { job: j, holders: byJob.get(j.id) ?? [], children: [], subtree: { posts: 0, occupied: 0, vacant: 0, jobs: 0 } }]));
  const roots: OrgNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.job.reports_to_job_id ? nodes.get(n.job.reports_to_job_id) : undefined;
    if (parent) parent.children.push(n); else roots.push(n);
  }
  const roll = (n: OrgNode): OrgNode['subtree'] => {
    const s = { posts: n.job.no_of_posts, occupied: n.job.occupied, vacant: n.job.vacant, jobs: 1 };
    for (const c of n.children) { const cs = roll(c); s.posts += cs.posts; s.occupied += cs.occupied; s.vacant += cs.vacant; s.jobs += cs.jobs; }
    n.subtree = s;
    n.children.sort((a, b) => (Number(b.job.is_management) - Number(a.job.is_management)) || a.job.job_id.localeCompare(b.job.job_id));
    return s;
  };
  const totals = { posts: 0, occupied: 0, vacant: 0, jobs: 0 };
  for (const r of roots) { const s = roll(r); totals.posts += s.posts; totals.occupied += s.occupied; totals.vacant += s.vacant; totals.jobs += s.jobs; }
  roots.sort((a, b) => b.subtree.jobs - a.subtree.jobs || a.job.job_id.localeCompare(b.job.job_id));
  const unplaced = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM employee WHERE company_job_id IS NULL AND status IN ${ACTIVE_STATUSES}`);
  return { roots, totals, unplaced: Number(unplaced?.n ?? 0) };
}

/** AL Pag52203930 "Vacant Positions": approved jobs with unfilled posts. */
export async function listVacantPositions(): Promise<HrCompanyJobView[]> {
  return (await listCompanyJobs('approved')).filter((j) => j.vacant > 0);
}

/** Active employees not placed on any position — the organogram's loose ends. */
export const listUnplacedEmployees = (): Promise<CompanyJobHolder[]> =>
  all(`SELECT id, employee_no, first_name, last_name, status, photo_image, employment_date, manager_id FROM employee
       WHERE company_job_id IS NULL AND status IN ${ACTIVE_STATUSES} ORDER BY first_name, last_name`);
