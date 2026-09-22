import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { vatInputListing, whtAnalysis } from '@/lib/vatReports';
import { listWhtCertificates } from '@/lib/whtCertificate';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import { ExportButton } from '@/components/ui/export-button';
import { formatDate } from '@/lib/format';
import { MarkRemittedButton } from '../mark-remitted';

const TABS: TabDefinition[] = [
  { key: 'input-listing', label: 'VAT Input Listing' },
  { key: 'wht-analysis', label: 'WHT Analysis' },
  { key: 'wht-certificates', label: 'WHT Certificates' },
];

const monthRange = (from?: string, to?: string): { from: string; to: string } => {
  const now = new Date();
  const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return { from: from || first, to: to || now.toISOString().slice(0, 10) };
};

export default async function VatPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireAction('VAT_REPORT_READ');
  const { tab: segments } = await params;
  const sp = await searchParams;
  const tab = segments?.[0] ?? 'input-listing';
  if (!TABS.some((t) => t.key === tab)) notFound();
  const { from, to } = monthRange(sp.from, sp.to);

  return (
    <Page title="VAT & Withholding Tax" crumb="Input VAT and withholding-tax listings for the KRA returns" user={user}>
      <Tabs tabs={TABS} active={tab} hrefFor={(k) => `/finance/vat/${k}`} />
      <Toolbar>
        <form className="inline" style={{ gap: 8 }}>
          <input type="date" name="from" defaultValue={from} aria-label="From" />
          <input type="date" name="to" defaultValue={to} aria-label="To" />
          <button type="submit" className="btn sm">Refresh</button>
        </form>
        <Spacer />
        {tab === 'input-listing' ? <ExportButton href="/api/export/vat-input" params={{ from, to }} /> : null}
        {tab === 'wht-analysis' ? <ExportButton href="/api/export/wht-analysis" params={{ from, to }} /> : null}
      </Toolbar>
      {tab === 'input-listing' ? <InputTab from={from} to={to} /> : null}
      {tab === 'wht-analysis' ? <WhtTab from={from} to={to} /> : null}
      {tab === 'wht-certificates' ? <CertsTab from={from} to={to} /> : null}
    </Page>
  );
}

async function InputTab({ from, to }: { from: string; to: string }) {
  const rows = await vatInputListing({ from, to });
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <Card>
      <CardHead title="VAT Input Listing" sub={`Recoverable input VAT posted ${formatDate(from)} — ${formatDate(to)} (feeds the VAT3 return)`} />
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>VAT Code</th><th>Description</th><th className="num">Rate</th><th className="num">Base</th><th className="num">Input VAT</th><th className="num">Entries</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vat_prod_posting_group_code}>
                <td className="mono">{r.vat_prod_posting_group_code}</td>
                <td>{r.description ?? '—'}</td>
                <td className="num">{r.vat_pct}%</td>
                <td className="num"><Money cents={Number(r.base)} /></td>
                <td className="num"><Money cents={Number(r.amount)} /></td>
                <td className="num">{Number(r.entry_count)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={4}>Total input VAT</td><td className="num"><Money cents={total} /></td><td /></tr></tfoot>
        </TableWrap>
      ) : <EmptyState icon="🧮" title="No input VAT in this period" />}
    </Card>
  );
}

async function WhtTab({ from, to }: { from: string; to: string }) {
  const rows = await whtAnalysis({ from, to });
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <Card>
      <CardHead title="Withholding Tax Analysis" sub={`Tax withheld ${formatDate(from)} — ${formatDate(to)} (the KRA withholding-tax return)`} />
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>Vendor</th><th>PIN</th><th>WHT Code</th><th className="num">Rate</th><th className="num">Base</th><th className="num">Tax Withheld</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.bill_to_pay_to_no ?? '—'} <span className="tiny muted-cell">{r.vendor_name ?? ''}</span></td>
                <td className="mono muted-cell">{r.vendor_pin ?? '—'}</td>
                <td className="mono">{r.wht_code ?? '—'}</td>
                <td className="num">{r.rate}%</td>
                <td className="num"><Money cents={Number(r.base)} /></td>
                <td className="num"><Money cents={Number(r.amount)} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5}>Total withheld</td><td className="num"><Money cents={total} /></td></tr></tfoot>
        </TableWrap>
      ) : <EmptyState icon="📊" title="No withholding tax in this period" />}
    </Card>
  );
}

async function CertsTab({ from, to }: { from: string; to: string }) {
  const [rows, canRemit] = await Promise.all([
    listWhtCertificates({ from, to }),
    currentCanAction('WHT_MARK_REMITTED'),
  ]);
  return (
    <Card>
      <CardHead title="Withholding Tax Certificates" sub="One per payee per payment voucher — the supplier's evidence and the remittance record" />
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>No.</th><th>Date</th><th>Payee</th><th>PIN</th><th>Voucher</th><th className="num">Gross</th><th className="num">WHT</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.no}</td>
                <td>{formatDate(c.certificate_date)}</td>
                <td>{c.vendor_name ?? '—'}</td>
                <td className="mono muted-cell">{c.vendor_pin ?? '—'}</td>
                <td className="mono muted-cell">{c.payment_voucher_no}</td>
                <td className="num"><Money cents={c.gross_amount} /></td>
                <td className="num"><Money cents={c.total_wht} /></td>
                <td>{c.remitted ? <Pill status="ok">Remitted</Pill> : <Pill tone="warn">Pending</Pill>}</td>
                <td className="num">
                  <div className="inline" style={{ justifyContent: 'flex-end' }}>
                    <a className="btn sm ghost" href={`/wht-certificate/${c.no}`} target="_blank" rel="noreferrer">Print</a>
                    {!c.remitted && canRemit ? <MarkRemittedButton no={c.no} /> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="📜" title="No certificates in this period" />}
    </Card>
  );
}
