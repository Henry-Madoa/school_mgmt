'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useFormat } from '@/components/ui/format-provider';
import { useRunAction } from '@/components/ui/run-action';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { Money } from '@/components/ui/money';
import {
  listClosingRunsRequest, previewCloseIncomeStatementRequest, postCloseIncomeStatementRequest,
} from '@/app/actions/gl';
import type {
  CloseIncomeStatementContext, CloseIncomeStatementInput, CloseIncomeStatementPreview, ClosingRun,
} from '@/lib/closeIncomeStatement';
import { CLOSE_INCOME_STATEMENT_DESCRIPTION as DEFAULT_POSTING_DESCRIPTION } from '@/lib/workflowConstants';

/**
 * Business Central's Close Income Statement request page, laid out with its fields in BC's
 * order — Fiscal Year Ending Date, Document No., Retained Earnings Acc., Posting Description,
 * Close by dimensions, Post to Retained Earnings Acc. — and its two-step rhythm: BC writes the
 * lines to a journal batch you look over and then post; here Preview shows the same lines and
 * Post writes them. The engine that builds the lines is lib/closeIncomeStatement.ts.
 */
export function CloseIncomeStatementScreen({ context, canPost }: { context: CloseIncomeStatementContext; canPost: boolean }) {
  const { cur, fdate } = useFormat();
  const { run, busy } = useRunAction();
  const { fiscalYears, balanceSheetAccounts, dimensionCaptions } = context;
  const closedYears = fiscalYears.filter((y) => y.closed);

  const [endDate, setEndDate] = useState(context.defaultFiscalYearEndDate ?? '');
  const [documentNo, setDocumentNo] = useState('');
  const [retained, setRetained] = useState(context.lastRetainedEarningsAccountCode ?? guessRetainedEarnings(balanceSheetAccounts));
  const [description, setDescription] = useState(DEFAULT_POSTING_DESCRIPTION);
  const [byDim1, setByDim1] = useState(false);
  const [byDim2, setByDim2] = useState(false);
  const [mode, setMode] = useState<'Balance' | 'Details'>('Balance');

  const [preview, setPreview] = useState<CloseIncomeStatementPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [runs, setRuns] = useState<ClosingRun[]>([]);

  // BC numbers the document from the journal batch's No. Series; with none to hand, the year
  // itself is the natural document number — CIS-2025 for the year ending in 2025.
  useEffect(() => {
    if (endDate) setDocumentNo(`CIS-${endDate.slice(0, 4)}`);
    setPreview(null);
    setPreviewError(null);
  }, [endDate]);

  useEffect(() => {
    if (!endDate) { setRuns([]); return; }
    let cancelled = false;
    listClosingRunsRequest(endDate).then((res) => { if (!cancelled) setRuns(res.ok ? res.data : []); });
    return () => { cancelled = true; };
  }, [endDate, preview]);

  // Any change to the parameters invalidates what was previewed — Post only ever follows a
  // preview of the same parameters, so the user never posts something they have not seen.
  useEffect(() => { setPreview(null); }, [retained, byDim1, byDim2, mode, documentNo]);

  const input = (): CloseIncomeStatementInput => ({
    fiscalYearEndDate: endDate, documentNo, retainedEarningsAccountCode: retained,
    postingDescription: description, closeByDimension1: byDim1, closeByDimension2: byDim2,
    postToRetainedEarnings: mode,
  });

  const doPreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await previewCloseIncomeStatementRequest(input());
      if (!res.ok) { setPreview(null); setPreviewError(res.error ?? 'Could not build the closing entries'); return; }
      setPreview(res.data);
    } finally {
      setPreviewing(false);
    }
  };

  const doPost = () => run(() => postCloseIncomeStatementRequest(input()), {
    confirm: {
      title: `Post the closing entries for the year ending ${fdate(endDate)}?`,
      message: `${preview?.lines.length ?? 0} journal lines are posted on the closing date ${fdate(endDate)}, transferring a result of ${cur(preview?.totals.result ?? 0)} to ${retained}. Every income statement account then stands at zero for the year.`,
      confirmLabel: 'Post', danger: true,
    },
    successTitle: (j: { journal_no: string; lineCount: number }) => `Closing entries posted — journal ${j.journal_no}`,
    successDetail: (j: { lineCount: number }) => `${j.lineCount} lines on the closing date ${fdate(endDate)}.`,
  });

  const ready = !!endDate && !!retained && !!documentNo.trim();
  const dimsUsed = byDim1 || byDim2;

  return (
    <>
      <div className="grid split-side">
        <Card>
          <CardHead title="Close Income Statement" sub="Transfers the fiscal year's result from the income statement accounts to retained earnings" />
          {!closedYears.length ? (
            <div className="note" style={{ marginBottom: 12 }}>
              No fiscal year has been closed yet. Close the year first on <Link href="/accounting/periods">Accounting Periods</Link> —
              the fiscal year must be closed before the income statement can be closed.
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="cis_fy">Fiscal year ending date <span className="req">*</span></label>
            <select id="cis_fy" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={!closedYears.length}>
              {!endDate ? <option value="">Select a closed fiscal year…</option> : null}
              {fiscalYears.map((y) => (
                <option key={y.endDate} value={y.endDate} disabled={!y.closed}>
                  {fdate(y.startDate)} – {fdate(y.endDate)}{y.closed ? (y.hasOpenResult ? ' · result not yet transferred' : ' · closed') : ' · year still open'}
                </option>
              ))}
            </select>
            <div className="hint">Only a closed fiscal year can be chosen. The entries are dated its last day as a closing date.</div>
          </div>

          <div className="field">
            <label htmlFor="cis_doc">Document no. <span className="req">*</span></label>
            <input id="cis_doc" type="text" value={documentNo} maxLength={20} onChange={(e) => setDocumentNo(e.target.value)} />
            <div className="hint">Lands on every closing entry as its reference.</div>
          </div>

          <SearchableSelect
            name="retainedEarningsAccountCode" label="Retained earnings account" required items={balanceSheetAccounts}
            value={retained} onChange={setRetained} getValue={(a) => a.code} getLabel={(a) => `${a.code} — ${a.name}`}
            placeholder="Search balance sheet account…" emptyText="No matching balance sheet accounts"
            hint="Must be a balance sheet account (the Retained Earnings account)."
          />

          <div className="field">
            <label htmlFor="cis_desc">Posting description</label>
            <input id="cis_desc" type="text" value={description} maxLength={100} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="field">
            <label>Close by</label>
            <div className="checkline">
              <input type="checkbox" id="cis_d1" checked={byDim1} onChange={(e) => setByDim1(e.target.checked)} />
              <label htmlFor="cis_d1">{dimensionCaptions.caption1}</label>
            </div>
            <div className="checkline">
              <input type="checkbox" id="cis_d2" checked={byDim2} onChange={(e) => setByDim2(e.target.checked)} />
              <label htmlFor="cis_d2">{dimensionCaptions.caption2}</label>
            </div>
            <div className="hint">With a dimension ticked, each account is closed per dimension value and the entries carry it, so retained earnings can still be analysed by it.</div>
          </div>

          <div className="field">
            <label>Post to retained earnings account</label>
            <div className="checkline">
              <input type="radio" id="cis_bal" name="cis_mode" checked={mode === 'Balance'} onChange={() => setMode('Balance')} />
              <label htmlFor="cis_bal">Balance — one line for the year's result{dimsUsed ? ' per dimension combination' : ''}</label>
            </div>
            <div className="checkline">
              <input type="radio" id="cis_det" name="cis_mode" checked={mode === 'Details'} onChange={() => setMode('Details')} />
              <label htmlFor="cis_det">Details — one line per closed account</label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="btn ghost" disabled={!ready || previewing || busy} onClick={doPreview}>
              {previewing ? 'Building…' : 'Preview closing entries'}
            </button>
            {canPost ? (
              <button type="button" className="btn" disabled={!preview || preview.nothingToClose || busy} onClick={doPost}>
                {busy ? 'Posting…' : 'Post closing entries'}
              </button>
            ) : null}
          </div>
          {previewError ? <div className="tiny" style={{ color: 'var(--danger)', marginTop: 8 }}>{previewError}</div> : null}
          {!canPost ? <div className="hint" style={{ marginTop: 8 }}>You can preview but not post — posting needs the Close Income Statement permission.</div> : null}
        </Card>

        <div>
          {preview ? <PreviewCard preview={preview} retained={retained} dimsUsed={dimsUsed} captions={dimensionCaptions} /> : (
            <Card>
              <CardHead title="Closing entries" sub="What the run would post — build a preview to see it" />
              <EmptyState icon="🔐" title="No preview yet" sub="Choose the fiscal year and the retained earnings account, then preview." />
            </Card>
          )}
          {endDate ? <HistoryCard runs={runs} endDate={endDate} /> : null}
        </div>
      </div>
    </>
  );

  function PreviewCard({ preview, retained, dimsUsed, captions }: {
    preview: CloseIncomeStatementPreview; retained: string; dimsUsed: boolean; captions: { caption1: string; caption2: string };
  }) {
    return (
      <Card>
        <CardHead
          title={`Closing entries — year ${fdate(preview.fiscalYear.startDate)} to ${fdate(preview.fiscalYear.endDate)}`}
          sub={`Posting date C${fdate(preview.postingDate)} (closing date) · ${preview.lines.length} lines`}
        />
        {preview.warnings.map((w) => (
          <div key={w} className="tiny" style={{ color: 'var(--warning)', marginBottom: 6 }}>⚠ {w}</div>
        ))}
        {preview.nothingToClose ? (
          <EmptyState icon="✔" title="Nothing to close" sub="Every income statement account already stands at zero for this fiscal year — its result has been transferred." />
        ) : (
          <>
            <div className="grid g3" style={{ marginBottom: 12 }}>
              <Stat label="Income" value={cur(preview.totals.income)} />
              <Stat label="Expenditure" value={cur(preview.totals.expense)} />
              <Stat label={preview.totals.result >= 0 ? 'Surplus to retained earnings' : 'Deficit to retained earnings'} value={cur(Math.abs(preview.totals.result))} />
            </div>
            <TableWrap>
              <thead>
                <tr>
                  <th>Account</th>
                  {byDim1 ? <th>{captions.caption1}</th> : null}
                  {byDim2 ? <th>{captions.caption2}</th> : null}
                  <th className="num">Net change</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l, i) => (
                  <tr key={i} className={l.accountType === 'RETAINED' ? 'muted' : undefined}>
                    <td>
                      <span className="mono">{l.accountCode}</span> {l.accountName}
                      {l.accountType === 'RETAINED' ? <> <Pill tone="info">retained earnings</Pill></> : null}
                    </td>
                    {byDim1 ? <td className="mono">{l.globalDimension1Code || '—'}</td> : null}
                    {byDim2 ? <td className="mono">{l.globalDimension2Code || '—'}</td> : null}
                    <td className="num muted-cell">{l.accountType === 'RETAINED' ? '' : <Money cents={l.netChange} />}</td>
                    <td className="num">{l.debit ? <Money cents={l.debit} /> : ''}</td>
                    <td className="num">{l.credit ? <Money cents={l.credit} /> : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={1 + (byDim1 ? 1 : 0) + (byDim2 ? 1 : 0) + 1}>Totals — retained earnings {retained}{dimsUsed ? ', per dimension' : ''}</th>
                  <th className="num"><Money cents={preview.totals.debit} /></th>
                  <th className="num"><Money cents={preview.totals.credit} /></th>
                </tr>
              </tfoot>
            </TableWrap>
          </>
        )}
      </Card>
    );
  }

  function HistoryCard({ runs, endDate }: { runs: ClosingRun[]; endDate: string }) {
    return (
      <Card>
        <CardHead title="Earlier closings for this year" sub={`Journals posted on the closing date C${fdate(endDate)}`} />
        {runs.length ? (
          <TableWrap>
            <thead>
              <tr><th>Journal</th><th>Document no.</th><th>Posted</th><th>By</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.journalId} className={r.reversed ? 'muted' : undefined}>
                  <td className="mono"><Link href={`/accounting/journals?q=${encodeURIComponent(r.journalNo)}`}>{r.journalNo}</Link>{r.reversed ? <> <Pill tone="bad">reversed</Pill></> : null}</td>
                  <td className="mono muted-cell">{r.reference || '—'}</td>
                  <td>{fdate(r.postedAt.slice(0, 10))}</td>
                  <td className="muted-cell">{r.postedBy || '—'}</td>
                  <td className="num"><Money cents={r.amount} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <div className="note">Not closed yet — a second run after late postings transfers only what has changed since.</div>}
      </Card>
    );
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card inset" style={{ padding: '10px 12px' }}>
      <div className="tiny">{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/** A sensible first pick when no closing has been run yet: the equity account that calls
 *  itself retained earnings / accumulated surplus, else the first equity account. */
function guessRetainedEarnings(accounts: { code: string; name: string; type: string }[]): string {
  const named = accounts.find((a) => a.type === 'EQUITY' && /retained|accumulated|surplus/i.test(a.name));
  return (named ?? accounts.find((a) => a.type === 'EQUITY'))?.code ?? '';
}
