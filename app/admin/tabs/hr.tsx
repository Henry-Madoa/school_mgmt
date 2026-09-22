/* Admin Centre tabs — hr. Rendered by app/admin/[[...tab]]/page.tsx; moved out of it so each area reads on its own. */
import { currentCanAction } from '@/lib/session';
import { listJobGrades, listContractTypes, listTerminationReasons, listClearanceSections } from '@/lib/hrSetup';
import { listLeaveTypes, listLeaveCalendars, getCurrentLeaveCalendar, listHolidays, listAccrueMatrix } from '@/lib/leaveManagement';
import { getPayrollSetup, listPostingGroups, listPayeBands, listNssfTiers, listTransactionCodes } from '@/lib/payrollSetup';
import { listPostableAccounts } from '@/lib/gl';
import { Card, CardHead, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { JobGradeFormButton, DeleteJobGradeButton } from '../hr-job-grade-form';
import { SalaryScalesScreen } from '../salary-scales';
import { listSalaryScales } from '@/lib/salaryScales';
import { ContractTypeFormButton, DeleteContractTypeButton } from '../hr-contract-type-form';
import { TerminationReasonFormButton, DeleteTerminationReasonButton } from '../hr-termination-reason-form';
import { ClearanceSectionFormButton, DeleteClearanceSectionButton } from '../hr-clearance-section-form';
import { LeaveTypeFormButton, DeleteLeaveTypeButton } from '../hr-leave-type-form';
import { NewLeaveCalendarButton } from '../hr-leave-calendar-form';
import { HolidayFormButton, DeleteHolidayButton } from '../hr-holiday-form';
import { AccrueMatrixFormButton, DeleteAccrueMatrixRowButton } from '../hr-accrue-matrix-form';
import { PayrollSetupFormButton } from '../payroll-setup-form';
import { PostingGroupFormButton, DeletePostingGroupButton } from '../payroll-posting-group-form';
import { PayeBandFormButton, DeletePayeBandButton } from '../payroll-paye-band-form';
import { NssfTierFormButton, DeleteNssfTierButton } from '../payroll-nssf-tier-form';
import { TransactionCodeFormButton } from '../payroll-transaction-code-form';
import { TransactionCodeTable } from '../payroll-transaction-code-table';

/** Setup Pool → HR & Payroll → Salary Scales: grades, their notches and the benefits each confers. */
export async function SalaryScalesTab({ grade }: { grade?: string }) {
  const [grades, scales, codes, canManage] = await Promise.all([
    listJobGrades(), listSalaryScales(), listTransactionCodes(), currentCanAction('HR_SALARY_SCALES_MANAGE'),
  ]);
  return <SalaryScalesScreen grades={grades} scales={scales} codes={codes.filter((c) => c.type === 'INCOME' || c.type === 'DEDUCTION')} canManage={canManage} selectedGradeId={Number(grade) || null} />;
}

export async function JobGradesTab() {
  const rows = await listJobGrades();
  return (
    <>
      <Toolbar>
        <Spacer />
        <JobGradeFormButton>Add job grade</JobGradeFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Job grades" sub="Notice periods and the automatic leave/training/overtime allowances Payroll applies" />
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th className="num">Notice (days)</th>
                <th className="num">Leave allowance</th><th className="num">Training allowance</th>
                <th className="num">Overtime allowance</th><th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td className="mono">{g.code}</td>
                  <td><b>{g.name}</b></td>
                  <td className="num">{g.notice_period_days}</td>
                  <td className="num"><Money cents={g.leave_allowance_amount} /></td>
                  <td className="num"><Money cents={g.training_allowance_amount} /></td>
                  <td className="num"><Money cents={g.overtime_allowance_amount} /></td>
                  <td className="num">
                    <JobGradeFormButton grade={g}>Edit</JobGradeFormButton>{' '}
                    <DeleteJobGradeButton id={g.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🎖" title="No job grades yet" />}
      </Card>
    </>
  );
}

export async function ContractTypesTab() {
  const rows = await listContractTypes();
  return (
    <>
      <Toolbar>
        <Spacer />
        <ContractTypeFormButton>Add contract type</ContractTypeFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Employment contract types" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Name</th><th className="num">Default notice (days)</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td><b>{c.name}</b></td>
                  <td className="num">{c.default_notice_period_days}</td>
                  <td className="num">
                    <ContractTypeFormButton contractType={c}>Edit</ContractTypeFormButton>{' '}
                    <DeleteContractTypeButton id={c.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📄" title="No contract types yet" />}
      </Card>
    </>
  );
}

export async function TerminationReasonsTab() {
  const rows = await listTerminationReasons();
  return (
    <>
      <Toolbar>
        <Spacer />
        <TerminationReasonFormButton>Add termination reason</TerminationReasonFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Termination reasons" sub="Grounds for termination — whether an exit on this ground auto-adds a gratuity due line" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Description</th><th>Pays gratuity</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.code}</td>
                  <td><b>{r.description}</b></td>
                  <td><Pill tone={r.pay_gratuity ? 'ok' : undefined}>{r.pay_gratuity ? 'Yes' : 'No'}</Pill></td>
                  <td className="num">
                    <TerminationReasonFormButton reason={r}>Edit</TerminationReasonFormButton>{' '}
                    <DeleteTerminationReasonButton id={r.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🚪" title="No termination reasons yet" />}
      </Card>
    </>
  );
}

export async function ClearanceSectionsTab() {
  const rows = await listClearanceSections();
  return (
    <>
      <Toolbar>
        <Spacer />
        <ClearanceSectionFormButton>Add clearance section</ClearanceSectionFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Exit clearance sections" sub="Each section is emailed when an employee exit is approved, and must clear it before final payment" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Name</th><th>Owner email</th><th className="num">Sort</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td>
                  <td><b>{s.name}</b></td>
                  <td>{s.owner_email || '—'}</td>
                  <td className="num">{s.sort_order}</td>
                  <td className="num">
                    <ClearanceSectionFormButton section={s}>Edit</ClearanceSectionFormButton>{' '}
                    <DeleteClearanceSectionButton id={s.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="✅" title="No clearance sections yet" />}
      </Card>
    </>
  );
}

export async function LeaveTypesTab() {
  const rows = await listLeaveTypes();
  return (
    <>
      <Toolbar>
        <Spacer />
        <LeaveTypeFormButton>Add leave type</LeaveTypeFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Leave types" sub="Accrual rate, gender restriction, balance treatment and day-counting rules" />
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th className="num">Standard days</th><th>Accrues</th>
                <th>Annual</th><th>Sick</th><th>Status</th><th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.code}</td>
                  <td><b>{t.name}</b></td>
                  <td className="num">{t.standard_days}</td>
                  <td>{t.accrues ? <Pill tone="ok">Yes</Pill> : '—'}</td>
                  <td>{t.is_annual ? <Pill tone="info">Yes</Pill> : '—'}</td>
                  <td>{t.is_sick_leave ? <Pill tone="warn">Yes</Pill> : '—'}</td>
                  <td><Pill status={t.status} /></td>
                  <td className="num">
                    <LeaveTypeFormButton leaveType={t}>Edit</LeaveTypeFormButton>{' '}
                    <DeleteLeaveTypeButton id={t.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏖" title="No leave types yet" />}
      </Card>
    </>
  );
}

export async function LeaveCalendarTab() {
  const [rows, current] = await Promise.all([listLeaveCalendars(), getCurrentLeaveCalendar()]);
  return (
    <>
      <Toolbar>
        <Spacer />
        <NewLeaveCalendarButton hasCurrent={!!current} />
      </Toolbar>
      <Card>
        <CardHead title="Leave calendars" sub="One row per leave year — exactly one is Current at a time" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Start</th><th>End</th><th>Current</th><th>Closed</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td>{c.start_date}</td>
                  <td>{c.end_date}</td>
                  <td>{c.is_current ? <Pill tone="ok">Current</Pill> : '—'}</td>
                  <td>{c.closed ? <Pill tone="warn">Closed</Pill> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🗓" title="No leave calendars yet" />}
      </Card>
    </>
  );
}

export async function HolidaysTab() {
  const rows = await listHolidays();
  return (
    <>
      <Toolbar>
        <Spacer />
        <HolidayFormButton>Add holiday</HolidayFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Holidays" sub="Excluded from a leave day count unless the leave type marks holidays inclusive" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Date</th><th>Reason</th><th>Recurring</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.date}</td>
                  <td><b>{h.reason}</b></td>
                  <td>{h.recurring ? 'Yes' : '—'}</td>
                  <td className="num">
                    <HolidayFormButton holiday={h}>Edit</HolidayFormButton>{' '}
                    <DeleteHolidayButton id={h.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📅" title="No holidays configured yet" />}
      </Card>
    </>
  );
}

export async function AccrueMatrixTab() {
  const [rows, leaveTypes, grades] = await Promise.all([listAccrueMatrix(), listLeaveTypes(), listJobGrades()]);
  return (
    <>
      <Toolbar>
        <Spacer />
        <AccrueMatrixFormButton leaveTypes={leaveTypes} grades={grades}>Add accrual rate</AccrueMatrixFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Leave accrual matrix" sub="Per-grade override of a leave type's accrual rate — supersedes the type's own flat rate" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Leave Type</th><th>Job Grade</th><th className="num">Days / run</th><th className="num">Day worth</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.leave_type_name}</td>
                  <td>{r.job_grade_name}</td>
                  <td className="num">{r.days_to_accrue}</td>
                  <td className="num"><Money cents={r.leave_day_worth_cents} /></td>
                  <td className="num">
                    <AccrueMatrixFormButton row={r} leaveTypes={leaveTypes} grades={grades}>Edit</AccrueMatrixFormButton>{' '}
                    <DeleteAccrueMatrixRowButton id={r.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📈" title="No accrual overrides yet — types accrue at their own flat rate" />}
      </Card>
    </>
  );
}

export async function PayrollSetupTab() {
  const setup = await getPayrollSetup();
  return (
    <Card>
      <CardHead title="Payroll setup" sub="Relief amounts, statutory rate bases and the proration denominator">
        <PayrollSetupFormButton setup={setup} />
      </CardHead>
      <TableWrap>
        <tbody>
          <tr><td>Personal relief</td><td className="num"><Money cents={setup.personal_relief_cents} /></td></tr>
          <tr><td>Insurance relief</td><td className="num">{setup.insurance_relief_pct}%</td></tr>
          <tr><td>Max combined relief</td><td className="num"><Money cents={setup.max_relief_cents} /></td></tr>
          <tr><td>Owner-occupier interest cap (P9 col. F)</td><td className="num"><Money cents={setup.mortgage_relief_cents} /></td></tr>
          <tr><td>Pension / NSSF deduction cap (P9 col. E3)</td><td className="num"><Money cents={setup.pension_deduction_cap_cents} /></td></tr>
          <tr><td>Post-retirement medical fund cap (P9 col. J)</td><td className="num"><Money cents={setup.prmf_cap_cents} /></td></tr>
          <tr><td>SHIF deducted before tax (col. I)</td><td className="num">{setup.shif_deductible ? 'Yes' : 'No'}</td></tr>
          <tr><td>Housing Levy deducted before tax (col. H)</td><td className="num">{setup.housing_levy_deductible ? 'Yes' : 'No'}</td></tr>
          <tr><td>SHIF</td><td className="num">{setup.shif_pct}% of {setup.shif_based_on}</td></tr>
          <tr><td>NSSF employer factor</td><td className="num">{setup.nssf_employer_factor}×</td></tr>
          <tr><td>Housing Levy</td><td className="num">{setup.housing_levy_enabled ? `${setup.housing_levy_pct}% of ${setup.housing_levy_based_on}` : 'Disabled'}</td></tr>
          <tr><td>Minimum relief exemption threshold</td><td className="num"><Money cents={setup.minimum_relief_threshold_cents} /></td></tr>
          <tr><td>Secondary employee flat tax</td><td className="num">{setup.secondary_tax_pct}%</td></tr>
          <tr><td>Monthly working days</td><td className="num">{setup.monthly_working_days}</td></tr>
        </tbody>
      </TableWrap>
    </Card>
  );
}

export async function PostingGroupsTab() {
  const [rows, accounts] = await Promise.all([listPostingGroups(), listPostableAccounts()]);
  return (
    <>
      <Toolbar>
        <Spacer />
        <PostingGroupFormButton accounts={accounts}>Add posting group</PostingGroupFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Payroll posting groups" sub="The G/L account mapping an employee's payroll postings use" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>Name</th><th className="num" /></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td className="mono">{g.code}</td>
                  <td><b>{g.name}</b></td>
                  <td className="num">
                    <PostingGroupFormButton group={g} accounts={accounts}>Edit</PostingGroupFormButton>{' '}
                    <DeletePostingGroupButton id={g.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏦" title="No posting groups yet" />}
      </Card>
    </>
  );
}

export async function PayeBandsTab() {
  const rows = await listPayeBands();
  return (
    <>
      <Toolbar>
        <Spacer />
        <PayeBandFormButton>Add band</PayeBandFormButton>
      </Toolbar>
      <Card>
        <CardHead title="PAYE bands" sub="Progressive tax bands, applied in order — each band's width is its own taxable-pay slice" />
        <TableWrap>
          <thead><tr><th className="num">Order</th><th className="num">Band width</th><th className="num">Rate</th><th className="num" /></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="num">{b.sort_order}</td>
                <td className="num">{b.upper_bound_cents != null ? <Money cents={b.upper_bound_cents} /> : 'Unbounded'}</td>
                <td className="num">{b.rate_pct}%</td>
                <td className="num">
                  <PayeBandFormButton band={b}>Edit</PayeBandFormButton>{' '}
                  <DeletePayeBandButton id={b.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

export async function NssfTiersTab() {
  const rows = await listNssfTiers();
  return (
    <>
      <Toolbar>
        <Spacer />
        <NssfTierFormButton>Add tier</NssfTierFormButton>
      </Toolbar>
      <Card>
        <CardHead title="NSSF tiers" sub="Kenyan Tier I / Tier II — a correct tiered accumulation, not a single flat rate" />
        <TableWrap>
          <thead><tr><th className="num">Tier</th><th className="num">Lower</th><th className="num">Upper</th><th className="num">Employee %</th><th className="num">Employer %</th><th className="num" /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="num">{t.tier_no}</td>
                <td className="num"><Money cents={t.lower_limit_cents} /></td>
                <td className="num"><Money cents={t.upper_limit_cents} /></td>
                <td className="num">{t.employee_rate_pct}%</td>
                <td className="num">{t.employer_rate_pct}%</td>
                <td className="num">
                  <NssfTierFormButton tier={t}>Edit</NssfTierFormButton>{' '}
                  <DeleteNssfTierButton id={t.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

export async function TransactionCodesTab() {
  const [rows, accounts] = await Promise.all([listTransactionCodes(), listPostableAccounts()]);
  return (
    <>
      <Toolbar>
        <Spacer />
        <TransactionCodeFormButton accounts={accounts}>Add transaction code</TransactionCodeFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Payroll transaction codes" sub="The reusable earning / deduction catalogue employees' payroll lines reference" />
        {rows.length ? <TransactionCodeTable rows={rows} accounts={accounts} /> : <EmptyState icon="🧾" title="No transaction codes yet" />}
      </Card>
    </>
  );
}
