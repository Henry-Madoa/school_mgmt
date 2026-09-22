/*
 * Store & Purchase Requisitions — AL (Sacco ERP) Tab52203515 "Requisition Header",
 * Tab52203516 "Requisition Lines", Pag52203805 "Store Requisition Card", Pag52203808 "Purchase
 * Requisition Card", Pag52203556 "Requisitions Review", Cod52203477.StoresManagement
 * (IssueStoreItems), Cod52203478.ProcurementManagement (CreatePurchaseHeader/Lines).
 *
 * One header carries both requisition types (the AL "Requisition Type" enum):
 *
 *   Store Requisition      an employee asks the store for stock items. Lines are Items only and
 *                          a line may not ask for more than is on hand at its location (the AL
 *                          "low stock" error). Approval → the store admin sets Quantity To Issue
 *                          per line and issues: every issue is a Negative Adjmt. item journal
 *                          line posted straight through lib/itemJournal.ts, exactly as
 *                          Cod52203477.IssueStoreItems inserts and posts an Item Journal Line.
 *                          Once every line is issued in full the requisition is Issued (AL
 *                          Posted); the requester then Confirms Receipt (status Received).
 *
 *   Purchase Requisition   an employee asks procurement to buy (G/L Account / Item / Fixed Asset
 *                          lines with a unit price). Approval → procurement reviews each line
 *                          (Pag52203556): Decision RFQ raises a Purchase Quote, Order a Purchase
 *                          Order, Append to Order adds the line onto an open Purchase Order —
 *                          one document per vendor per run — and Execute raises them in Payables
 *                          (lib/purchaseDocuments.ts) stamped with this requisition's number.
 *                          When every line is processed the PR is closed "by Purchase Order";
 *                          procurement may also close it by Direct Receipt or Rejection.
 *
 * Tender / RFP committees, procurement plans and item budgets in the AL are not ported.
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { stampEmployeeDimensions } from './selfService.ts';
import { AppError } from './errors.ts';
import { resolvePostingDate } from './postingDates.ts';
import { findMatchingWorkflow, findPendingRoutedTask, pickConditionFields, startWorkflow } from './workflow.ts';
import { qtyPerUnitOfMeasure } from './unitOfMeasureConversion.ts';
import type { PurchaseLineInput } from './purchaseDocuments.ts';
import type {
  Actor, Cents, IsoDate, ProcurementMethod, Requisition, RequisitionCloseReason, RequisitionDecision, RequisitionDetail,
  RequisitionLine, RequisitionLineType, RequisitionLineView, RequisitionType, RequisitionView, WorkflowDocumentType,
} from './types.ts';

export const REQUISITION_TYPES: RequisitionType[] = ['Store Requisition', 'Purchase Requisition'];
export const PROCUREMENT_METHODS: ProcurementMethod[] = ['RFQ', 'RFP', 'Direct Procurement', 'Restricted Tendering', 'Open Tendering', 'Low Value Procurement'];
export const REQUISITION_DECISIONS: RequisitionDecision[] = ['', 'RFQ', 'Order', 'Append to Order'];
export const PR_CLOSE_REASONS: RequisitionCloseReason[] = ['Direct Receipt of Goods/Services', 'Rejection'];
const LINE_TYPES: RequisitionLineType[] = ['Item', 'G/L Account', 'Fixed Asset'];

export const WORKFLOW_TYPE: Record<RequisitionType, WorkflowDocumentType> = {
  'Store Requisition': 'STORE_REQUISITION',
  'Purchase Requisition': 'PURCHASE_REQUISITION',
};

export type RequisitionListView = 'open' | 'pending' | 'approved' | 'issued' | 'received' | 'closed' | 'all';

const VIEW_CLAUSE: Record<RequisitionListView, string> = {
  open: "r.status = 'Open'",
  pending: "r.status = 'Pending Approval'",
  // Store: approved and still being issued. Purchase: approved and not yet closed (under review).
  approved: "r.status = 'Approved' AND NOT r.issued AND NOT r.pr_closed",
  issued: "r.issued AND r.status = 'Approved'",
  received: "r.status = 'Received'",
  closed: 'r.pr_closed',
  all: 'TRUE',
};

const SELECT_HEAD = `
  SELECT r.*, e.employee_no, e.first_name, e.last_name, e.job_title,
         l.code AS location_code, l.name AS location_name, v.no AS supplier_no, v.name AS supplier_name,
         COALESCE(t.qty, 0)::int AS total_quantity, COALESCE(t.qty_approved, 0)::int AS total_quantity_approved,
         COALESCE(t.qty_issued, 0)::int AS total_quantity_issued, COALESCE(t.amount, 0)::bigint AS total_amount,
         COALESCE(t.lines, 0)::int AS lines, COALESCE(t.processed, 0)::int AS lines_processed
  FROM requisition r
  JOIN employee e ON e.id = r.employee_id
  LEFT JOIN location l ON l.id = r.location_id
  LEFT JOIN vendor v ON v.id = r.supplier_id
  LEFT JOIN LATERAL (
    SELECT SUM(quantity) AS qty, SUM(quantity_approved) AS qty_approved, SUM(quantity_issued) AS qty_issued, SUM(amount) AS amount,
           COUNT(*) AS lines, COUNT(*) FILTER (WHERE processed) AS processed
    FROM requisition_line rl WHERE rl.requisition_no = r.no
  ) t ON TRUE`;

export const listRequisitions = (type: RequisitionType, view: RequisitionListView = 'all', search = '', employeeId: number | null = null): Promise<RequisitionView[]> =>
  all<RequisitionView>(
    `${SELECT_HEAD}
     WHERE r.requisition_type = @type AND ${VIEW_CLAUSE[view]}
       AND (r.no ILIKE @like OR r.title ILIKE @like OR e.employee_no ILIKE @like OR e.first_name ILIKE @like OR e.last_name ILIKE @like)
       ${employeeId ? 'AND r.employee_id = @employeeId' : ''}
     ORDER BY r.no DESC LIMIT 500`,
    { type, like: `%${String(search).trim()}%`, ...(employeeId ? { employeeId } : {}) },
  );

export const hasAnyRequisitions = (type: RequisitionType, view: RequisitionListView = 'all'): Promise<boolean> =>
  hasAnyRow('requisition r', `r.requisition_type = '${type}' AND ${VIEW_CLAUSE[view]}`);

export async function requisitionCounts(type: RequisitionType): Promise<Record<RequisitionListView, number>> {
  const rows = await all<{ status: string; issued: boolean; pr_closed: boolean; n: number }>(
    'SELECT status, issued, pr_closed, COUNT(*)::int AS n FROM requisition WHERE requisition_type = ? GROUP BY 1, 2, 3', type);
  const c: Record<RequisitionListView, number> = { open: 0, pending: 0, approved: 0, issued: 0, received: 0, closed: 0, all: 0 };
  for (const r of rows) {
    c.all += r.n;
    if (r.status === 'Open') c.open += r.n;
    else if (r.status === 'Pending Approval') c.pending += r.n;
    else if (r.status === 'Received') c.received += r.n;
    else if (r.status === 'Approved') { if (r.issued) c.issued += r.n; else if (!r.pr_closed) c.approved += r.n; }
    if (r.pr_closed) c.closed += r.n;
  }
  return c;
}

export const getRequisition = (no: string): Promise<RequisitionView | undefined> => one<RequisitionView>(`${SELECT_HEAD} WHERE r.no = ?`, no);

/** AL "Quantity in Store": on hand at the location, expressed in the line's own unit. */
async function stockInUnit(itemId: number | null, locationId: number | null, unitOfMeasureId: number | null): Promise<number> {
  if (!itemId || !locationId) return 0;
  const sku = await one<{ inventory: number }>('SELECT inventory FROM stockkeeping_unit WHERE item_id = ? AND location_id = ?', itemId, locationId);
  const base = Number(sku?.inventory ?? 0);
  if (!unitOfMeasureId) return base;
  try { return Math.floor(base / (await qtyPerUnitOfMeasure(itemId, unitOfMeasureId))); } catch { return base; }
}

