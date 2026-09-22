'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { readForm } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/format';
import { updatePvRequest, type PvLineDraft } from '@/app/actions/cashMgmt';
import { PvFields, pvLinesOf, type PvFormProps } from './payment-voucher-form';
import type { PaymentVoucherDetail } from '@/lib/types';

/**
 * The payment voucher's own card, edited in place — no modal, matching every other document card.
 * lib/paymentVouchers.ts rewrites the header and every line on save, so this stays a single form.
 *
 * Like the printout, the line table follows the Payment Type: the tax columns only appear on a
 * voucher that actually carries tax.
 */
export function PaymentVoucherCard({ pv, lookups, canEdit }: {
  pv: PaymentVoucherDetail; lookups: PvFormProps | null; canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<PvLineDraft[]>(() => pvLinesOf(pv));

  const startEdit = () => { setLines(pvLinesOf(pv)); setError(''); setEditing(true); };

  const save = async () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const res = await updatePvRequest(pv.no, readForm(form), lines);
      if (!res.ok) { setError(res.error || 'Could not save'); return; }
      toast('Payment voucher updated', undefined, 'ok');
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const vatTotal = pv.lines.reduce((s, l) => s + l.vat_amount, 0);
  const whtTotal = pv.lines.reduce((s, l) => s + l.wht_amount_one + l.wht_amount_two, 0);
  const grossTotal = pv.lines.reduce((s, l) => s + l.amount, 0);
  const showTax = vatTotal > 0 || whtTotal > 0;

  return (
    <Card>
      <CardHead
        title={`Payment Voucher ${pv.no}`}
        sub={<>
          {pv.pv_type ?? 'Direct Expensing'} · {pv.description || '—'}
          {pv.employee_no ? <> · {pv.employee_no} {pv.employee_name}</> : null}
        </>}
      >
        {pv.posted ? <Pill status="ok">Posted</Pill> : <Pill status={pv.status} />}
        {canEdit && lookups && !editing
          ? <button type="button" className="btn sm ghost" onClick={startEdit}>Edit</button>
          : null}
      </CardHead>

      {!editing ? (
        <>
          <div className="grid g2">
            <DefinitionList items={[
              ['Payment type', pv.pv_type ?? 'Direct Expensing'],
              ...(pv.pv_type === 'Employee Payment'
                ? [['Employee', <>{pv.employee_no} <span className="muted-cell">{pv.employee_name}</span></>] as [string, React.ReactNode]]
                : []),
              ['Payee', pv.payee_name || (pv.pv_type === 'Employee Payment' ? pv.employee_name : null) || '—'],
              ['Narration', pv.description || '—'],
              ['Voucher date', formatDate(pv.date)],
              ['Paying bank', <span className="mono" key="b">{pv.paying_bank_account_code}</span>],
            ]} />
            <DefinitionList items={[
              ['Payment mode', pv.pay_mode_code || '—'],
              ['Cheque / EFT no.', pv.cheque_no ? `${pv.cheque_no}${pv.cheque_date ? ` (${formatDate(pv.cheque_date)})` : ''}` : '—'],
              ['Currency', `${pv.currency_code}${pv.currency_code === 'KES' ? '' : ` @ ${pv.currency_factor}`}`],
              ...(showTax
                ? ([
                  ['Gross amount', <Money cents={grossTotal} key="g" />],
                  ['VAT included', <Money cents={vatTotal} key="v" />],
                  ['Withholding tax', <Money cents={whtTotal} key="w" />],
                ] as [string, React.ReactNode][])
                : []),
              ['Net paid', <Money cents={pv.total_amount} key="n" />],
              ['Journal', pv.journal_no || '—'],
            ]} />
          </div>

          {pv.lines.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th style={{ width: '24%' }}>Account</th>
                  <th>Description</th>
                  <th style={{ width: '18%' }}>Applies to Doc. No.</th>
                  <th className="num" style={{ width: 130 }}>{showTax ? 'Gross' : 'Amount'}</th>
                  {showTax ? <th className="num" style={{ width: 110 }}>VAT</th> : null}
                  {showTax ? <th className="num" style={{ width: 130 }}>WHT</th> : null}
                  {showTax ? <th className="num" style={{ width: 130 }}>Net</th> : null}
                </tr>
              </thead>
              <tbody>
                {pv.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.account_no ? <span className="mono">{l.account_no}</span> : null}
                      {l.account_name
                        ? <div className={l.account_no ? 'tiny muted-cell' : ''}>{l.account_name}</div>
                        : null}
                    </td>
                    <td>{l.description || <span className="muted-cell">—</span>}</td>
                    <td>
                      {l.applies_to_doc_no
                        ? (<><span className="mono">{l.applies_to_doc_no}</span><div className="tiny muted-cell">Settles this invoice</div></>)
                        : <span className="muted-cell">— on account</span>}
                    </td>
                    <td className="num"><Money cents={l.amount} /></td>
                    {showTax ? <td className="num"><Money cents={l.vat_amount} /></td> : null}
                    {showTax ? (
                      <td className="num">
                        <Money cents={l.wht_amount_one + l.wht_amount_two} />
                        {l.wht_code_one || l.wht_code_two
                          ? <div className="tiny mono muted-cell">{[l.wht_code_one, l.wht_code_two].filter(Boolean).join(' · ')}</div>
                          : null}
                      </td>
                    ) : null}
                    {showTax ? <td className="num"><Money cents={l.net_amount} /></td> : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <td className="num"><b><Money cents={grossTotal} /></b></td>
                  {showTax ? <td className="num"><b><Money cents={vatTotal} /></b></td> : null}
                  {showTax ? <td className="num"><b><Money cents={whtTotal} /></b></td> : null}
                  {showTax ? <td className="num"><b><Money cents={pv.total_amount} /></b></td> : null}
                </tr>
              </tfoot>
            </TableWrap>
          ) : (
            <EmptyState icon="💸" title="No lines yet" sub={canEdit ? 'Edit the card to add them' : undefined} />
          )}
        </>
      ) : (
        <>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <PvFields p={lookups!} initial={pv} lines={lines} setLines={setLines} />
          </form>
          <div className="inline" style={{ marginTop: 'var(--sp)' }}>
            {error ? <div className="modal-error">{error}</div> : null}
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </Card>
  );
}
