/*
 * Requisition printouts — AL (Sacco ERP) Report 53072 "Store Requisition Document" (Pag52203805)
 * and Report 53071 / "Purchase Requisition" (Pag52203808 "Print Out" / "Print Approved purchase
 * requisition").
 */
import { formatDate, formatDateTime } from './format.ts';
import { amountInWords } from './numberToWords.ts';
import { printBrand, documentMoney, documentSignatories, currencyLabel, type PrintDocument } from './documentPrint.ts';
import { getRequisitionDetail, WORKFLOW_TYPE } from './requisitions.ts';

const requester = (r: NonNullable<Awaited<ReturnType<typeof getRequisitionDetail>>>) => ({
  heading: 'Requested by',
  name: `${r.first_name} ${r.last_name}`,
  lines: [`Employee No. ${r.employee_no}`, r.job_title || ''].filter(Boolean),
});

/** Report 53072 — what the store issues against, signed for by the requester on receipt. */
export async function buildStoreRequisitionPrint(no: string): Promise<PrintDocument | null> {
  const r = await getRequisitionDetail(no);
  if (!r || r.requisition_type !== 'Store Requisition') return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, r.currency_code);
  const stage = r.status === 'Received' ? 'Received' : r.issued ? 'Issued' : r.status;
  return {
    brand,
    title: 'Store Requisition',
    subtitle: r.title,
    watermark: r.status === 'Open' || r.status === 'Pending Approval' ? r.status.toUpperCase() : null,
    status: { label: stage, tone: stage === 'Received' || stage === 'Issued' || stage === 'Approved' ? 'ok' : 'warn' },
    parties: [requester(r), {
      heading: 'Issued from',
      name: r.location_code ? `${r.location_code} — ${r.location_name}` : 'Store',
      lines: [r.issued_by ? `Issued by ${r.issued_by} on ${formatDate(r.issued_at)}` : 'Not yet issued', r.received_by ? `Received by ${r.received_by} on ${formatDate(r.received_at)}` : ''].filter(Boolean),
    }],
    meta: [
      { label: 'Requisition No.', value: r.no },
      { label: 'Requisition Date', value: formatDate(r.requisition_date) },
      { label: 'Needed By', value: r.needed_by_date ? formatDate(r.needed_by_date) : '—' },
      { label: 'Qty Requested', value: String(r.total_quantity) },
      { label: 'Qty Approved', value: String(r.total_quantity_approved) },
      { label: 'Qty Issued', value: String(r.total_quantity_issued), strong: true },
    ],
    columns: [
      { key: 'item', label: 'Item', width: '12%' },
      { key: 'description', label: 'Description' },
      { key: 'uom', label: 'Unit', width: '8%' },
      { key: 'location', label: 'Location', width: '10%' },
      { key: 'requested', label: 'Requested', align: 'right', width: '10%' },
      { key: 'approved', label: 'Approved', align: 'right', width: '10%' },
      { key: 'issued', label: 'Issued', align: 'right', width: '10%' },
      { key: 'value', label: 'Value', align: 'right', width: '13%' },
    ],
    rows: r.line_items.map((l) => ({ cells: {
      item: l.no, description: l.description, uom: l.unit_of_measure_code || '', location: l.location_code || '',
      requested: String(l.quantity), approved: String(l.quantity_approved), issued: String(l.quantity_issued), value: money(l.amount),
    } })),
    totals: [{ label: 'Value of items approved', value: money(r.total_amount), grand: true }],
    amount_words: amountInWords(Number(r.total_amount), currencyLabel(r.currency_code)),
    notes: r.description ? [{ heading: 'Purpose', body: r.description }] : [],
    approvals: await documentSignatories(WORKFLOW_TYPE[r.requisition_type], r.no, r.created_by, { raisedAt: r.created_at, clearedBy: r.issued_by ?? r.created_by }),
    acknowledgement: { title: 'Received by (requester)' },
    footnote: 'Items are issued against this requisition only; any shortfall is noted on the store copy.',
  };
}