export async function listRequisitionLines(no: string): Promise<RequisitionLineView[]> {
  const rows = await all<RequisitionLineView>(
    `SELECT rl.*, u.code AS unit_of_measure_code, l.code AS location_code, 0 AS quantity_in_store,
            CASE WHEN rl.decision = 'Append to Order' THEN (SELECT 'PO ' || ph.no || ' — ' || v2.name FROM purchase_header ph JOIN vendor v2 ON v2.id = ph.vendor_id WHERE ph.no = rl.target_no)
                 WHEN rl.decision IN ('RFQ', 'Order') THEN (SELECT v3.name FROM vendor v3 WHERE v3.no = rl.target_no) END AS target_name
     FROM requisition_line rl
     LEFT JOIN unit_of_measure u ON u.id = rl.unit_of_measure_id
     LEFT JOIN location l ON l.id = rl.location_id
     WHERE rl.requisition_no = ? ORDER BY rl.line_no`, no);
  for (const r of rows) r.quantity_in_store = r.type === 'Item' ? await stockInUnit(r.item_id, r.location_id, r.unit_of_measure_id) : 0;
  return rows;
}

export async function getRequisitionDetail(no: string): Promise<RequisitionDetail | undefined> {
  const head = await getRequisition(no);
  if (!head) return undefined;
  const [line_items, documents, issues] = await Promise.all([
    listRequisitionLines(no),
    all<RequisitionDetail['documents'][number]>(
      `SELECT ph.no, ph.document_type, v.no AS vendor_no, v.name AS vendor_name, ph.status, ph.amount
       FROM purchase_header ph JOIN vendor v ON v.id = ph.vendor_id WHERE ph.requisition_no = ? ORDER BY ph.no`, no),
    all<RequisitionDetail['issues'][number]>(
      `SELECT ijl.no, rl.line_no, i.no AS item_no, i.description, ijl.quantity, ijl.posting_date, ijl.posted_by, l.code AS location_code
       FROM item_journal_line ijl JOIN requisition_line rl ON rl.id = ijl.requisition_line_id
       JOIN item i ON i.id = ijl.item_id JOIN location l ON l.id = ijl.location_id
       WHERE rl.requisition_no = ? ORDER BY ijl.id`, no),
  ]);
  return { ...head, line_items, documents, issues };
}

