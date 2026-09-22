/* Company Organogram — split out of lib/types.ts; import from '@/lib/types', never from here directly. */
import type { IsoDate, IsoDateTime } from '../types.ts';

/* ------------------------------------------------------------------ Company Organogram */

export type CompanyJobStatus = 'Open' | 'Pending Approval' | 'Approved' | 'Retired';
export const JOB_QUALIFICATION_TYPES = ['ACADEMIC', 'PROFESSIONAL', 'EXPERIENCE', 'SKILL', 'MEMBERSHIP', 'OTHER'] as const;
export type JobQualificationType = (typeof JOB_QUALIFICATION_TYPES)[number];
export const JOB_QUALIFICATION_PRIORITIES = ['MANDATORY', 'DESIRABLE', 'ADDED_ADVANTAGE'] as const;
export type JobQualificationPriority = (typeof JOB_QUALIFICATION_PRIORITIES)[number];
export const JOB_COMPETENCY_LEVELS = ['BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
export type JobCompetencyLevel = (typeof JOB_COMPETENCY_LEVELS)[number];
/** AL "Primary / 2nd / 3rd Skills Category". */
export const JOB_SKILLS_CATEGORIES = ['Auditors', 'Consultants', 'Training', 'Certification', 'Administration', 'Marketing', 'Management', 'Business Development', 'Finance', 'ICT', 'Credit', 'Operations', 'Other'] as const;

/** AL Tab52203769 "Company Jobs" — a position in the establishment. */
export interface HrCompanyJob {
  id: number; job_id: string; name: string; objective: string | null;
  reports_to_job_id: number | null; job_grade_id: number | null;
  global_dimension_1_id: number | null; global_dimension_2_id: number | null;
  no_of_posts: number; is_management: boolean; profession: string | null;
  skills_category: string | null; skills_category_2: string | null; skills_category_3: string | null;
  status: CompanyJobStatus; decision_reason: string | null;
  created_at: IsoDateTime | null; created_by: string | null; approved_at: IsoDateTime | null; approved_by: string | null;
}
export interface HrCompanyJobView extends HrCompanyJob {
  reports_to_job_code: string | null; reports_to_job_name: string | null;
  job_grade_code: string | null; job_grade_name: string | null;
  global_dimension_1_name: string | null; global_dimension_2_name: string | null;
  /** AL "Occupied Position" (active employees on the job) and "Vacant Positions" (posts − occupied). */
  occupied: number; vacant: number;
}
export interface HrCompanyJobResponsibility { id: number; job_id: number; line_no: number; description: string }
export interface HrCompanyJobRequirement { id: number; job_id: number; line_no: number; description: string }
export interface HrCompanyJobQualification {
  id: number; job_id: number; qualification_type: JobQualificationType; qualification: string; description: string | null;
  priority: JobQualificationPriority; competency_level: JobCompetencyLevel | null;
}
/** An employee placed on a job, as the organogram shows them. */
export interface CompanyJobHolder {
  id: number; employee_no: string; first_name: string; last_name: string; status: string; photo_image: string | null;
  employment_date: IsoDate | null; manager_id: number | null;
}
