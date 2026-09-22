import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction } from '@/lib/session';
import { buildP9Document, renderDocument } from '@/lib/payrollPrint';
import { Page } from '@/components/layout/page';
import { Toolbar, Spacer } from '@/components/ui/primitives';
import { PrintSheets } from '@/components/ui/print-sheets';

export default async function P9Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await requireAction('PAYROLL_READ');
  const { id: idParam } = await params;
  const { year: yearParam } = await searchParams;
  const employeeId = Number(idParam);
  const year = yearParam || String(new Date().getFullYear());

  const doc = await buildP9Document(employeeId, year);
  if (!doc) notFound();
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));

  return (
    <Page title="P9 Tax Deduction Card" crumb={doc.parties[0]?.name} user={user}>
      <Toolbar>
        <Link href={`/payroll/view/${employeeId}`} className="btn ghost sm">← Back</Link>
        <a className="btn ghost sm" href={`/print/p9/${employeeId}-${year}`} target="_blank" rel="noreferrer">Print / Save as PDF</a>
        <Spacer />
        <div className="inline">
          {years.map((y) => (
            <Link
              key={y} href={`/payroll/view/${employeeId}/p9?year=${y}`}
              className={`btn sm ${y === year ? '' : 'ghost'}`}
            >
              {y}
            </Link>
          ))}
        </div>
      </Toolbar>
      <PrintSheets html={renderDocument(doc)} />
    </Page>
  );
}