/* ------------------------------------------------------------- create / edit */

export interface RequisitionLineInput {
  type?: RequisitionLineType;
  /** Item No. / G/L account code / Fixed Asset No. */
  no: string;
  description?: string | null;
  unitOfMeasureId?: number | null;
  quantity: number;
  unitPrice?: Cents;
  locationId?: number | null;
}

export interface RequisitionInput {
  requisitionType: RequisitionType;
  employeeId: number;
  title: string;
  description?: string | null;
  requisitionDate: IsoDate;
  neededByDate?: IsoDate | null;
  expirationDate?: IsoDate | null;
  requestedDeliveryDate?: IsoDate | null;
  locationId?: number | null;
  procurementMethod?: ProcurementMethod | null;
  supplierId?: number | null;
  lines: RequisitionLineInput[];
}

interface ResolvedLine {
  type: RequisitionLineType; no: string; description: string; itemId: number | null; glAccountId: number | null;
  unitOfMeasureId: number | null; quantity: number; unitPrice: Cents; amount: Cents; locationId: number | null;
}

async function resolveLine(input: RequisitionLineInput, header: RequisitionInput): Promise<ResolvedLine> {
  const type = input.type ?? 'Item';
  if (!LINE_TYPES.includes(type)) throw new AppError('Invalid line type', 'VALIDATION');
  if (header.requisitionType === 'Store Requisition' && type !== 'Item') throw new AppError('A store requisition asks for stock items only', 'VALIDATION');
  if (!input.no?.trim()) throw new AppError(`Every line needs a ${type} No.`, 'VALIDATION');
  const quantity = type === 'Fixed Asset' ? 1 : Math.round(Number(input.quantity));
  if (!(quantity > 0)) throw new AppError(`Quantity must be greater than zero on ${input.no}`, 'VALIDATION');
  const unitPrice = Math.round(Number(input.unitPrice ?? 0));
  if (unitPrice < 0) throw new AppError('Unit price cannot be negative', 'VALIDATION');
  const locationId = input.locationId ?? header.locationId ?? null;

  if (type === 'Item') {
    const item = await one<{ id: number; description: string; status: string; unit_cost: Cents; base_unit_of_measure_id: number }>(
      'SELECT id, description, status, unit_cost, base_unit_of_measure_id FROM item WHERE no = ?', input.no.trim());
    if (!item) throw new AppError(`Item ${input.no} not found`, 'NOT_FOUND');
    if (item.status !== 'ACTIVE') throw new AppError(`Item ${input.no} is blocked`, 'VALIDATION');
    const uomId = input.unitOfMeasureId ?? item.base_unit_of_measure_id;
    const factor = await qtyPerUnitOfMeasure(item.id, uomId); // throws when the unit isn't set up for the item
    if (header.requisitionType === 'Store Requisition') {
      if (!locationId) throw new AppError(`Pick the store location to draw ${input.no} from`, 'VALIDATION');
      await assertActiveLocation(locationId);
      // Tab52203516 Quantity OnValidate — the AL refuses a request the store cannot meet.
      const inStore = await stockInUnit(item.id, locationId, uomId);
      if (inStore < quantity) {
        throw new AppError(`Your request for ${item.description} cannot proceed because of low stock — the quantity in store is ${inStore}. Kindly reduce the quantity`, 'VALIDATION');
      }
    } else if (locationId) await assertActiveLocation(locationId);
    const price = header.requisitionType === 'Store Requisition' ? Math.round(Number(item.unit_cost) * factor) : (unitPrice || Math.round(Number(item.unit_cost) * factor));
    return { type, no: input.no.trim(), description: input.description?.trim() || item.description, itemId: item.id, glAccountId: null, unitOfMeasureId: uomId, quantity, unitPrice: price, amount: quantity * price, locationId };
  }
  if (type === 'G/L Account') {
    const acc = await one<{ id: number; name: string; is_postable: number; status: string; no_direct_posting: number }>(
      'SELECT id, name, is_postable, status, no_direct_posting FROM gl_account WHERE code = ?', input.no.trim());
    if (!acc || !acc.is_postable || acc.status !== 'ACTIVE') throw new AppError(`${input.no} is not an active posting G/L account`, 'VALIDATION');
    if (acc.no_direct_posting) throw new AppError(`G/L account ${input.no} is a subledger control account`, 'VALIDATION');
    return { type, no: input.no.trim(), description: input.description?.trim() || acc.name, itemId: null, glAccountId: acc.id, unitOfMeasureId: null, quantity, unitPrice, amount: quantity * unitPrice, locationId: null };
  }
  const fa = await one<{ id: number; description: string; blocked: number }>('SELECT id, description, blocked FROM fixed_asset WHERE no = ?', input.no.trim());
  if (!fa) throw new AppError(`Fixed asset ${input.no} not found`, 'NOT_FOUND');
  if (fa.blocked) throw new AppError(`Fixed asset ${input.no} is blocked`, 'VALIDATION');
  return { type, no: input.no.trim(), description: input.description?.trim() || fa.description, itemId: null, glAccountId: null, unitOfMeasureId: null, quantity: 1, unitPrice, amount: unitPrice, locationId: null };
}

