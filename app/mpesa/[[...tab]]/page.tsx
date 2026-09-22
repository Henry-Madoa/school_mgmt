import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { listMpesaTransactions, hasAnyMpesaTransactions, mpesaStats, mpesaConfigured, mpesaConfig, callbackUrl, type MpesaView } from '@/lib/mpesa';
import { listActiveStudentsPick } from '@/lib/students';
import { formatDateTime } from '@/lib/format';
import { Page } from '@/components/layout/page';
import { Card, EmptyState, Pill, Stat, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { SearchInput } from '@/components/ui/filters';
import { Money } from '@/components/ui/money';
import { RequestPaymentButton, PostNowButton, CheckStatusButton, RegisterUrlsButton } from '../mpesa-actions';

const TABS: TabDefinition[] = [
  { key: 'unmatched', label: 'Needs allocation', tone: 'warn' },
  { key: 'pending', label: 'Awaiting phone', tone: 'info' },
  { key: 'posted', label: 'Posted', tone: 'ok' },
  { key: 'failed', label: 'Failed / cancelled' },
  { key: 'all', label: 'All' },
];

const statusTone = (s: string) => (s === 'POSTED' ? 'ok' : s === 'RECEIVED' ? 'warn' : s === 'PENDING' ? 'info' : 'bad');

export default async function MpesaPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireAction('MPESA_READ');
  const { tab: segments } = await params;
  const { q = '' } = await searchParams;
  const requested = segments?.[0];
  if (requested && !TABS.some((t) => t.key === requested)) notFound();
  const tab = (requested ?? 'unmatched') as MpesaView;
  const [rows, empty, stats, canInitiate, canAllocate, students] = await Promise.all([
    listMpesaTransactions(tab, q), hasAnyMpesaTransactions(tab).then((a) => !a), mpesaStats(),
    currentCanAction('MPESA_INITIATE'), currentCanAction('MPESA_ALLOCATE'), listActiveStudentsPick(),
  ]);
  const configured = mpesaConfigured();
  const cfg = mpesaConfig();

  return (
    <Page title="M-Pesa Payments" crumb="Paybill receipts and payment requests — matched to students' fee accounts, receipted through the ledger" user={user}>
      <div className="grid g4 stack-2">
        <Stat label="Needs allocation" value={<span className={stats.unmatched ? 'neg' : undefined}>{stats.unmatched}</span>} foot={<><Money cents={stats.unmatched_amount} /> received, not yet posted</>} />
        <Stat label="Awaiting phone" value={stats.pending} foot="payment requests not yet answered" />
        <Stat label="Posted today" value={stats.posted_today} foot={<Money cents={stats.posted_today_amount} />} />
        <Stat label="Gateway" value={configured ? (cfg?.env === 'production' ? 'Live' : 'Sandbox') : 'Not set up'} foot={configured ? `Paybill ${cfg?.shortcode}` : 'MPESA_* environment not set'} />
      </div>
      {!configured ? (
        <div className="note">M-Pesa is not configured on this server. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY and MPESA_CALLBACK_SECRET (see .env.local.example), then register the paybill URLs below. Paybill receipts that arrive are still recorded and can be allocated here.</div>
      ) : null}
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/mpesa/${k}`} />
      <Toolbar>
        <SearchInput placeholder="Search receipt, phone, reference or student…" disabled={empty} />
        <Spacer />
        {canInitiate ? <RequestPaymentButton students={students} configured={configured} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>When</th><th>Receipt</th><th>Kind</th><th>From</th><th>Reference</th><th className="num">Amount</th><th>Student</th><th>Fee account</th><th>Status</th><th className="num" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="tiny">{formatDateTime(r.transaction_time ?? r.created_at)}</td>
                  <td className="mono"><Link href={`/mpesa/view/${r.id}`}>{r.mpesa_receipt ?? `#${r.id}`}</Link></td>
                  <td>{r.kind === 'STK' ? 'Request' : 'Paybill'}</td>
                  <td>{r.phone ?? '—'}{r.payer_name ? <div className="tiny muted-cell">{r.payer_name}</div> : null}</td>
                  <td className="mono">{r.account_reference ?? '—'}</td>
                  <td className="num"><Money cents={r.amount} /></td>
                  <td>{r.admission_no ? <>{r.student_name}<div className="tiny mono">{r.admission_no}{r.grade_level_name ? ` · ${r.grade_level_name}` : ''}</div></> : <span className="muted-cell">—</span>}</td>
                  <td className="mono">{r.customer_no ?? <span className="muted-cell">{r.match_note ? 'unmatched' : '—'}</span>}{r.receipt_no ? <div className="tiny muted-cell">Receipt {r.receipt_no}</div> : null}</td>
                  <td><Pill tone={statusTone(r.status)}>{r.status === 'RECEIVED' ? 'needs allocation' : r.status.toLowerCase()}</Pill>{r.status === 'RECEIVED' && r.match_note ? <div className="tiny muted-cell" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.match_note}>{r.match_note}</div> : null}</td>
                  <td className="num">
                    <div className="inline" style={{ justifyContent: 'flex-end' }}>
                      {r.status === 'RECEIVED' && r.customer_id && canAllocate ? <PostNowButton id={r.id} className="btn sm ghost" /> : null}
                      {r.status === 'PENDING' ? <CheckStatusButton id={r.id} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📱" title={tab === 'unmatched' ? 'Nothing needs allocation' : 'No M-Pesa payments here'} sub={tab === 'unmatched' ? 'Every paybill receipt has been matched and posted.' : undefined} />}
      </Card>
      {canAllocate ? (
        <CollapsibleCard title="Gateway setup" sub="What Safaricom needs from this server" defaultCollapsed={configured}>
          <div className="grid g2">
            <div>
              <div className="tiny muted-cell">Paybill confirmation URL</div>
              <code className="mono">{cfg ? callbackUrl(cfg, 'c2b/confirmation') : '— (configure first)'}</code>
              <div className="tiny muted-cell" style={{ marginTop: 8 }}>Paybill validation URL</div>
              <code className="mono">{cfg ? callbackUrl(cfg, 'c2b/validation') : '—'}</code>
              <div className="tiny muted-cell" style={{ marginTop: 8 }}>Payment request (STK) callback</div>
              <code className="mono">{cfg ? callbackUrl(cfg, 'stk') : '—'}</code>
            </div>
            <div>
              <p className="tiny">The URLs carry a secret only this server and Safaricom know; a callback without it is refused. APP_URL must be the public address Safaricom can reach. Register the paybill URLs once per shortcode after deployment.</p>
              {configured ? <RegisterUrlsButton /> : null}
            </div>
          </div>
        </CollapsibleCard>
      ) : null}
    </Page>
  );
}
