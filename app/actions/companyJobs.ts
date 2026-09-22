'use server';

import { revalidatePath } from 'next/cache';
import { requireAction, requireUser } from '@/lib/session';
import { actionResult } from '@/lib/errors';
import {
  createCompanyJob, updateCompanyJob, deleteCompanyJob, submitCompanyJob, cancelCompanyJobApproval,
  approveCompanyJob, rejectCompanyJob, reopenCompanyJob, retireCompanyJob,
  setJobResponsibilities, setJobRequirements, setJobQualifications, type CompanyJobInput,
} from '@/lib/companyJobs';
import { findPendingRoutedTask, decideWorkflowTask } from '@/lib/workflow';
import type { ActionResult } from '@/lib/types';

const revalidate = (id?: number) => {
  for (const p of ['/company-jobs', '/organogram', '/organogram/vacant', '/approvals', '/dashboard', '/employees']) revalidatePath(p);
  if (id) revalidatePath(`/company-jobs/view/${id}`);
};

/** The card's fields as the form posts them (strings), mapped onto the lib's typed input. */
function toInput(values: Record<string, unknown>): CompanyJobInput {
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const str = (v: unknown) => (v == null ? null : String(v));
  return {
    jobId: str(values.job_id), name: String(values.name ?? ''), objective: str(values.objective),
    reportsToJobId: num(values.reports_to_job_id), jobGradeId: num(values.job_grade_id),
    globalDimension1Id: num(values.global_dimension_1_id), globalDimension2Id: num(values.global_dimension_2_id),
    noOfPosts: Number(values.no_of_posts ?? 1), isManagement: values.is_management === true || Number(values.is_management) === 1,
    profession: str(values.profession), skillsCategory: str(values.skills_category),
    skillsCategory2: str(values.skills_category_2), skillsCategory3: str(values.skills_category_3),
  };
}

export async function createCompanyJobRequest(values: Record<string, unknown>): Promise<ActionResult<{ id: number; jobId: string }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    const res = await createCompanyJob(toInput(values), user);
    revalidate();
    return res;
  });
}

export async function updateCompanyJobRequest(id: number, values: Record<string, unknown>): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    await updateCompanyJob(id, toInput(values), user);
    revalidate(id);
    return { updated: true };
  });
}

export async function deleteCompanyJobRequest(id: number): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    await deleteCompanyJob(id, user);
    revalidate();
    return { deleted: true };
  });
}

export async function setJobResponsibilitiesRequest(id: number, rows: { description: string }[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    await setJobResponsibilities(id, rows, user);
    revalidate(id);
    return { saved: true };
  });
}

export async function setJobRequirementsRequest(id: number, rows: { description: string }[]): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    await setJobRequirements(id, rows, user);
    revalidate(id);
    return { saved: true };
  });
}

export async function setJobQualificationsRequest(
  id: number,
  rows: { qualification_type: string; qualification: string; description?: string | null; priority: string; competency_level?: string | null }[],
): Promise<ActionResult<{ saved: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    await setJobQualifications(id, rows, user);
    revalidate(id);
    return { saved: true };
  });
}

export async function submitCompanyJobRequest(id: number): Promise<ActionResult<{ updated: true; autoApproved: boolean }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    const { autoApproved } = await submitCompanyJob(id, user);
    revalidate(id);
    return { updated: true, autoApproved };
  });
}

export async function cancelCompanyJobApprovalRequest(id: number): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    await cancelCompanyJobApproval(id, user);
    revalidate(id);
    return { updated: true };
  });
}

export async function approveCompanyJobRequest(id: number): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('COMPANY_JOB', String(id));
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, true, null, user);
    } else {
      const user = await requireAction('COMPANY_JOBS_APPROVE');
      await approveCompanyJob(id, user);
    }
    revalidate(id);
    return { updated: true };
  });
}

export async function rejectCompanyJobRequest(id: number, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const routed = await findPendingRoutedTask('COMPANY_JOB', String(id));
    if (routed) {
      const user = await requireUser();
      await decideWorkflowTask(routed.id, false, reason || null, user);
    } else {
      const user = await requireAction('COMPANY_JOBS_APPROVE');
      await rejectCompanyJob(id, reason || null, user);
    }
    revalidate(id);
    return { updated: true };
  });
}

export async function reopenCompanyJobRequest(id: number): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_CREATE');
    await reopenCompanyJob(id, user);
    revalidate(id);
    return { updated: true };
  });
}

export async function retireCompanyJobRequest(id: number, reason: string): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const user = await requireAction('COMPANY_JOBS_APPROVE');
    await retireCompanyJob(id, reason, user);
    revalidate(id);
    return { updated: true };
  });
}