async function assertActiveLocation(locationId: number): Promise<void> {
  const l = await one<{ status: string }>('SELECT status FROM location WHERE id = ?', locationId);
  if (!l) throw new AppError('Location not found', 'NOT_FOUND');
  if (l.status !== 'ACTIVE') throw new AppError('That location is not active', 'VALIDATION');
}

async function assertHeader(input: RequisitionInput): Promise<void> {
  if (!REQUISITION_TYPES.includes(input.requisitionType)) throw new AppError('Invalid requisition type', 'VALIDATION');
  const e = await one<{ employee_no: string; status: string }>('SELECT employee_no, status FROM employee WHERE id = ?', input.employeeId);
  if (!e) throw new AppError('Employee not found', 'NOT_FOUND');
  if (!['ACTIVE', 'ON_LEAVE'].includes(e.status)) throw new AppError(`${e.employee_no} is not an active employee`, 'VALIDATION');
  if (!input.title?.trim()) throw new AppError('Give the requisition a title', 'VALIDATION');
  if (!input.requisitionDate) throw new AppError('A requisition date is required', 'VALIDATION');
  // Tab52203515 "Needed By Date" OnValidate.
  if (input.neededByDate && input.neededByDate < input.requisitionDate) throw new AppError('The Needed By date cannot be earlier than the requisition date', 'VALIDATION');
  if (input.expirationDate && input.expirationDate < input.requisitionDate) throw new AppError('The expiration date cannot be earlier than the requisition date', 'VALIDATION');
  if (input.locationId) await assertActiveLocation(input.locationId);
  if (input.requisitionType === 'Store Requisition' && !input.locationId) throw new AppError('Pick the store location the items are drawn from', 'VALIDATION');
  if (input.requisitionType === 'Purchase Requisition') {
    if (input.procurementMethod && !PROCUREMENT_METHODS.includes(input.procurementMethod)) throw new AppError('Invalid procurement method', 'VALIDATION');
    if (input.supplierId) {
      const v = await one<{ blocked: string }>('SELECT blocked FROM vendor WHERE id = ?', input.supplierId);
      if (!v) throw new AppError('Supplier not found', 'NOT_FOUND');
      if (v.blocked) throw new AppError('That supplier is blocked', 'VALIDATION');
    }
  }
  if (!input.lines?.length) throw new AppError('Add at least one line', 'VALIDATION');
}

async function replaceLines(no: string, input: RequisitionInput, keep: Map<number, RequisitionLine> | null): Promise<void> {
  const resolved: ResolvedLine[] = [];
  for (const l of input.lines) resolved.push(await resolveLine(l, input));
  await run('DELETE FROM requisition_line WHERE requisition_no = ?', no);
  let lineNo = 10000;
  for (const r of resolved) {
    const prior = keep?.get(lineNo);
    // Tab52203516: Quantity Approved defaults to the quantity asked for.
    const approved = prior && prior.no === r.no && prior.quantity === r.quantity ? prior.quantity_approved : r.quantity;
    await run(
      `INSERT INTO requisition_line (requisition_no, line_no, type, no, description, item_id, gl_account_id, unit_of_measure_id, quantity, quantity_approved, unit_price, amount, location_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, lineNo, r.type, r.no, r.description, r.itemId, r.glAccountId, r.unitOfMeasureId, r.quantity, approved, r.unitPrice, r.amount, r.locationId,
    );
    lineNo += 10000;
  }
}

const headerParams = (input: RequisitionInput) => [
  input.employeeId, input.title.trim(), input.description?.trim() || null, input.requisitionDate, input.neededByDate || null, input.expirationDate || null,
  input.requestedDeliveryDate || null, input.locationId ?? null, input.requisitionType === 'Purchase Requisition' ? (input.procurementMethod || null) : null,
  input.requisitionType === 'Purchase Requisition' ? (input.supplierId ?? null) : null,
];

export async function createRequisition(input: RequisitionInput, user: Actor): Promise<{ no: string }> {
  await assertHeader(input);
  const no = await nextSequence(input.requisitionType === 'Store Requisition' ? 'STORE_REQUISITION' : 'PURCHASE_REQUISITION');
  await tx(async () => {
    await run(
      `INSERT INTO requisition (no, requisition_type, employee_id, title, description, requisition_date, needed_by_date, expiration_date, requested_delivery_date, location_id, procurement_method, supplier_id, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, input.requisitionType, ...headerParams(input), new Date().toISOString(), user.username,
    );
    await stampEmployeeDimensions('requisition', no);
    await replaceLines(no, input, null);
  });
  await audit(user, 'REQUISITION_CREATE', 'requisition', no, { type: input.requisitionType });
  return { no };
}

async function editable(no: string, user: Actor): Promise<Requisition> {
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.status !== 'Open') throw new AppError('Only an open requisition can be changed', 'VALIDATION');
  if (r.created_by !== user.username) throw new AppError('Only the person who raised this requisition can change it', 'NOT_CREATOR');
  return r;
}

