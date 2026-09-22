/*
 * Petty Cash & Imprest printouts — AL Rep52203476 "Imprest Request Form",
 * Rep52203430 "Imprest Surrender Form" and Rep52203481 "Petty Cash Voucher".
 */
import { formatDate } from './format.ts';
import { amountInWords } from './numberToWords.ts';
import { printBrand, documentMoney, documentSignatories, currencyLabel, type PrintDocument } from './documentPrint.ts';
import { getImprestRequestDetail, getPettyCashDetail } from './imprest.ts';

/** Rep52203476 — the request the employee signs and the approvers clear. */
export async function buildImprestRequestPrint(no: string): Promise<PrintDocument | null> {
  const r = await getImprestRequestDetail(no);
  if (!r) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, r.currency_code);
  return {
    brand,
    title: 'Imprest Request Form',
    subtitle: r.purpose,
    watermark: r.posted ? null : r.status === 'Approved' ? null : r.status.toUpperCase(),
    status: { label: r.posted ? 'Issued' : r.status, tone: r.posted ? 'ok' : r.status === 'Approved' ? 'ok' : 'warn' },
    parties: [{
      heading: 'Requested by',
      name: `${r.first_name} ${r.last_name}`,
      lines: [`Employee No. ${r.employee_no}`, r.job_title || '', r.phone_no ? `Phone ${r.phone_no}` : ''].filter(Boolean),
    }, {
      heading: 'Trip / activity',
      name: r.departure_location || r.purpose,
      lines: [
        r.departure_date ? `From ${formatDate(r.departure_date)}${r.return_date ? ` to ${formatDate(r.return_date)}` : ''}` : '',
        r.total_days ? `${r.total_days} day${r.total_days === 1 ? '' : 's'} in the field` : '',
        r.request_for === 'Other' ? 'On behalf of another' : '',
      ].filter(Boolean),
    }],
    meta: [
      { label: 'Imprest No.', value: r.no },
      { label: 'Request Date', value: formatDate(r.request_date) },
      { label: 'Purpose Code', value: r.purpose_code || '—' },
      { label: 'Pay Mode', value: r.pay_mode_code || '—' },
      { label: 'Paying Account', value: r.paying_bank_code || '—' },
      { label: 'Surrender Due', value: r.due_date ? formatDate(r.due_date) : '—' },
      { label: 'Amount Requested', value: money(r.request_amount), strong: true },
    ],
    columns: [
      { key: 'account', label: 'Expense Account', width: '22%' },
      { key: 'narration', label: 'Narration' },
      { key: 'qty', label: 'Qty', align: 'right', width: '8%' },
      { key: 'unit', label: 'Unit Cost', align: 'right', width: '14%' },
      { key: 'amount', label: 'Amount', align: 'right', width: '16%' },
    ],
    rows: r.line_items.map((l) => ({ cells: { account: `${l.gl_account_code} ${l.gl_account_name}`, narration: l.narration || '', qty: String(l.quantity), unit: l.unit_cost ? money(l.unit_cost) : '', amount: money(l.request_amount) } })),
    totals: [{ label: 'Total requested', value: money(r.request_amount), grand: true }],
    amount_words: amountInWords(Number(r.request_amount), currencyLabel(r.currency_code)),
    notes: [
      { heading: 'Description', body: r.description || '—' },
      { heading: 'Justification', body: r.justification || '—' },
    ],
    approvals: await documentSignatories('IMPREST_REQUEST', r.no, r.created_by, { raisedAt: r.created_at, clearedBy: r.posted_by ?? r.created_by }),
    acknowledgement: { title: 'Received by (employee)' },
    footnote: 'The imprest must be surrendered with supporting receipts by the due date; an unsurrendered imprest is recovered through payroll.',
  };
}

