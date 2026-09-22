/* Admin Centre tabs — general. Rendered by app/admin/[[...tab]]/page.tsx; moved out of it so each area reads on its own. */
import { listJobQueueEntries } from '@/lib/jobQueue';
import { listPostableAccounts } from '@/lib/gl';
import { listNoSeriesWithLines, listDocumentNoSeries, listNoSeriesCodes } from '@/lib/noSeries';
import { splitNo } from '@/lib/noSeriesFormat';
import { listDimensionValues, listCounties, listSubCounties } from '@/lib/pool';
import { CountyFormButton, CountyRow } from '../county-form';
import { getDimensionCaptions } from '@/lib/org';
import { formatDate, formatDateTime } from '@/lib/format';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { DimensionValueFormButton } from '../dimension-value-form';
import { DimensionCaptionForm } from '../dimension-caption-form';
import { NoSeriesFormButton, DeleteNoSeriesButton, NoSeriesLineFormButton, DeleteNoSeriesLineButton, DocumentSeriesSelect } from '../no-series-form';
import { listCurrencies, listExchangeRates } from '@/lib/cashMgmtSetup';
import { CurrencyFormButton, ExchangeRateFormButton, DeleteRateButton } from '../../cash-management/cash-mgmt-forms';
import { JobQueueEntryFormButton, ToggleJobQueueStatusButton, RunJobQueueEntryButton, DeleteJobQueueEntryButton } from '../job-queue-form';
import { JOB_QUEUE_TYPES } from '@/lib/constants';

/** System Automation (Job Queue) — mirrors Business Central's Job Queue Entries page. A new
 *  entry always starts On Hold; Set Ready is what lets the unattended poller
 *  (instrumentation.ts, polling lib/jobQueue.ts's runDueJobQueueEntries()) start picking it up. */
export async function JobQueueTab() {
  const rows = await listJobQueueEntries();
  const jobLabel = (t: string) => JOB_QUEUE_TYPES.find((j) => j.value === t)?.label ?? t;

  return (
    <>
      <Toolbar>
        <Spacer />
        <JobQueueEntryFormButton>New entry</JobQueueEntryFormButton>
      </Toolbar>
      <Card>
        <CardHead
          title="Job Queue Entries"
          sub="Recurring background tasks — an entry only runs unattended while it's Ready; On Hold entries can still be run on demand"
        />
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Code</th><th>Description</th><th>Job</th><th className="num">Every</th>
                <th>Status</th><th>Next run</th><th>Last run</th><th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.code}</td>
                  <td>{r.description}</td>
                  <td>{jobLabel(r.job_type)}</td>
                  <td className="num">{r.run_every_minutes} min</td>
                  <td><Pill tone={r.status === 'READY' ? 'ok' : ''}>{r.status}</Pill></td>
                  <td className="tiny">{r.status === 'READY' ? formatDateTime(r.next_run_at) : '—'}</td>
                  <td className="tiny">
                    {r.last_run_at ? (
                      <>
                        <Pill tone={r.last_run_status === 'SUCCESS' ? 'ok' : 'bad'}>{r.last_run_status}</Pill>
                        <div>{formatDateTime(r.last_run_at)}</div>
                        {r.last_run_message ? <div className="muted-cell">{r.last_run_message}</div> : null}
                      </>
                    ) : 'Never run'}
                  </td>
                  <td className="num">
                    <div className="inline" style={{ justifyContent: 'flex-end' }}>
                      <RunJobQueueEntryButton entry={r} />
                      <ToggleJobQueueStatusButton entry={r} />
                      <JobQueueEntryFormButton entry={r} className="btn sm ghost">Edit</JobQueueEntryFormButton>
                      <DeleteJobQueueEntryButton id={r.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="⏱" title="No Job Queue Entries yet" sub="Add one to run a background task like Entrance Fee Recovery on a schedule" />}
      </Card>
    </>
  );
}

/** Setup Pool → General → Document No. Series: which series every numbered document draws from
 *  (Business Central's per-document "…Nos." setup fields, on one card). */
