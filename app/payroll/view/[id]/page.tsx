import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getEmployee, getCurrentContract, listBankAccounts } from '@/lib/employees';
import {
  getOpenPayrollPeriod, listEmployeeTransactions, listPeriodTransactions, getPayrollCumulatives,
  listEmployeePayrollHistory,
} from '@/lib/payroll';
import { listTransactionCodes } from '@/lib/payrollSetup';
import { all, one } from '@/lib/db';
import { getDimensionCaptions } from '@/lib/org';
import { imageSrc } from '@/lib/cloudinary';
import { formatDate, initials } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Money } from '@/components/ui/money';
import { KpiTile } from '../../../dashboard/centres/shared';
import { RunForEmployeeButton, AddTransactionButton, StopTransactionButton, RemoveTransactionButton } from '../../payroll-actions';
import { ReapplyScaleButton } from '../../scale-actions';
import { getSalaryScale } from '@/lib/salaryScales';
import type { Cents } from '@/lib/types';

/**
 * The employee's Payroll card — everything payroll knows about them in one place: who they are
 * and how they are paid (the Payroll Salary Card and the posting group's accounts), the statutory
 * registrations, the bank destination, this period's lines and computed payslip, the
 * imprest recoveries, and the payroll history with cumulatives.
 * The facts themselves are maintained on the Employee Card (New) or through Employee Editing —
 * this card shows them and runs the payroll.
 */
