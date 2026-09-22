'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import { TableWrap, EmptyState } from '@/components/ui/primitives';
import { useResultDialog } from '@/components/ui/result-dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { today } from '@/lib/format';
import { calculateDepreciationRequest, postAllApprovedFaJournalLinesRequest } from '@/app/actions/fixedAssets';
import type { DepreciationBook, FaDepreciationSuggestion } from '@/lib/types';

export function CalculateDepreciationPanel({ books, defaultBookCode }: {
  books: DepreciationBook[]; defaultBookCode: string | null;
}) {
  const router = useRouter();
  const showResult = useResultDialog();
  const askConfirm = useConfirm();
  const [bookCode, setBookCode] = useState(defaultBookCode ?? books[0]?.code ?? '');
  const [faPostingDate, setFaPostingDate] = useState(today());
  const [lines, setLines] = useState<FaDepreciationSuggestion[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [postBusy, setPostBusy] = useState(false);

  const calculate = async () => {
    setBusy(true);
    try {
      const res = await calculateDepreciationRequest(bookCode, faPostingDate);
      if (!res.ok) { showResult('Could not calculate depreciation', res.error, 'err'); return; }
      setLines(res.data.lines);
      setSkipped(res.data.skipped);
      showResult(res.data.created ? `${res.data.created} depreciation line(s) drafted` : 'Nothing was due', undefined, 'ok');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const postAll = async () => {
    const proceed = await askConfirm({
      title: 'Post every approved FA journal line?',
      message: 'All approved, unposted FA journal lines for this book post to the FA ledger and the G/L immediately.',
      confirmLabel: 'Post all',
    });
    if (!proceed) return;
    setPostBusy(true);
    try {
      const res = await postAllApprovedFaJournalLinesRequest(bookCode);
      if (!res.ok) { showResult('Could not post', res.error, 'err'); return; }
      showResult(
        `${res.data.posted} line(s) posted`,
        res.data.failures.length ? `${res.data.failures.length} failed — check the FA Journal tab` : undefined,
        'ok',
      );
      router.refresh();
    } finally {
      setPostBusy(false);
    }
  };

  return (
    <>
      <div className="grid g3 form-row">
        <Field
          name="bookCode" label="Depreciation book" type="select" defaultValue={bookCode}
          options={books.map((b) => ({ value: b.code, label: `${b.code} — ${b.description}` }))}
          onChange={(e) => setBookCode(e.target.value)}
        />
        <Field name="faPostingDate" label="FA posting date" type="date" defaultValue={faPostingDate} onChange={(e) => setFaPostingDate(e.target.value)} />
        <div className="inline">
          <button type="button" className="btn" disabled={busy || !bookCode} onClick={calculate}>
            {busy ? 'Calculating…' : 'Calculate depreciation'}
          </button>
          <button type="button" className="btn ghost" disabled={postBusy} onClick={postAll}>
            {postBusy ? 'Posting…' : 'Post all approved'}
          </button>
        </div>
      </div>

      <div className="hint" style={{ marginTop: 'calc(var(--sp)*0.75)' }}>
        Drafts one Open Depreciation line per asset with an amount due — send them for approval, then post them
        (individually on the FA Journal tab, or all at once with “Post all approved”).
      </div>

      {lines === null ? null : lines.length ? (
        <TableWrap>
          <thead>
            <tr><th>Line</th><th>Asset</th><th className="num">Days</th><th className="num">Amount</th><th className="num">New book value</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.no}>
                <td className="mono">{l.no}</td>
                <td>{l.fixed_asset_no} <span className="tiny muted-cell">{l.fixed_asset_description}</span></td>
                <td className="num">{l.days}</td>
                <td className="num"><Money cents={l.amount} /></td>
                <td className="num"><Money cents={l.new_book_value} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState icon="✅" title="Nothing was due" sub={skipped ? `${skipped} asset(s) skipped (Manual, blocked, disposed, or an Open line already exists).` : undefined} />
      )}
    </>
  );
}