export async function DocumentNoSeriesTab() {
  const [docs, codeOptions] = await Promise.all([listDocumentNoSeries(), listNoSeriesCodes()]);
  const categories = [...new Set(docs.map((d) => d.category))];
  const configured = docs.filter((d) => d.series_code).length;

  return (
    <>
      <div className="grid g4 stack-2">
        <Stat small label="Numbered documents" value={docs.length} />
        <Stat small label="Assigned" value={`${configured} / ${docs.length}`} />
        <Stat small label="Unassigned" value={docs.length - configured} />
        <Stat small label="No. Series available" value={codeOptions.length} />
      </div>
      <p className="note" style={{ margin: '0 0 4px' }}>
        Pick the No. Series each document numbers itself from. Manage the series themselves —
        Starting No., ranges, increments — on the <b>No. Series</b> tab.
      </p>
      {categories.map((cat) => {
        const rows = docs.filter((d) => d.category === cat);
        const icon = { Membership: '👥', FOSA: '💰', Credit: '📄', Finance: '⚖️', General: '⚙️' }[cat] ?? '📁';
        const assigned = rows.filter((d) => d.series_code).length;
        return (
          <Card key={cat}>
            <CardHead title={<><span aria-hidden="true">{icon}</span> {cat}</>}
              sub={`${assigned} of ${rows.length} assigned`} />
            <TableWrap>
              <thead>
                <tr>
                  <th>Document</th><th>No. Series</th>
                  <th>Last No. Used</th><th>Next No.</th><th>Manual</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.document_code}>
                    <td>{d.label}<div className="tiny muted-cell mono">{d.document_code}</div></td>
                    <td><DocumentSeriesSelect documentCode={d.document_code} seriesCode={d.series_code} options={codeOptions} /></td>
                    <td className="mono">{d.last_no_used ?? <span className="muted-cell">—</span>}</td>
                    <td className="mono">{d.next_no ?? <span className="muted-cell">—</span>}</td>
                    <td>{d.manual_nos ? <Pill tone="info">Manual</Pill> : <span className="tiny muted-cell">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        );
      })}
    </>
  );
}

/** Setup Pool → General → No. Series: define and manage the series and their date-effective
 *  lines (BC No. Series / No. Series Line). */
export async function NoSeriesTab() {
  const series = await listNoSeriesWithLines();
  const openLines = series.reduce((n, s) => n + s.lines.filter((l) => l.open).length, 0);

  const runningLow = series.filter((s) => s.next_no && s.lines.some(
    (l) => l.open && l.warning_no && splitNo(l.last_no_used || l.starting_no)
      && Number(splitNo(l.last_no_used || l.starting_no)!.digits) >= Number(splitNo(l.warning_no)!.digits),
  )).length;

  return (
    <>
      <div className="grid g4 stack-2">
        <Stat small label="No. Series" value={series.length} />
        <Stat small label="Open lines" value={openLines} foot={`across ${series.reduce((n, s) => n + s.lines.length, 0)} defined`} />
        <Stat small label="Running low" value={runningLow} foot="past their Warning No." />
        <Stat small label="Exhausted" value={series.filter((s) => !s.next_no).length} foot="no number to issue" />
      </div>

      <Toolbar>
        <span className="tiny muted-cell">
          A series numbers one or more documents. Assign them on the <b>Document No. Series</b> tab.
        </span>
        <Spacer />
        <NoSeriesFormButton>New No. Series</NoSeriesFormButton>
      </Toolbar>

      {series.length ? series.map((s) => {
        const exhausted = !s.next_no;
        return (
          <CollapsibleCard
            key={s.code}
            defaultCollapsed
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="pill mono">{s.code}</span>
                <span>{s.description}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="tiny muted-cell">next</span>
                  {exhausted
                    ? <Pill tone="bad">Exhausted</Pill>
                    : <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{s.next_no}</span>}
                </span>
              </span>
            }
            sub={
              <span className="chip-row" style={{ marginTop: 4 }}>
                <span className="pill">{s.lines.length} range{s.lines.length === 1 ? '' : 's'}</span>
                <span className="pill info">{s.used_by} document{s.used_by === 1 ? '' : 's'}</span>
                {s.default_nos ? <span className="pill">Default Nos.</span> : null}
                {s.manual_nos ? <span className="pill accent">Manual Nos.</span> : null}
                {s.date_order ? <span className="pill accent">Date order</span> : null}
              </span>
            }
          >
            <Toolbar>
              <Spacer />
              <NoSeriesFormButton row={s} className="btn sm ghost">Edit series</NoSeriesFormButton>
              <NoSeriesLineFormButton seriesCode={s.code} className="btn sm">Add range</NoSeriesLineFormButton>
              <DeleteNoSeriesButton code={s.code} />
            </Toolbar>
            {s.lines.length
              ? [...s.lines].sort((a, b) => (a.starting_date || '').localeCompare(b.starting_date || '') || a.line_no - b.line_no)
                  .map((l) => <NoSeriesLineCard key={l.id} line={l} code={s.code} />)
              : <EmptyState icon="➕" title="No ranges yet" sub="Add one to give this series a Starting No." />}
          </CollapsibleCard>
        );
      }) : (
        <Card>
          <EmptyState icon="🔢" title="No No. Series defined"
            sub="Create one, then assign it to a document on the Document No. Series tab" />
        </Card>
      )}
    </>
  );
}