/** Report 53071 — the approved purchase requisition procurement works from. */
export async function buildPurchaseRequisitionPrint(no: string): Promise<PrintDocument | null> {
  const r = await getRequisitionDetail(no);
  if (!r || r.requisition_type !== 'Purchase Requisition') return null;
  const brand = await printBrand();
  if (!brand) return null;
  const money = documentMoney(brand, r.currency_code);
  const stage = r.pr_closed ? `Closed — ${r.pr_closed_by}` : r.status;
  return {
    brand,
    title: 'Purchase Requisition',
    subtitle: r.title,
    watermark: r.status === 'Open' || r.status === 'Pending Approval' ? r.status.toUpperCase() : null,
    status: { label: stage, tone: r.pr_closed ? (r.pr_closed_by === 'Rejection' ? 'bad' : 'ok') : r.status === 'Approved' ? 'ok' : 'warn' },
    parties: [requester(r), {
      heading: 'Procurement',
      name: r.procurement_method || 'Method not set',
      lines: [
        r.supplier_no ? `Suggested supplier ${r.supplier_no} — ${r.supplier_name}` : '',
        r.location_code ? `Deliver to ${r.location_code} — ${r.location_name}` : '',
        r.po_number ? `Raised ${r.documents.map((d) => `${d.document_type} ${d.no}`).join(', ')}` : '',
      ].filter(Boolean),
    }],
    meta: [
      { label: 'Requisition No.', value: r.no },
      { label: 'Requisition Date', value: formatDate(r.requisition_date) },
      { label: 'Needed By', value: r.needed_by_date ? formatDate(r.needed_by_date) : '—' },
      { label: 'Expires', value: r.expiration_date ? formatDate(r.expiration_date) : '—' },
      { label: 'Requested Delivery', value: r.requested_delivery_date ? formatDate(r.requested_delivery_date) : '—' },
      { label: 'Estimated Amount', value: money(r.total_amount), strong: true },
    ],
    columns: [
      { key: 'type', label: 'Type', width: '10%' },
      { key: 'no', label: 'No.', width: '11%' },
      { key: 'description', label: 'Description' },
      { key: 'qty', label: 'Qty', align: 'right', width: '7%' },
      { key: 'approved', label: 'Approved', align: 'right', width: '8%' },
      { key: 'price', label: 'Unit Price', align: 'right', width: '12%' },
      { key: 'amount', label: 'Amount', align: 'right', width: '13%' },
      { key: 'decision', label: 'Decision', width: '14%' },
    ],
    rows: r.line_items.map((l) => ({ cells: {
      type: l.type, no: l.no, description: l.description, qty: String(l.quantity), approved: String(l.quantity_approved),
      price: money(l.unit_price), amount: money(l.amount), decision: l.processed ? `${l.decision} · ${l.order_no}` : l.decision || '',
    } })),
    totals: [{ label: 'Total estimated', value: money(r.total_amount), grand: true }],
    amount_words: amountInWords(Number(r.total_amount), currencyLabel(r.currency_code)),
    notes: [
      r.description ? { heading: 'Justification', body: r.description } : null,
      r.pr_closed && r.pr_closed_by !== 'Purchase Order' ? { heading: `Closed by ${r.pr_closed_by}`, body: `${r.pr_close_reason || ''} — ${r.pr_closed_by_user} on ${formatDateTime(r.pr_closed_at)}`.trim() } : null,
    ].filter((n): n is { heading: string; body: string } => !!n),
    approvals: await documentSignatories(WORKFLOW_TYPE[r.requisition_type], r.no, r.created_by, { raisedAt: r.created_at, clearedBy: r.po_generated_by ?? r.pr_closed_by_user ?? r.created_by }),
    acknowledgement: { title: 'Procurement officer' },
  };
}