export async function updateRequisition(no: string, input: RequisitionInput, user: Actor): Promise<void> {
  const r = await editable(no, user);
  if (input.requisitionType !== r.requisition_type) throw new AppError('The requisition type cannot change', 'VALIDATION');
  await assertHeader(input);
  const keep = new Map((await all<RequisitionLine>('SELECT * FROM requisition_line WHERE requisition_no = ?', no)).map((l) => [l.line_no, l]));
  await tx(async () => {
    await run(
      `UPDATE requisition SET employee_id = ?, title = ?, description = ?, requisition_date = ?, needed_by_date = ?, expiration_date = ?, requested_delivery_date = ?, location_id = ?, procurement_method = ?, supplier_id = ? WHERE no = ?`,
      ...headerParams(input), no,
    );
    await stampEmployeeDimensions('requisition', no);
    await replaceLines(no, input, keep);
  });
  await audit(user, 'REQUISITION_UPDATE', 'requisition', no, {});
}

export async function deleteRequisition(no: string, user: Actor): Promise<void> {
  await editable(no, user);
  await run('DELETE FROM requisition WHERE no = ?', no);
  await audit(user, 'REQUISITION_DELETE', 'requisition', no, {});
}

/* -------------------------------------------------------------- maker-checker */

export async function submitRequisition(no: string, user: Actor): Promise<{ autoApproved: boolean }> {
  const r = await getRequisition(no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.status !== 'Open') throw new AppError('Only an open requisition can be sent for approval', 'VALIDATION');
  if (!r.lines) throw new AppError('The requisition has no lines', 'VALIDATION');
  const type = WORKFLOW_TYPE[r.requisition_type];
  const matched = await findMatchingWorkflow(type, await pickConditionFields(type, { ...r, amount: r.total_amount }));
  if (!matched) throw new AppError('There is no enabled workflow for this document', 'NO_WORKFLOW');
  await tx(async () => {
    await run("UPDATE requisition SET status = 'Pending Approval' WHERE no = ?", no);
    await startWorkflow(matched.workflow, matched.steps, { documentType: type, entityId: no, requestedBy: user.username, amount: Number(r.total_amount) });
  });
  const after = await one<{ status: string }>('SELECT status FROM requisition WHERE no = ?', no);
  return { autoApproved: after?.status === 'Approved' };
}

export async function cancelRequisitionApproval(no: string, user: Actor): Promise<void> {
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.status !== 'Pending Approval') throw new AppError('Only a requisition pending approval can be recalled', 'VALIDATION');
  const routed = await findPendingRoutedTask(WORKFLOW_TYPE[r.requisition_type], no);
  if ((routed?.requested_by ?? r.created_by) !== user.username) throw new AppError('Only the person who submitted this requisition can recall it', 'NOT_REQUESTER');
  await run("UPDATE requisition SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'REQUISITION_CANCEL_APPROVAL', 'requisition', no, {});
}

export async function approveRequisition(no: string, user: Actor): Promise<void> {
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.status !== 'Pending Approval') throw new AppError('Only a requisition pending approval can be approved', 'VALIDATION');
  await tx(async () => {
    await run("UPDATE requisition SET status = 'Approved', decision_reason = NULL WHERE no = ?", no);
    // Tab52203516 "Quantity Approved" OnValidate → Quantity To Issue defaults to what is left to issue.
    await run('UPDATE requisition_line SET quantity_to_issue = GREATEST(quantity_approved - quantity_issued, 0) WHERE requisition_no = ?', no);
  });
  await audit(user, 'REQUISITION_APPROVE', 'requisition', no, {});
}

/** Pag52203808 "Send Back To User" / Pag52203805 Reject — back to Open with the reason. */
export async function rejectRequisition(no: string, reason: string | null, user: Actor): Promise<void> {
  if (!reason?.trim()) throw new AppError('A reason is required to reject a requisition', 'VALIDATION');
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.status !== 'Pending Approval') throw new AppError('Only a requisition pending approval can be rejected', 'VALIDATION');
  await run("UPDATE requisition SET status = 'Open', decision_reason = ? WHERE no = ?", reason, no);
  await audit(user, 'REQUISITION_REJECT', 'requisition', no, { reason });
}

/** Pag52203805/808 "Re-Open" — an approved requisition nothing has been done on goes back to Open. */
export async function reopenRequisition(no: string, user: Actor): Promise<void> {
  const r = await getRequisition(no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.status !== 'Approved') throw new AppError('Only an approved requisition can be reopened', 'VALIDATION');
  if (r.issued || r.total_quantity_issued > 0) throw new AppError('Items have already been issued on this requisition', 'VALIDATION');
  if (r.pr_closed || r.lines_processed > 0) throw new AppError('Purchase documents have already been raised from this requisition', 'VALIDATION');
  await run("UPDATE requisition SET status = 'Open' WHERE no = ?", no);
  await audit(user, 'REQUISITION_REOPEN', 'requisition', no, {});
}