/** One No. Series Line rendered as an inset card with a range-usage bar. */
export function NoSeriesLineCard({ line, code }: {
  line: Awaited<ReturnType<typeof listNoSeriesWithLines>>[number]['lines'][number]; code: string;
}) {
  const digits = (n: string | null): number | null => {
    const p = n ? splitNo(n) : null;
    return p ? Number(p.digits) : null;
  };
  const step = line.increment_by_no || 1;
  const start = digits(line.starting_no);
  const end = digits(line.ending_no);
  const cur = line.last_no_used ? digits(line.last_no_used) : (start != null ? start - step : null);
  const pct = start != null && end != null && end > start && cur != null
    ? Math.max(0, Math.min(100, Math.round(((cur - start) / (end - start)) * 100)))
    : null;
  const remaining = end != null && cur != null ? Math.max(0, Math.floor((end - cur) / step)) : null;
  const nearWarn = line.warning_no != null && cur != null && digits(line.warning_no) != null
    && cur >= digits(line.warning_no)!;

  return (
    <Card className="inset">
      <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <b>{line.starting_date ? `Effective ${formatDate(line.starting_date)}` : 'Always effective'}</b>
          {line.last_date_used ? <div className="tiny muted-cell">last issued {formatDate(line.last_date_used)}</div> : null}
        </div>
        <div className="inline" style={{ gap: 4, flexShrink: 0 }}>
          {!line.open ? <Pill tone="bad">Closed</Pill> : nearWarn ? <Pill tone="warn">Low</Pill> : <Pill tone="ok">Open</Pill>}
          <NoSeriesLineFormButton seriesCode={code} row={line} className="btn sm ghost">Edit</NoSeriesLineFormButton>
          <DeleteNoSeriesLineButton id={line.id} />
        </div>
      </div>
      <div className="grid g4 stack-2" style={{ marginTop: 10 }}>
        <Stat small label="Starting No." value={<span className="mono">{line.starting_no}</span>} />
        <Stat small label="Increment by" value={step} />
        <Stat small label="Ending No." value={line.ending_no ? <span className="mono">{line.ending_no}</span> : <span className="muted-cell">open-ended</span>} />
        <Stat small label="Last No. Used" value={line.last_no_used ? <span className="mono">{line.last_no_used}</span> : <span className="muted-cell">not yet used</span>} />
      </div>
      {pct != null ? (
        <div className="progress-row" style={{ marginTop: 12 }}>
          <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <span className="progress-pct">{pct}%</span>
          {remaining != null ? <span className="tiny muted-cell" style={{ minWidth: 0 }}>{remaining.toLocaleString()} left</span> : null}
        </div>
      ) : null}
      {line.warning_no ? (
        <div className="tiny muted-cell" style={{ marginTop: 6 }}>Warns once it reaches <span className="mono">{line.warning_no}</span></div>
      ) : null}
    </Card>
  );
}

export async function DimensionsTab() {
  const [{ caption1, caption2 }, values1, values2] = await Promise.all([
    getDimensionCaptions(), listDimensionValues(1), listDimensionValues(2),
  ]);

  return (
    <>
      <DimensionCaptionForm caption1={caption1} caption2={caption2} />
      <DimensionValuesCard slot={1} caption={caption1} values={values1} />
      <DimensionValuesCard slot={2} caption={caption2} values={values2} />
    </>
  );
}

