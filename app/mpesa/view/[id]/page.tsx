import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getMpesaTransaction } from '@/lib/mpesa';
import { listActiveStudentsPick } from '@/lib/students';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { DefinitionList, Pill, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Money } from '@/components/ui/money';
import { AllocateForm, PostNowButton, CheckStatusButton, CancelMpesaButton } from '../../mpesa-actions';

const statusTone = (s: string) => (s === 'POSTED' ? 'ok' : s === 'RECEIVED' ? 'warn' : s === 'PENDING' ? 'info' : 'bad');

export default async function MpesaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('MPESA_READ');
  const { id } = await params;
  const t = await getMpesaTransaction(Number(id));
  if (!t) notFound();
  const canAllocate = await currentCanAction('MPESA_ALLOCATE');
  const students = t.status === 'RECEIVED' && canAllocate ? await listActiveStudentsPick() : [];
  const matched = !!t.customer_id;
  let payload: unknown = null;
  try { payload = t.raw_payload ? JSON.parse(t.raw_payload) : null; } catch { payload = t.raw_payload; }

  return (
    <Page title={`${t.mpesa_receipt ?? `M-Pesa #${t.id}`} — ${t.kind === 'STK' ? 'Payment request' : 'Paybill receipt'}`}
      crumb={`${t.status === 'RECEIVED' ? 'Needs allocation' : t.status.toLowerCase()} · ${t.phone ?? ''} · ${formatDateTime(t.transaction_time ?? t.created_at)}`} user={user}>
      <Toolbar>
        <Link href="/mpesa" className="btn ghost sm">← All M-Pesa payments</Link>
        {t.student_id ? <Link href={`/students/view/${t.student_id}`} className="btn ghost sm">View student</Link> : null}
        {t.receipt_no ? <Link href={`/cash-management/receipts/${encodeURIComponent(t.receipt_no)}`} className="btn ghost sm">View receipt</Link> : null}
        <Spacer />
        {t.status === 'PENDING' ? <CheckStatusButton id={t.id} className="btn ghost" /> : null}
        {t.status === 'RECEIVED' && matched && canAllocate ? <PostNowButton id={t.id} className="btn" /> : null}
        {(t.status === 'RECEIVED' || t.status === 'PENDING') && canAllocate ? <CancelMpesaButton id={t.id} className="btn ghost" /> : null}
      </Toolbar>

      <CollapsibleCard title="Payment" sub={t.kind === 'STK' ? 'A payment request sent to the guardian’s handset' : 'Money paid to the paybill from a phone'}>
        <div className="grid g2">
          <DefinitionList items={[
            ['Status', <Pill key="s" tone={statusTone(t.status)}>{t.status === 'RECEIVED' ? 'needs allocation' : t.status.toLowerCase()}</Pill>],
            ['Receipt', <span className="mono" key="r">{t.mpesa_receipt ?? '—'}</span>],
            ['Amount', <b key="a"><Money cents={t.amount} /></b>],
            ['From', <>{t.phone ?? '—'}{t.payer_name ? ` · ${t.payer_name}` : ''}</>],
            ['Reference typed / sent', <span className="mono" key="ref">{t.account_reference ?? '—'}</span>],
            ['Transaction time', formatDateTime(t.transaction_time ?? t.created_at)],
            t.result_desc ? ['M-Pesa result', `${t.result_code ?? ''} ${t.result_desc}`.trim()] : null,
          ]} />
          <DefinitionList items={[
            ['Student', t.admission_no ? <>{t.student_name} <span className="mono">({t.admission_no})</span>{t.grade_level_name ? ` · ${t.grade_level_name}` : ''}</> : <span className="muted-cell">not matched</span>],
            ['Fee account', t.customer_no ? <span className="mono">{t.customer_no}</span> : <span className="muted-cell">not matched</span>],
            t.receipt_no ? ['Receipt', <span className="mono" key="rc">{t.receipt_no}</span>] : null,
            ['Matching note', t.match_note || '—'],
            t.journal_no ? ['Journal', <span className="mono" key="j">{t.journal_no}</span>] : null,
            t.posted_at ? ['Posted', `${formatDateTime(t.posted_at)} by ${t.posted_by ?? ''}`] : null,
            t.checkout_request_id ? ['Checkout request', <span className="mono tiny" key="c">{t.checkout_request_id}</span>] : null,
            ['Recorded', `${formatDateTime(t.created_at)}${t.created_by ? ` by ${t.created_by}` : ''}`],
          ]} />
        </div>
      </CollapsibleCard>

      {t.status === 'RECEIVED' && canAllocate ? (
        <CollapsibleCard title={matched ? 'Re-allocate' : 'Allocate'} sub={matched ? 'The match is set but posting was refused — pick another student, or post as is' : 'Point this payment at the right student; it is receipted on their fee account as soon as it is allocated'}>
          <AllocateForm id={t.id} students={students} initialStudentId={t.student_id} />
        </CollapsibleCard>
      ) : null}

      {payload ? (
        <CollapsibleCard title="What Safaricom sent" sub="The raw callback, kept for the trail" defaultCollapsed>
          <pre className="tiny mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}</pre>
        </CollapsibleCard>
      ) : null}
    </Page>
  );
}