/** Tab52203516 "Quantity Approved" — the approver trims what was asked for; never above it. */
export async function setQuantityApproved(no: string, lineId: number, quantityApproved: number, user: Actor): Promise<void> {
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.status !== 'Pending Approval' && r.status !== 'Approved') throw new AppError('Quantities are approved on a requisition that is pending or approved', 'VALIDATION');
  if (r.issued || r.pr_closed) throw new AppError('This requisition has been completed', 'VALIDATION');
  const l = await one<RequisitionLine>('SELECT * FROM requisition_line WHERE id = ? AND requisition_no = ?', lineId, no);
  if (!l) throw new AppError('Requisition line not found', 'NOT_FOUND');
  if (l.processed) throw new AppError('That line has already been processed', 'VALIDATION');
  const q = Math.round(Number(quantityApproved));
  if (!(q >= 0)) throw new AppError('Quantity approved cannot be negative', 'VALIDATION');
  if (q > l.quantity) throw new AppError('Quantity Approved cannot be higher than the quantity requested!', 'VALIDATION');
  if (q < l.quantity_issued) throw new AppError(`${l.quantity_issued} have already been issued on that line`, 'VALIDATION');
  await run('UPDATE requisition_line SET quantity_approved = ?, quantity_to_issue = ?, amount = ? * unit_price WHERE id = ?', q, Math.max(q - l.quantity_issued, 0), q, lineId);
  await audit(user, 'REQUISITION_QTY_APPROVED', 'requisition', no, { lineId, quantityApproved: q });
}

/* ------------------------------------------------------------ store: issue */

/** Tab52203516 "Quantity To Issue" — never more than approved less already issued. */
export async function setQuantityToIssue(no: string, quantities: { lineId: number; quantity: number }[], user: Actor): Promise<void> {
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.requisition_type !== 'Store Requisition') throw new AppError('Only a store requisition issues items', 'VALIDATION');
  if (r.status !== 'Approved' || r.issued) throw new AppError('Only an approved, unissued store requisition can be issued', 'VALIDATION');
  await tx(async () => {
    for (const q of quantities) {
      const l = await one<RequisitionLine>('SELECT * FROM requisition_line WHERE id = ? AND requisition_no = ?', q.lineId, no);
      if (!l) throw new AppError('Requisition line not found', 'NOT_FOUND');
      const n = Math.round(Number(q.quantity));
      if (!(n >= 0)) throw new AppError('Quantity to issue cannot be negative', 'VALIDATION');
      if (n > l.quantity_approved - l.quantity_issued) throw new AppError(`You can't issue more than approved on ${l.description} — ${l.quantity_approved - l.quantity_issued} left to issue`, 'VALIDATION');
      await run('UPDATE requisition_line SET quantity_to_issue = ? WHERE id = ?', n, l.id);
    }
  });
  await audit(user, 'REQUISITION_QTY_TO_ISSUE', 'requisition', no, { lines: quantities.length });
}

/**
 * Cod52203477.StoresManagement.IssueStoreItems + Pag52203805 Post. Every line with a Quantity To
 * Issue becomes a Negative Adjmt. item journal line at the line's location, posted at once
 * through lib/itemJournal.ts (inventory G/L credited, adjustment account debited, lots consumed
 * per the item's costing method). The AL first refuses any line that would drive stock negative.
 */
export async function issueStoreItems(no: string, user: Actor): Promise<{ issued: number; complete: boolean; journalLines: string[] }> {
  const ij = await import('./itemJournal.ts');
  return tx(async () => {
    const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
    if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
    if (r.requisition_type !== 'Store Requisition') throw new AppError('Only a store requisition issues items', 'VALIDATION');
    if (r.status !== 'Approved') throw new AppError('Only an approved store requisition can be issued', 'VALIDATION');
    if (r.issued) throw new AppError(`Store requisition ${no} has already been issued in full`, 'VALIDATION');
    const lines = await all<RequisitionLine>('SELECT * FROM requisition_line WHERE requisition_no = ? ORDER BY line_no', no);
    const toIssue = lines.filter((l) => l.quantity_to_issue > 0);
    if (!toIssue.length) throw new AppError('Set a Quantity To Issue on at least one line', 'VALIDATION');
    const vd = await resolvePostingDate(user);
    // Pag52203805 Post: check every line first so nothing is issued when one cannot be.
    for (const l of toIssue) {
      if (l.quantity_to_issue > l.quantity_approved - l.quantity_issued) throw new AppError(`You can't issue more than approved on ${l.description}`, 'VALIDATION');
      if (!l.item_id || !l.location_id) throw new AppError(`Line ${l.line_no / 10000} has no item or location`, 'VALIDATION');
      const inStore = await stockInUnit(l.item_id, l.location_id, l.unit_of_measure_id);
      if (inStore < l.quantity_to_issue) throw new AppError(`The issue of item ${l.no} - ${l.description} will lead to negative inventory (${inStore} in store)`, 'VALIDATION');
    }
    const journalLines: string[] = [];
    let issued = 0;
    for (const l of toIssue) {
      const item = await one<{ base_unit_of_measure_id: number }>('SELECT base_unit_of_measure_id FROM item WHERE id = ?', l.item_id!);
      const { no: jno } = await ij.createItemJournalLine({
        postingDate: vd, entryType: 'Negative Adjmt.', itemId: l.item_id!, locationId: l.location_id!,
        description: `Store Req. ${no} — ${l.description}`, unitOfMeasureId: l.unit_of_measure_id ?? item!.base_unit_of_measure_id, quantity: l.quantity_to_issue,
      }, user);
      // The AL inserts and posts the journal line in one go — no separate approval of the journal.
      await run("UPDATE item_journal_line SET status = 'Approved', requisition_line_id = ? WHERE no = ?", l.id, jno);
      await ij.postItemJournalLine(jno, user);
      await run(
        'UPDATE requisition_line SET quantity_issued = quantity_issued + ?, quantity_to_issue = 0, issued_at = ?, issued_by = ? WHERE id = ?',
        l.quantity_to_issue, new Date().toISOString(), user.username, l.id,
      );
      issued += l.quantity_to_issue;
      journalLines.push(jno);
    }
    const left = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM requisition_line WHERE requisition_no = ? AND quantity_issued < quantity_approved', no);
    const complete = !left?.n;
    if (complete) await run('UPDATE requisition SET issued = true, issued_at = ?, issued_by = ? WHERE no = ?', new Date().toISOString(), user.username, no);
    await audit(user, 'REQUISITION_ISSUE', 'requisition', no, { issued, complete, journalLines });
    return { issued, complete, journalLines };
  });
}

