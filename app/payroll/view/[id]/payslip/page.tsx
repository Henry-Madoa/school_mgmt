import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction } from '@/lib/session';
import { listPayrollPeriods } from '@/lib/payroll';
import { buildPayslipDocument, renderDocument } from '@/lib/payrollPrint';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Toolbar, Spacer } from '@/components/ui/primitives';
import { PrintSheets } from '@/components/ui/print-sheets';

export default async function PayslipPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireAction('PAYROLL_READ');
  const { id: idParam } = await params;
  const { period: periodParam } = await searchParams;
  const employeeId = Number(idParam);

  const periods = await listPayrollPeriods();
  if (!periods.length) {
    return (
      <Page title="Payslip" crumb="No payroll periods yet" user={user}>
        <Card><EmptyState icon="🧾" title="No payroll periods yet" /></Card>
      </Page>
    );
  }
  const periodId = periodParam ? Number(periodParam) : periods.find((p) => p.status === 'OPEN')?.id ?? periods[0].id;

  const slip = await buildPayslipDocument(periodId, employeeId);
  if (!slip) notFound();

  return (
    <Page title="Payslip" crumb={slip.parties[0]?.name} user={user}>
      <Toolbar>
        <Link href={`/payroll/view/${employeeId}`} className="btn ghost sm">← Back</Link>
        <a className="btn ghost sm" href={`/print/payslip/${employeeId}-${periodId}`} target="_blank" rel="noreferrer">Print / Save as PDF</a>
        <Spacer />
        <div className="inline">
          {periods.map((p) => (
            <Link
              key={p.id} href={`/payroll/view/${employeeId}/payslip?period=${p.id}`}
              className={`btn sm ${p.id === periodId ? '' : 'ghost'}`}
            >
              {p.period_name}
            </Link>
          ))}
        </div>
      </Toolbar>
      <PrintSheets html={renderDocument(slip)} />
    </Page>
  );
}