/** Rep52203430 — what was spent against what was issued, and how the difference is settled. */
export async function buildImprestSurrenderPrint(no: string): Promise<PrintDocument | null> {
  const r = await getImprestRequestDetail(no);
  if (!r || !r.posted) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, r.currency_code);
  const net = Number(r.net_refund);
  return {
    brand,
    title: 'Imprest Surrender Form',
    subtitle: `Imprest ${r.no} — ${r.purpose}`,
    status: r.surrendered ? { label: 'Surrendered', tone: 'ok' } : { label: r.surrender_status, tone: 'warn' },
    parties: [{
      heading: 'Surrendered by',
      name: `${r.first_name} ${r.last_name}`,
      lines: [`Employee No. ${r.employee_no}`, r.job_title || ''].filter(Boolean),
    }],
    meta: [
      { label: 'Imprest No.', value: r.no },
      { label: 'Issued On', value: r.posted_at ? formatDate(r.posted_at.slice(0, 10)) : '—' },
      { label: 'Surrender Due', value: r.due_date ? formatDate(r.due_date) : '—' },
      { label: 'Surrender Date', value: r.surrender_date ? formatDate(r.surrender_date) : '—' },
      { label: 'Amount Issued', value: money(r.request_amount) },
      { label: 'Amount Spent', value: money(r.surrender_amount) },
      { label: net > 0 ? 'Refund Due' : net < 0 ? 'Claim Due' : 'Difference', value: money(Math.abs(net)), strong: true },
      { label: 'Settlement', value: r.settlement || '—' },
    ],
    columns: [
      { key: 'account', label: 'Expense Account', width: '22%' },
      { key: 'narration', label: 'Narration / Receipt Ref.' },
      { key: 'requested', label: 'Requested', align: 'right', width: '14%' },
      { key: 'spent', label: 'Actual Spent', align: 'right', width: '14%' },
      { key: 'diff', label: 'Difference', align: 'right', width: '14%' },
    ],
    rows: r.line_items.map((l) => ({ cells: {
      account: `${l.gl_account_code} ${l.gl_account_name}`, narration: [l.narration, l.surrender_note].filter(Boolean).join(' — '),
      requested: money(l.request_amount), spent: money(l.actual_spent), diff: money(l.difference),
    } })),
    totals: [
      { label: 'Issued', value: money(r.request_amount) },
      { label: 'Spent', value: money(r.surrender_amount) },
      { label: net > 0 ? 'Refund due to the school' : net < 0 ? 'Claim due to the employee' : 'Difference', value: money(Math.abs(net)), grand: true },
    ],
    amount_words: amountInWords(Number(r.surrender_amount), currencyLabel(r.currency_code)),
    notes: [
      { heading: 'Settled by', body: r.settlement === 'Receive Now' ? `Refund received into ${r.receiving_bank_code || '—'} ${r.receipt_tx_no ? `(${r.receipt_tx_no})` : ''}`
        : r.settlement === 'Pay Now' ? `Claim paid from ${r.claim_bank_code || '—'} ${r.claim_payment_tx_no ? `(${r.claim_payment_tx_no})` : ''}`
          : r.settlement ? `${r.settlement} — ${r.transferred_to_payroll ? 'sent to payroll' : 'to be sent to payroll'}` : '—' },
    ],
    approvals: await documentSignatories('IMPREST_SURRENDER', r.no, r.created_by, { raisedAt: r.surrender_date ?? r.created_at, clearedBy: r.surrender_posted_by ?? r.created_by }),
    acknowledgement: { title: 'Surrendered by (employee)' },
    footnote: 'Receipts for every amount spent are attached to this form.',
  };
}