export function DimensionValuesCard({ slot, caption, values }: {
  slot: 1 | 2;
  caption: string;
  values: Awaited<ReturnType<typeof listDimensionValues>>;
}) {
  return (
    <>
      <Toolbar>
        <Spacer />
        <DimensionValueFormButton slot={slot} caption={caption}>Add value</DimensionValueFormButton>
      </Toolbar>
      <Card>
        <CardHead title={caption} sub={`Values available for the ${caption} field on members and GL postings`} />
        {values.length ? (
          <TableWrap>
            <thead>
              <tr><th>Code</th><th>Name</th><th>Status</th><th className="num" /></tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={v.id}>
                  <td className="mono">{v.code}</td>
                  <td><b>{v.name}</b></td>
                  <td><Pill status={v.status} /></td>
                  <td className="num">
                    <DimensionValueFormButton slot={slot} caption={caption} value={v} className="btn sm ghost">
                      Edit
                    </DimensionValueFormButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏷" title={`No ${caption.toLowerCase()} values yet`} />}
      </Card>
    </>
  );
}

export async function CurrenciesAdminTab() {
  const [currencies, rates, accounts] = await Promise.all([
    listCurrencies(), listExchangeRates(), listPostableAccounts(),
  ]);
  const fx = currencies.filter((c) => !c.is_base).map((c) => ({ code: c.code }));
  return (
    <>
      <Toolbar><Spacer /><CurrencyFormButton accounts={accounts}>New currency</CurrencyFormButton></Toolbar>
      <Card>
        <CardHead title="Currencies" sub="Base currency plus every foreign currency, with its exchange gain/loss accounts" />
        <TableWrap>
          <thead><tr><th>Code</th><th>Description</th><th>Base</th><th className="num">Latest rate</th><th>Status</th><th className="num" /></tr></thead>
          <tbody>
            {currencies.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.code}</td><td>{c.description}</td>
                <td>{c.is_base ? <Pill status="ok">Base</Pill> : '—'}</td>
                <td className="num">{c.latest_rate ?? '—'}</td>
                <td>{c.blocked ? <Pill tone="bad">Blocked</Pill> : <Pill status="ok">Active</Pill>}</td>
                <td className="num">{!c.is_base ? <CurrencyFormButton currency={c} accounts={accounts} className="btn sm ghost">Edit</CurrencyFormButton> : null}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
      <Card>
        <CardHead title="Exchange Rates"><ExchangeRateFormButton currencies={fx}>Add rate</ExchangeRateFormButton></CardHead>
        {rates.length ? (
          <TableWrap>
            <thead><tr><th>Currency</th><th>Starting date</th><th className="num">Units</th><th className="num">LCY</th><th className="num" /></tr></thead>
            <tbody>{rates.map((r) => (
              <tr key={r.id}><td className="mono">{r.currency_code}</td><td>{formatDate(r.starting_date)}</td>
                <td className="num">{r.exchange_rate_amount}</td><td className="num">{r.relational_exch_rate_amount}</td>
                <td className="num"><DeleteRateButton id={r.id} /></td></tr>
            ))}</tbody>
          </TableWrap>
        ) : <EmptyState icon="💱" title="No exchange rates" />}
      </Card>
    </>
  );
}
export async function CountiesTab() {
  const [counties, subCounties] = await Promise.all([listCounties(), listSubCounties()]);

  return (
    <>
      <Toolbar>
        <Spacer />
        <CountyFormButton>Add county</CountyFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Counties" sub="Kenya's counties and sub-counties with their codes (019 = Nyeri) — feeds the County and Sub-county fields on student, guardian and employee forms" />
        {counties.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Name</th><th className="num">Sub-counties</th><th className="num">Students</th>
                <th>Status</th><th className="num" />
              </tr>
            </thead>
            <tbody>
              {counties.map((c) => (
                <CountyRow key={c.id} county={c} subCounties={subCounties} />
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🗺" title="No counties yet" />}
      </Card>
    </>
  );
}