export default async function EmployeePayrollPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('PAYROLL_READ');
  const { id: idParam } = await params;
  const employeeId = Number(idParam);

  const emp = await getEmployee(employeeId);
  if (!emp) notFound();

  const [contract, period, canRun, canManage, codes, captions, bankAccounts, cumulative, history, postingGroup, imprest, scale] = await Promise.all([
    getCurrentContract(employeeId), getOpenPayrollPeriod(),
    currentCanAction('PAYROLL_PERIODS_RUN'), currentCanAction('PAYROLL_MANAGE_TRANSACTIONS'),
    listTransactionCodes(), getDimensionCaptions(), listBankAccounts(employeeId), getPayrollCumulatives(employeeId),
    listEmployeePayrollHistory(employeeId, 12),
    emp.posting_group_id
      ? all<{ label: string; code: string; name: string }>(
        `SELECT x.label, a.code, a.name FROM payroll_posting_group g
         JOIN LATERAL (VALUES
           ('Salary expense', g.salary_expense_account_id), ('Net pay payable', g.net_pay_payable_account_id),
           ('PAYE payable', g.paye_payable_account_id), ('NSSF employee payable', g.nssf_employee_payable_account_id),
           ('NSSF employer expense', g.nssf_employer_expense_account_id), ('NSSF employer payable', g.nssf_employer_payable_account_id),
           ('SHIF payable', g.shif_payable_account_id), ('Housing levy employee payable', g.housing_levy_employee_payable_account_id),
           ('Housing levy employer expense', g.housing_levy_employer_expense_account_id), ('Housing levy employer payable', g.housing_levy_employer_payable_account_id)
         ) AS x(label, account_id) ON true
         JOIN gl_account a ON a.id = x.account_id
         WHERE g.id = ?`, emp.posting_group_id)
      : Promise.resolve([]),
    one<{ balance: Cents }>('SELECT COALESCE(SUM(amount), 0) AS balance FROM employee_ledger_entry WHERE employee_id = ?', employeeId).catch(() => ({ balance: 0 })),
    emp.salary_scale_id ? getSalaryScale(emp.salary_scale_id) : Promise.resolve(undefined),
  ]);
  const transactions = period ? await listEmployeeTransactions(employeeId, period.id) : [];
  const periodLines = period ? await listPeriodTransactions(period.id, employeeId) : [];

  const sum = (group: string) => periodLines.filter((l) => l.group_text === group && l.transaction_type !== 'MEMO').reduce((s, l) => s + Number(l.amount_cents), 0);
  const thisRun = periodLines.length ? {
    basic: sum('BASIC SALARY'), allowances: sum('ALLOWANCE'), statutory: sum('STATUTORIES'), deductions: sum('DEDUCTIONS'),
    employer: periodLines.filter((l) => l.group_text === 'EMPLOYER' && l.post_as === 'DEBIT').reduce((s, l) => s + Number(l.amount_cents), 0),
    net: sum('NET PAY'),
  } : null;
  const photo = imageSrc(emp.photo_image, { width: 120, height: 120, crop: 'fill' });
  const yesNo = (b: boolean) => (b ? <Pill tone="ok">Yes</Pill> : <Pill tone="">No</Pill>);

  return (
    <Page title={`${emp.first_name} ${emp.last_name} — Payroll`} crumb={`${emp.employee_no}${period ? ` · ${period.period_name}` : ' · No open period'}`} user={user}>
      <Toolbar>
        <Link href="/payroll" className="btn ghost sm">← All employees</Link>
        <Link href={`/employees/view/${employeeId}`} className="btn ghost sm">Employee card</Link>
        {period ? <Link href={`/payroll/view/${employeeId}/payslip?period=${period.id}`} className="btn ghost sm">Payslip</Link> : null}
        <Link href={`/payroll/view/${employeeId}/p9`} className="btn ghost sm">P9 (annual)</Link>
        <Spacer />
        {period && canRun ? <RunForEmployeeButton periodId={period.id} employeeId={employeeId} /> : null}
      </Toolbar>

      {/* Who — and the flags that decide whether and how they are paid */}
      <Card>
        <div className="biometric-slot" style={{ alignItems: 'center', gap: 16 }}>
          {photo ? <img src={photo} alt={`${emp.first_name} ${emp.last_name}`} className="photo" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} />
            : <div className="avatar" aria-hidden="true" style={{ width: 64, height: 64, fontSize: 20 }}>{initials(`${emp.first_name} ${emp.last_name}`)}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{emp.first_name} {emp.middle_name ? `${emp.middle_name} ` : ''}{emp.last_name} <span className="mono muted-cell">{emp.employee_no}</span></div>
            <div className="tiny">
              {emp.job_title || 'No job title'}{emp.job_grade_name ? ` · ${emp.job_grade_name}` : ''}
              {emp.global_dimension_1_name ? ` · ${captions.caption1}: ${emp.global_dimension_1_name}` : ''}
              {emp.global_dimension_2_name ? ` · ${captions.caption2}: ${emp.global_dimension_2_name}` : ''}
            </div>
          </div>
          <div className="inline" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Pill status={emp.status} />
            {emp.suspend_pay ? <Pill tone="bad">Pay suspended{emp.suspension_date ? ` since ${formatDate(emp.suspension_date)}` : ''}</Pill> : null}
            {!emp.posting_group_id ? <Pill tone="warn">No posting group</Pill> : null}
          </div>
        </div>
        {emp.suspend_pay && emp.suspension_reasons ? <div className="note" style={{ marginTop: 8 }}>Suspension: {emp.suspension_reasons}</div> : null}
      </Card>

      {thisRun ? (
        <div className="grid g4 stack-2">
          <KpiTile label={`Gross pay — ${period?.period_name}`} value={<Money cents={thisRun.basic + thisRun.allowances} />} accent={false}
            foot={<span className="tiny">Basic {(thisRun.basic / 100).toLocaleString()} · allowances {(thisRun.allowances / 100).toLocaleString()}</span>} />
          <KpiTile label="Statutory deductions" value={<Money cents={thisRun.statutory} />} accent={false} foot={<span className="tiny">PAYE, NSSF, SHIF, housing levy</span>} />
          <KpiTile label="Other deductions" value={<Money cents={thisRun.deductions} />} accent={thisRun.deductions > 0} foot={<span className="tiny">Loans, welfare, recoveries…</span>} />
          <KpiTile label="Net pay" value={<Money cents={thisRun.net} />} accent
            foot={<span className="tiny">Paid by {emp.payment_mode} · employer cost +{(thisRun.employer / 100).toLocaleString()}</span>} />
        </div>
      ) : null}

      <div className="grid g2">
        <CollapsibleCard title="Payroll Salary Card" sub="How this employee is paid — maintained on the Employee Card or through Employee Editing">
          <DefinitionList items={[
            ['Basic pay', <Money cents={contract ? contract.salary_cents : Number(emp.basic_pay_cents)} key="bp" />],
            ['Contract', contract ? `${contract.job_title || '—'} · from ${formatDate(contract.start_date)}${contract.end_date ? ` to ${formatDate(contract.end_date)}` : ''}` : '—'],
            ['Salary scale', scale
              ? <><span className="mono">{scale.job_grade_code}.{scale.code}</span>{scale.name ? ` — ${scale.name}` : ''} <span className="tiny">· {scale.benefits.length} benefit{scale.benefits.length === 1 ? '' : 's'}</span>{canManage ? <> <ReapplyScaleButton employeeId={employeeId} notch={`${scale.job_grade_code}.${scale.code}`} /></> : null}</>
              : <span className="tiny muted-cell">Off-scale{emp.job_grade_name ? ` (${emp.job_grade_name})` : ''} — pay set by hand</span>],
            ['Employee posting group', emp.posting_group_code ? `${emp.posting_group_code} — ${emp.posting_group_name ?? ''}` : <Pill tone="warn" key="pg">Not set — payroll cannot run</Pill>],
            ['Payment mode', emp.payment_mode],
            ['Currency', emp.payroll_currency_code || 'Base currency'],
            ['Pays NSSF', yesNo(emp.pays_nssf)],
            ['Pays SHIF', yesNo(emp.pays_shif)],
            ['Pays PAYE', yesNo(emp.pays_paye)],
            ['Insurance certificate (relief)', yesNo(emp.insurance_certificate)],
            ['Stop personal relief', yesNo(emp.stop_relief)],
            ['Pay suspended', emp.suspend_pay ? <Pill tone="bad" key="sp">Yes</Pill> : <Pill tone="ok" key="sp">No</Pill>],
            ['Payslip message', emp.payslip_message || '—'],
          ]} />
        </CollapsibleCard>

        <div>
          <CollapsibleCard title="Statutory registrations" sub="Numbers printed on the payslip and P9">
            <DefinitionList items={[
              ['KRA PIN', emp.kra_pin || <Pill tone="warn" key="k">Missing</Pill>],
              ['NSSF No.', emp.nssf_no || '—'],
              ['SHIF No.', emp.shif_no || '—'],
              ['National ID', emp.national_id || '—'],
            ]} />
          </CollapsibleCard>
          <CollapsibleCard title="Pay destination" sub="Where the net pay goes">
            <DefinitionList items={[
              ['Bank', emp.bank_code ? `${emp.bank_code}${emp.bank_branch ? ` · ${emp.bank_branch}` : ''}${emp.bank_account_no ? ` · ${emp.bank_account_no}` : ''}` : '—'],
              ...bankAccounts.map((b, i) => [`Bank account ${i + 1}`, `${b.bank_code ?? ''}${b.branch ? ` · ${b.branch}` : ''} · ${b.account_no} (${b.percentage}%)`] as [string, string]),
            ]} />
          </CollapsibleCard>
        </div>
      </div>

      <CollapsibleCard title="Employee posting group — G/L accounts" sub={emp.posting_group_code ? `${emp.posting_group_code} — ${emp.posting_group_name ?? ''}` : 'No posting group set'} defaultCollapsed>
        {postingGroup.length ? (
          <TableWrap>
            <thead><tr><th>Posting</th><th>Account</th></tr></thead>
            <tbody>
              {postingGroup.map((r) => (
                <tr key={r.label}><td>{r.label}</td><td><span className="mono">{r.code}</span> {r.name}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏷" title="No posting group" sub="Set the Employee posting group on the Payroll Salary Card before running payroll." />}
      </CollapsibleCard>

      {!period ? (
        <Card><EmptyState icon="💰" title="No open payroll period" sub={<>Start one under <Link href="/payroll/periods">Payroll Periods</Link>.</>} /></Card>
      ) : (
        <>
          <Card>
            <CardHead title="Earnings & deductions" sub={`Recurring and one-off lines for ${period.period_name}`}>
              {canManage && period.status === 'OPEN' ? <AddTransactionButton employeeId={employeeId} periodId={period.id} periodStart={period.start_date}
                codes={codes.filter((c) => !transactions.some((t) => t.transaction_code_id === c.id))} /> : null}
            </CardHead>
            {transactions.length ? (
              <TableWrap>
                <thead><tr><th>Code</th><th>Type</th><th className="num">Amount</th><th className="num">Balance</th><th>In force</th><th>Stopped</th><th className="num" /></tr></thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{t.transaction_code_name}{t.salary_scale_id ? <> <Pill tone="accent">From scale</Pill></> : null}</td>
                      <td>{t.transaction_type.replace('_', ' ')}</td>
                      <td className="num"><Money cents={t.amount_cents} /></td>
                      <td className="num">{t.balance_cents != null ? <Money cents={t.balance_cents} /> : '—'}</td>
                      <td className="tiny">
                        {t.start_date || t.end_date
                          ? `${t.start_date ? formatDate(t.start_date) : '…'} – ${t.end_date ? formatDate(t.end_date) : '…'}`
                          : 'Until stopped'}
                        {(t.start_date && t.start_date > period.end_date) || (t.end_date && t.end_date < period.start_date)
                          ? <> <Pill tone="">Not this period</Pill></> : null}
                      </td>
                      <td>{t.stopped ? <Pill tone="warn">Stopped</Pill> : '—'}</td>
                      <td className="num">
                        {canManage && period.status === 'OPEN' ? <>
                          <StopTransactionButton id={t.id} stopped={t.stopped} />{' '}
                          <RemoveTransactionButton id={t.id} />
                        </> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🧾" title="No recurring lines yet" />}
          </Card>

          <Card>
            <CardHead title="Payroll period transactions" sub={periodLines.length ? `Computed by the last Process run for ${period.period_name} — basic pay, statutories, tax workings and net pay are the run's own lines, not earnings & deductions` : 'Not yet processed'} />
            {periodLines.length ? (
              <TableWrap>
                <thead><tr><th>Group</th><th>Code</th><th>Transaction</th><th className="num">Amount</th><th>Posting</th></tr></thead>
                <tbody>
                  {periodLines.map((l) => (
                    <tr key={l.id} className={l.transaction_type === 'MEMO' ? 'muted-row' : undefined}>
                      <td>{l.group_text}</td>
                      <td className="mono">{l.transaction_code}</td>
                      <td>{l.transaction_name}{l.transaction_type === 'MEMO' ? <> <Pill tone="">Working</Pill></> : null}</td>
                      <td className="num"><Money cents={l.amount_cents} /></td>
                      <td className="tiny">{l.post_to_journal ? `${l.post_as === 'DEBIT' ? 'Dr' : 'Cr'}${l.journal_account_type !== 'GL' ? ` · ${l.journal_account_type.toLowerCase()}` : ''}` : 'Not posted'}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <EmptyState icon="🧮" title="Not processed for this period yet" />}
          </Card>
        </>
      )}

      <div className="grid g2">
        <CollapsibleCard title="Imprest & claims" sub="Employee subledger — recovered or reimbursed through payroll when set to">
          <DefinitionList items={[
            ['Outstanding imprest balance', <Money cents={Number(imprest?.balance ?? 0)} key="ib" />],
          ]} />
          <div className="inline" style={{ marginTop: 8 }}>
            <Link href={`/imprest?employee=${employeeId}`} className="btn sm ghost">Imprest requests</Link>
            <Link href="/imprest/ledger" className="btn sm ghost">Employee ledger</Link>
          </div>
        </CollapsibleCard>
      </div>

      <CollapsibleCard title="Payroll history" sub="The last twelve processed periods, with cumulative figures">
        <div className="grid g4 stack-2" style={{ marginBottom: 12 }}>
          <KpiTile label="Cumulative basic pay" value={<Money cents={cumulative.basicPay} />} accent={false} />
          <KpiTile label="Cumulative gross pay" value={<Money cents={cumulative.grossPay} />} accent={false} />
          <KpiTile label="Cumulative deductions" value={<Money cents={cumulative.deductions} />} accent={false} />
          <KpiTile label="Cumulative net pay" value={<Money cents={cumulative.netPay} />} accent={false} />
        </div>
        {history.length ? (
          <TableWrap>
            <thead><tr><th>Period</th><th>Status</th><th className="num">Basic</th><th className="num">Gross</th><th className="num">PAYE</th><th className="num">NSSF</th><th className="num">SHIF</th><th className="num">Housing levy</th><th className="num">Deductions</th><th className="num">Net pay</th><th className="num" /></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.period_id}>
                  <td>{h.period_name}</td>
                  <td><Pill status={h.period_status} /></td>
                  <td className="num"><Money cents={h.basic_pay_cents} /></td>
                  <td className="num"><Money cents={h.gross_pay_cents} /></td>
                  <td className="num"><Money cents={h.paye_cents} /></td>
                  <td className="num"><Money cents={h.nssf_cents} /></td>
                  <td className="num"><Money cents={h.shif_cents} /></td>
                  <td className="num"><Money cents={h.housing_levy_cents} /></td>
                  <td className="num"><Money cents={h.deductions_cents} /></td>
                  <td className="num"><Money cents={h.net_pay_cents} /></td>
                  <td className="num"><Link href={`/payroll/view/${employeeId}/payslip?period=${h.period_id}`} className="btn sm ghost">Payslip</Link></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📜" title="No processed payroll yet" />}
      </CollapsibleCard>
    </Page>
  );
}