/** Pag52203805 "Confirm Receipt" — only the requester, once everything is issued. */
export async function confirmStoreReceipt(no: string, user: Actor): Promise<void> {
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.requisition_type !== 'Store Requisition') throw new AppError('Only a store requisition is received', 'VALIDATION');
  if (!r.issued || r.status !== 'Approved') throw new AppError('The items have not been issued yet', 'VALIDATION');
  if (r.created_by !== user.username) throw new AppError('You are not the requester', 'NOT_REQUESTER');
  await run("UPDATE requisition SET status = 'Received', received = true, received_at = ?, received_by = ? WHERE no = ?", new Date().toISOString(), user.username, no);
  await audit(user, 'REQUISITION_RECEIVED', 'requisition', no, {});
}

/* ------------------------------------------------------ purchase: review */

/** Pag52203556 Requisitions Review — Decision + Target No. per line. */
export async function setLineDecision(no: string, lineId: number, decision: RequisitionDecision, targetNo: string | null, user: Actor): Promise<void> {
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.requisition_type !== 'Purchase Requisition') throw new AppError('Only a purchase requisition is reviewed', 'VALIDATION');
  if (r.status !== 'Approved' || r.pr_closed) throw new AppError('Only an approved, open purchase requisition is reviewed', 'VALIDATION');
  if (!REQUISITION_DECISIONS.includes(decision)) throw new AppError('Invalid decision', 'VALIDATION');
  const l = await one<RequisitionLine>('SELECT * FROM requisition_line WHERE id = ? AND requisition_no = ?', lineId, no);
  if (!l) throw new AppError('Requisition line not found', 'NOT_FOUND');
  if (l.processed) throw new AppError('That line has already been processed', 'VALIDATION');
  const target = targetNo?.trim() || null;
  if (decision && !target) throw new AppError(decision === 'Append to Order' ? 'Pick the purchase order to append to' : 'Pick the vendor', 'VALIDATION');
  if (decision === 'Append to Order' && target) {
    const ph = await one<{ document_type: string; status: string }>('SELECT document_type, status FROM purchase_header WHERE no = ?', target);
    if (!ph || ph.document_type !== 'Order') throw new AppError(`${target} is not a purchase order`, 'VALIDATION');
    if (ph.status !== 'Open') throw new AppError(`Purchase order ${target} is ${ph.status.toLowerCase()} — only an open order takes new lines`, 'VALIDATION');
  } else if (decision && target) {
    const v = await one<{ blocked: string }>('SELECT blocked FROM vendor WHERE no = ?', target);
    if (!v) throw new AppError(`Vendor ${target} not found`, 'NOT_FOUND');
    if (v.blocked) throw new AppError(`Vendor ${target} is blocked`, 'VALIDATION');
  }
  await run('UPDATE requisition_line SET decision = ?, target_no = ? WHERE id = ?', decision, decision ? target : null, lineId);
  await audit(user, 'REQUISITION_LINE_DECISION', 'requisition', no, { lineId, decision, target });
}

export interface ExecuteReviewResult { documents: { no: string; documentType: 'Quote' | 'Order'; vendorNo: string; lines: number; appended: boolean }[]; closed: boolean }

/**
 * Pag52203556 Execute. Every decided, unprocessed line is raised in Payables: one Purchase Order
 * (Order) or Purchase Quote (RFQ) per vendor per run, or appended onto the open order named as
 * the target. Lines are stamped processed with the document number; when none is left the PR
 * is closed by Purchase Order (AL "PO Generated Directly" / "PR Closed By").
 */