/** Rep52203481 — the petty cash voucher the payee signs. */
export async function buildPettyCashPrint(no: string): Promise<PrintDocument | null> {
  const p = await getPettyCashDetail(no);
  if (!p) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, p.currency_code);
  return {
    brand,
    title: 'Petty Cash Voucher',
    subtitle: p.payment_narration,
    watermark: p.posted ? null : p.status.toUpperCase(),
    status: p.paid ? { label: 'Paid', tone: 'ok' } : p.posted ? { label: 'Posted', tone: 'ok' } : { label: p.status, tone: 'warn' },
    parties: [{
      heading: 'Requested by',
      name: `${p.first_name} ${p.last_name}`,
      lines: [`Employee No. ${p.employee_no}`, p.job_title || ''].filter(Boolean),
    }, {
      heading: 'Paid to',
      name: p.payment_to || `${p.first_name} ${p.last_name}`,
      lines: [p.on_behalf_of ? `On behalf of ${p.on_behalf_of}` : ''].filter(Boolean),
    }],
    meta: [
      { label: 'Voucher No.', value: p.no },
      { label: 'Date', value: formatDate(p.request_date) },
      { label: 'Posting Date', value: p.posting_date ? formatDate(p.posting_date) : '—' },
      { label: 'Float', value: p.paying_bank_code ? `${p.paying_bank_code} — ${p.paying_bank_name}` : '—' },
      { label: 'Pay Mode', value: p.pay_mode_code || '—' },
      { label: 'Reference', value: p.payment_tx_no || '—' },
      { label: 'Amount', value: money(p.total_amount), strong: true },
    ],
    columns: [
      { key: 'account', label: 'Expense Account', width: '28%' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount', align: 'right', width: '20%' },
    ],
    rows: p.line_items.map((l) => ({ cells: { account: `${l.gl_account_code} ${l.gl_account_name}`, description: l.description || '', amount: money(l.amount) } })),
    totals: [{ label: 'Total paid', value: money(p.total_amount), grand: true }],
    amount_words: amountInWords(Number(p.total_amount), currencyLabel(p.currency_code)),
    approvals: await documentSignatories('PETTY_CASH', p.no, p.created_by, { raisedAt: p.created_at, clearedBy: p.posted_by ?? p.created_by }),
    acknowledgement: { title: 'Received by (payee)' },
  };
}

/** Staff Claim form — the AL prints it through the same Imprest Request report. */
export async function buildStaffClaimPrint(no: string): Promise<PrintDocument | null> {
  const { getStaffClaimDetail } = await import('./staffClaims.ts');
  const c = await getStaffClaimDetail(no);
  if (!c) return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, c.currency_code);
  return {
    brand,
    title: 'Staff Claim Form',
    subtitle: c.description,
    watermark: c.posted ? null : c.status === 'Approved' ? null : c.status.toUpperCase(),
    status: c.posted ? { label: 'Paid', tone: 'ok' } : c.payment_stopped ? { label: 'Payment stopped', tone: 'bad' } : { label: c.status, tone: c.status === 'Approved' ? 'ok' : 'warn' },
    parties: [{
      heading: 'Claimed by',
      name: `${c.first_name} ${c.last_name}`,
      lines: [`Employee No. ${c.employee_no}`, c.job_title || ''].filter(Boolean),
    }],
    meta: [
      { label: 'Claim No.', value: c.no },
      { label: 'Claim Date', value: formatDate(c.claim_date) },
      { label: 'Settlement', value: c.settlement },
      { label: 'Paid From', value: c.settlement === 'Pay from Payroll' ? 'Payroll' : c.paying_bank_code || '—' },
      { label: 'Pay Mode', value: c.pay_mode_code || '—' },
      { label: 'Reference', value: c.payment_tx_no || '—' },
      { label: 'Amount Claimed', value: money(c.total_amount), strong: true },
    ],
    columns: [
      { key: 'account', label: 'Expense Account', width: '20%' },
      { key: 'narration', label: 'Narration' },
      { key: 'date', label: 'Date', width: '11%' },
      { key: 'ref', label: 'Receipt Ref.', width: '12%' },
      { key: 'qty', label: 'Qty', align: 'right', width: '6%' },
      { key: 'amount', label: 'Amount', align: 'right', width: '15%' },
    ],
    rows: c.line_items.map((l) => ({ cells: { account: `${l.gl_account_code} ${l.gl_account_name}`, narration: l.narration || '', date: l.expense_date ? formatDate(l.expense_date) : '', ref: l.receipt_ref || '', qty: String(l.quantity), amount: money(l.amount) } })),
    totals: [{ label: 'Total claimed', value: money(c.total_amount), grand: true }],
    amount_words: amountInWords(Number(c.total_amount), currencyLabel(c.currency_code)),
    notes: c.justification ? [{ heading: 'Justification', body: c.justification }] : [],
    approvals: await documentSignatories('STAFF_CLAIM', c.no, c.created_by, { raisedAt: c.created_at, clearedBy: c.posted_by ?? c.created_by }),
    acknowledgement: { title: 'Received by (claimant)' },
    footnote: 'Receipts for every amount claimed are attached to this form.',
  };
}
