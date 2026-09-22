import { notFound } from 'next/navigation';
import { requireAction, requireAnyAction } from '@/lib/session';
import { assertCanViewEmployeeDocument } from '@/lib/selfService';
import { buildPayslipDocument, buildP9Document } from '@/lib/payrollPrint';
import { buildPayrollReportPrint, parseReportFilters, PAYROLL_REPORT_KEYS, type PayrollReportKey } from '@/lib/payrollReports';
import { renderDocument, renderDocuments } from '@/lib/documentPrint';
import { buildSalesDocumentPrint, buildPostedSalesDocumentPrint } from '@/lib/salesDocumentPrint';
import { buildPurchaseDocumentPrint, buildPostedPurchaseDocumentPrint } from '@/lib/purchaseDocumentPrint';
import { buildPaymentVoucherDocument } from '@/lib/paymentVoucherSlip';
import { buildReceiptDocument } from '@/lib/receiptSlip';
import { buildImprestRequestPrint, buildImprestSurrenderPrint, buildPettyCashPrint, buildStaffClaimPrint } from '@/lib/imprestPrint';
import { buildStoreRequisitionPrint, buildPurchaseRequisitionPrint } from '@/lib/requisitionPrint';
import { buildFeeStatementPrint, buildReportCardPrint } from '@/lib/schoolPrint';
import { requirePortalStudent } from '@/lib/portal';
import { currentCanAction } from '@/lib/session';
import { Printable } from '@/components/ui/printable';
import type { PrintDocument } from '@/lib/documentPrint';
import type { ActionKey } from '@/lib/permissions';
import type { SessionUser } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Every printable business document, behind one route.
 *
 * The AL application has a separate report object per document (Rep52204455 "Sales Invoice",
 * Rep52204456 "Purchase Receipt (GRN)", Rep52203568 "Payment Voucher" …). Here they are all the
 * same pipeline — build a PrintDocument, render it through the shared chrome — so the only thing
 * that varies per kind is which builder runs and which permission opens it.
 */
const KINDS: Record<string, {
  action: ActionKey;
  /** Extra actions that also open the kind — the self-service ones, checked with ownership below. */
  selfAction?: ActionKey;
  /** For a self-service kind: which employee the document belongs to, from its `no`. */
  ownerOf?: (no: string) => number;
  /** For a Student / Parent portal kind: which student the document is about — the portal login must own them. */
  studentOf?: (no: string) => number;
  /** A single sheet, or a batch — a payroll report prints one sheet per employee off one URL. */
  build: (no: string, query: Record<string, string | string[] | undefined>) => Promise<PrintDocument | PrintDocument[] | null>;
}> = {
  sales: { action: 'RECEIVABLES_READ', build: buildSalesDocumentPrint },
  'posted-sales': { action: 'RECEIVABLES_READ', build: buildPostedSalesDocumentPrint },
  purchase: { action: 'PAYABLES_READ', build: buildPurchaseDocumentPrint },
  'posted-purchase': { action: 'PAYABLES_READ', build: buildPostedPurchaseDocumentPrint },
  'payment-voucher': { action: 'CASH_MGMT_READ', build: buildPaymentVoucherDocument },
  receipt: { action: 'CASH_MGMT_READ', build: buildReceiptDocument },
  'imprest-request': { action: 'IMPREST_READ', build: buildImprestRequestPrint },
  'imprest-surrender': { action: 'IMPREST_READ', build: buildImprestSurrenderPrint },
  'petty-cash': { action: 'IMPREST_READ', build: buildPettyCashPrint },
  'staff-claim': { action: 'IMPREST_READ', build: buildStaffClaimPrint },
  'store-requisition': { action: 'REQUISITIONS_READ', build: buildStoreRequisitionPrint },
  'purchase-requisition': { action: 'REQUISITIONS_READ', build: buildPurchaseRequisitionPrint },
  // Payroll documents are addressed by employee: "<employeeId>-<periodId>" for a payslip,
  // "<employeeId>-<year>" for the P9 tax deduction card. Payroll staff print anyone's; an
  // employee prints their own under Self Service.
  payslip: {
    action: 'PAYROLL_READ', selfAction: 'SELF_SERVICE_PAYSLIP_READ', ownerOf: (no) => Number(no.split('-')[0]),
    build: (no) => { const [emp, period] = no.split('-'); return buildPayslipDocument(Number(period), Number(emp)); },
  },
  p9: {
    action: 'PAYROLL_READ', selfAction: 'SELF_SERVICE_P9_READ', ownerOf: (no) => Number(no.split('-')[0]),
    build: (no) => { const [emp, year] = no.split('-'); return buildP9Document(Number(emp), year); },
  },
  // School documents — the office prints anyone's; a parent or student prints their own from the portal.
  'fee-statement': { action: 'FEES_READ', selfAction: 'STUDENT_PORTAL_VIEW', studentOf: (no) => Number(no), build: buildFeeStatementPrint },
  'report-card': { action: 'REPORT_CARDS_READ', selfAction: 'STUDENT_PORTAL_VIEW', studentOf: (no) => Number(no.split('-')[0]), build: buildReportCardPrint },
  // Payroll period reports (the AL report set): "<periodId>-<report key>".
  'payroll-report': {
    action: 'PAYROLL_PERIODS_READ',
    build: (no, query) => {
      const dash = no.indexOf('-');
      const key = no.slice(dash + 1) as PayrollReportKey;
      if (dash < 0 || !PAYROLL_REPORT_KEYS.includes(key)) return Promise.resolve(null);
      return buildPayrollReportPrint(Number(no.slice(0, dash)), key, parseReportFilters(query));
    },
  },
};

export default async function PrintDocumentPage({ params, searchParams }: { params: Promise<{ kind: string; no: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { kind, no } = await params;
  const query = await searchParams;
  const entry = KINDS[kind];
  if (!entry) notFound();
  const decoded = decodeURIComponent(no);
  let portalOnly = false;
  if (entry.selfAction && entry.studentOf) {
    const user: SessionUser = await requireAnyAction(entry.action, entry.selfAction);
    if (!(await currentCanAction(entry.action))) { await requirePortalStudent(user, entry.studentOf(decoded)); portalOnly = true; }
  } else if (entry.selfAction && entry.ownerOf) {
    const user: SessionUser = await requireAnyAction(entry.action, entry.selfAction);
    await assertCanViewEmployeeDocument(user, entry.action, entry.selfAction, entry.ownerOf(decoded));
  } else {
    await requireAction(entry.action);
  }
  // A portal login only ever sees what the school has published.
  const doc = await entry.build(decoded, portalOnly ? { ...query, _portal: '1' } : query);
  if (!doc || (Array.isArray(doc) && !doc.length)) notFound();
  return <Printable html={Array.isArray(doc) ? renderDocuments(doc) : renderDocument(doc)} />;
}