export async function executeRequisitionReview(no: string, user: Actor): Promise<ExecuteReviewResult> {
  const pd = await import('./purchaseDocuments.ts');
  return tx(async () => {
    const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
    if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
    if (r.requisition_type !== 'Purchase Requisition') throw new AppError('Only a purchase requisition is reviewed', 'VALIDATION');
    if (r.status !== 'Approved' || r.pr_closed) throw new AppError('Only an approved, open purchase requisition can be executed', 'VALIDATION');
    const lines = await all<RequisitionLine & { location_code: string | null }>(
      'SELECT rl.*, l.code AS location_code FROM requisition_line rl LEFT JOIN location l ON l.id = rl.location_id WHERE rl.requisition_no = ? ORDER BY rl.line_no', no);
    const pending = lines.filter((l) => !l.processed && l.decision && l.target_no);
    if (!pending.length) throw new AppError('Decide at least one line (RFQ, Order or Append to Order) with its target before executing', 'VALIDATION');
    const vd = await resolvePostingDate(user);
    const toPurchaseLine = (l: RequisitionLine & { location_code: string | null }): PurchaseLineInput => ({
      type: l.type, no: l.no, description: l.description, quantity: l.quantity_approved || l.quantity, directUnitCost: Number(l.unit_price),
      locationCode: l.type === 'Item' ? (l.location_code ?? null) : null,
    });
    // Group by decision + target (AL TempPO / TempRFQ keep one document per vendor per run).
    const groups = new Map<string, (RequisitionLine & { location_code: string | null })[]>();
    for (const l of pending) { const k = `${l.decision}|${l.target_no}`; groups.set(k, [...(groups.get(k) ?? []), l]); }
    const documents: ExecuteReviewResult['documents'] = [];
    for (const [key, group] of groups) {
      const [decision, target] = key.split('|');
      let docNo: string;
      if (decision === 'Append to Order') {
        await pd.appendPurchaseLines(target, group.map(toPurchaseLine), user);
        const ph = await one<{ vendor_no: string }>('SELECT v.no AS vendor_no FROM purchase_header ph JOIN vendor v ON v.id = ph.vendor_id WHERE ph.no = ?', target);
        docNo = target;
        documents.push({ no: docNo, documentType: 'Order', vendorNo: ph?.vendor_no ?? '', lines: group.length, appended: true });
      } else {
        const vendor = await one<{ id: number }>('SELECT id FROM vendor WHERE no = ?', target);
        if (!vendor) throw new AppError(`Vendor ${target} not found`, 'NOT_FOUND');
        const documentType = decision === 'RFQ' ? 'Quote' : 'Order';
        const created = await pd.createPurchaseDocument({ documentType, vendorId: vendor.id, postingDate: vd, documentDate: vd, purchaser: user.username, requisitionNo: no }, user);
        await pd.setPurchaseLines(created.no, group.map(toPurchaseLine), user);
        docNo = created.no;
        documents.push({ no: docNo, documentType, vendorNo: target, lines: group.length, appended: false });
      }
      for (const l of group) await run('UPDATE requisition_line SET processed = true, order_no = ? WHERE id = ?', docNo, l.id);
    }
    const left = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM requisition_line WHERE requisition_no = ? AND NOT processed', no);
    const closed = !left?.n;
    const now = new Date().toISOString();
    await run(
      `UPDATE requisition SET po_generated_directly = true, po_generated_by = COALESCE(po_generated_by, ?), po_generated_at = COALESCE(po_generated_at, ?), po_number = COALESCE(po_number, ?),
         pr_closed = ?, pr_closed_by = CASE WHEN ? THEN 'Purchase Order' ELSE pr_closed_by END, pr_closed_at = CASE WHEN ? THEN ? ELSE pr_closed_at END, pr_closed_by_user = CASE WHEN ? THEN ? ELSE pr_closed_by_user END
       WHERE no = ?`,
      user.username, now, documents[0]?.no ?? null, closed, closed, closed, now, closed, user.username, no,
    );
    await audit(user, 'REQUISITION_EXECUTE', 'requisition', no, { documents, closed });
    return { documents, closed };
  });
}

/** AL "PR Closed By" Direct Receipt of Goods/Services | Rejection — closing without raising documents. */
export async function closePurchaseRequisition(no: string, reason: RequisitionCloseReason, note: string | null, user: Actor): Promise<void> {
  const r = await one<Requisition>('SELECT * FROM requisition WHERE no = ?', no);
  if (!r) throw new AppError('Requisition not found', 'NOT_FOUND');
  if (r.requisition_type !== 'Purchase Requisition') throw new AppError('Only a purchase requisition is closed this way', 'VALIDATION');
  if (r.status !== 'Approved' || r.pr_closed) throw new AppError('Only an approved, open purchase requisition can be closed', 'VALIDATION');
  if (!PR_CLOSE_REASONS.includes(reason)) throw new AppError('Choose Direct Receipt of Goods/Services or Rejection', 'VALIDATION');
  if (reason === 'Rejection' && !note?.trim()) throw new AppError('Give the reason the requisition is rejected', 'VALIDATION');
  await run('UPDATE requisition SET pr_closed = true, pr_closed_by = ?, pr_closed_at = ?, pr_closed_by_user = ?, pr_close_reason = ? WHERE no = ?',
    reason, new Date().toISOString(), user.username, note?.trim() || null, no);
  await audit(user, 'REQUISITION_CLOSE', 'requisition', no, { reason, note });
}

/** Open purchase orders a line may be appended to (Pag52203556 "Target No." for Append to Order). */
export const listOpenPurchaseOrders = (): Promise<{ no: string; vendor_no: string; vendor_name: string; amount: Cents }[]> =>
  all(`SELECT ph.no, v.no AS vendor_no, v.name AS vendor_name, ph.amount FROM purchase_header ph JOIN vendor v ON v.id = ph.vendor_id
       WHERE ph.document_type = 'Order' AND ph.status = 'Open' ORDER BY ph.no DESC`);
