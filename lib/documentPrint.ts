/*
 * Business document printing — the shared chrome behind every printable Sales, Purchase and
 * Cash Management document.
 *
 * The AL application prints these through RDLC layouts (./ssrs/SalesInvoice.rdl,
 * PurchaseReceipt.rdl, PaymentVoucher.rdl, CustomerReceipt.rdl …), and every one of those
 * layouts is built the same way: company letterhead with the logo from Company Information, a
 * document title band, the trading party, a header/meta grid, the document lines, totals, the
 * amount spelled out in words, then the approver signatures pulled from User Setup.
 *
 * This module is that layout, once, as a view-model plus renderer:
 *
 *   buildX() -> PrintDocument -> renderDocument() -> a self-contained HTML fragment
 *
 * Callers (lib/salesDocumentPrint.ts, lib/purchaseDocumentPrint.ts, lib/paymentVoucherSlip.ts,
 * lib/receiptSlip.ts) only describe WHAT is on the paper; nothing about how it looks lives in
 * them. The output carries its own <style>, uses no external assets beyond the Cloudinary logo
 * and signature images, and is sized for A4 with `@page` margins, so "Print / Save as PDF" in
 * the browser produces the same page every time.
 */
import { all, one } from './db.ts';
import { getOrg, getTheme } from './org.ts';
import { imageSrc } from './cloudinary.ts';
import { formatDate, formatDateTime, formatMoney } from './format.ts';
import { renderSignatureHtml, signaturesFor } from './userSignatures.ts';
import type { IsoDate } from './types.ts';
import type { SignatureBlock, WorkflowDocumentType } from './types.ts';

export const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The letterhead — Company Information + the society's own theme colours. */
export interface PrintBrand {
  name: string;
  logo: string | null;
  address_lines: string[];
  contact_lines: string[];
  /** Bank / paybill an invoice asks to be settled to — AL's CompanyBankName / AccountNumber. */
  pay_to: string | null;
  footer: string | null;
  currency_code: string;
  currency_symbol: string;
  primary: string;
  accent: string;
}

/** A trading party block — "Bill to", "Vendor", "Pay to", "Received from". */
export interface PrintParty {
  heading: string;
  name: string;
  lines: string[];
}

export interface PrintMeta {
  label: string;
  value: string;
  /** Renders the value in the brand colour — used for the document total on the header grid. */
  strong?: boolean;
}

export interface PrintColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** 'signature' prints the cell value as an image URL — a scanned signature where one is on
   *  file, otherwise the ruled line it replaces (the guarantor column on a loan application). */
  kind?: 'text' | 'signature';
}

export interface PrintRow {
  cells: Record<string, string>;
  /** A comment / narration line — printed lighter, spanning the whole table. */
  muted?: boolean;
  /** A carried-forward line — an opening or closing balance — printed bold on a tinted band. */
  strong?: boolean;
}

export interface PrintTotal {
  label: string;
  value: string;
  /** The grand total: reversed out in the brand colour. */
  grand?: boolean;
  /** A deduction — printed in brackets. */
  negative?: boolean;
}

export interface PrintSignature {
  /** The role: Checked by, Approved by, Authorised by, Received by … */
  label: string;
  block: SignatureBlock | null;
  /** Printed on the Name line. Falls back to the signature block's own name. */
  name?: string | null;
  /** Printed on the Date line — when this person actually acted. */
  date?: IsoDate | string | null;
}

export interface PrintNote {
  heading: string;
  body: string;
}

/**
 * "Acknowledge receipt of the payment" — a caption and the fields the recipient fills in by
 * hand. Printed under the approval table and never pre-filled: the point is the wet signature.
 */
export interface PrintAcknowledgement {
  title: string;
  /** Defaults to Name / Signature / Date. */
  fields?: string[];
}

/**
 * A further table under the main one, with its own heading — a document that states several
 * ledgers rather than one list of lines (the Member Statement's per-account and per-loan
 * activity). An invoice has no sections; it is all one table.
 */
export interface PrintSection {
  heading: string;
  sub?: string | null;
  /** Right-hand side of the section's heading bar — typically its closing balance. */
  badge?: string | null;
  columns: PrintColumn[];
  rows: PrintRow[];
  /** Shown in place of the table when the section has no rows. */
  empty?: string;
}

export interface PrintDocument {
  brand: PrintBrand;
  /** "SALES INVOICE", "PURCHASE RECEIPT (GRN)" … the title beside the letterhead. */
  title: string;
  subtitle?: string | null;
  /** Diagonal stamp across the page — "DRAFT", "PENDING APPROVAL", "COPY". */
  watermark?: string | null;
  /** A register too wide for portrait A4 — the P9 card, the banker's cheque schedule. */
  landscape?: boolean;
  /**
   * A slip-width document: the body is SLIP_WIDTH_MM wide (the Payslip.rdl body is 9.95cm on
   * A4), the letterhead and parties stack, and the sheet prints at that width on the left of
   * the page rather than filling it.
   */
  slip?: boolean;
  status?: { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' } | null;
  parties: PrintParty[];
  meta: PrintMeta[];
  columns: PrintColumn[];
  rows: PrintRow[];
  totals: PrintTotal[];
  /** Shown in place of the main table when the document has no lines. */
  empty?: string;
  /** Detail tables printed after the main one — see PrintSection. */
  sections?: PrintSection[];
  amount_words?: string | null;
  notes?: PrintNote[];
  /**
   * The approval trail, printed as the ruled "Approval Details" table — a row per role with
   * Name, Date & Time and Signature. This is for documents that people actually cleared; a
   * payslip or a loan form wants the plain strip below instead.
   */
  approvals?: PrintSignature[];
  /** The panel under the approval table where the recipient signs for what they got. */
  acknowledgement?: PrintAcknowledgement | null;
  /** Side-by-side ruled signature blocks — statements, payslips, loan agreements. */
  signatures?: PrintSignature[];
  footnote?: string | null;
  /**
   * A statutory form laid out its own way (the KRA P9 card): this HTML replaces every block
   * between the watermark and the footer, and `custom_css` is appended to the stylesheet. The
   * sheet, @page and print rules still apply.
   */
  custom_html?: string | null;
  custom_css?: string | null;
}

/**
 * The letterhead every printable document shares. Mirrors the AL reports' `CompanyInformation`
 * columns (Name, Picture, Address, Phone No., E-Mail, Home Page, Post Code), with the theme's
 * brand colours so a printed document matches the screen it was raised on.
 */
export async function printBrand(): Promise<PrintBrand | null> {
  const [org, theme] = await Promise.all([getOrg(), getTheme()]);
  if (!org) return null;
  return {
    name: org.name,
    logo: imageSrc(org.logo, { width: 320, height: 320, crop: 'fit' }),
    address_lines: [
      org.physical_address,
      [org.postal_address, org.city].filter(Boolean).join(', '),
      org.country,
    ].filter((l): l is string => !!l && !!l.trim()),
    contact_lines: [
      [org.phone_primary, org.phone_secondary].filter(Boolean).join(' / '),
      [org.email, org.website].filter(Boolean).join('   •   '),
    ].filter((l) => !!l.trim()),
    // What a payer needs to settle the invoice, in the order the AL Sales Invoice layout prints
    // it: who the account is held by, where it is, then how to reach it.
    pay_to: [
      org.bank_account_name ? `Account name: ${org.bank_account_name}` : null,
      org.bank_name ? `Bank: ${org.bank_name}` : null,
      org.bank_branch ? `Branch: ${org.bank_branch}` : null,
      org.bank_account_no ? `A/C No: ${org.bank_account_no}` : null,
      org.paybill_no ? `Paybill: ${org.paybill_no}` : null,
    ].filter(Boolean).join('\n') || null,
    footer: org.statement_footer,
    currency_code: org.currency_code,
    currency_symbol: org.currency_symbol,
    primary: theme.tokens['--brand-primary'] || '#0f7a52',
    accent: theme.tokens['--brand-accent'] || '#c9a227',
  };
}

/** What `amountInWords()` should call the currency — AL's "Amount To Words" codeunit takes the
 *  currency code and spells the name out in full. */
const CURRENCY_WORDS: Record<string, string> = {
  KES: 'Kenya Shillings', UGX: 'Uganda Shillings', TZS: 'Tanzania Shillings', RWF: 'Rwandan Francs',
  USD: 'US Dollars', EUR: 'Euro', GBP: 'Pounds Sterling',
};

export const currencyLabel = (code: string | null | undefined): string =>
  CURRENCY_WORDS[String(code ?? '').toUpperCase()] ?? String(code ?? '');

/** Money formatter for a document in `code` — the org's symbol for local currency, the ISO code
 *  itself for anything foreign, so a USD invoice never prints "KSh". */
export function documentMoney(brand: PrintBrand, code: string | null | undefined): (c: number) => string {
  const symbol = !code || code === brand.currency_code ? brand.currency_symbol : code;
  return (c: number): string => formatMoney(c, { symbol });
}

/**
 * Who signs the printout, in the three roles a SACCO document is cleared through:
 *
 *   Checked by      whoever raised the document
 *   Approved by     the second-to-last person to approve it
 *   Authorised by   the last person to approve it
 *
 * With a single approver that one person is both the approver and the authoriser, so they are
 * named on both lines — the document was genuinely cleared once, and pretending otherwise would
 * either hide who did it or invent a second signatory.
 *
 * The AL reports read this out of the Approval Entry table (Sender ID -> 1st approver, Approver
 * ID -> 2nd..4th); here the equivalent trail is workflow_task, one APPROVED row per step. A
 * signatory with nothing on file still prints the ruled line, so the paper never depends on an
 * administrator having got round to uploading a scan.
 */
export async function documentSignatories(
  documentType: WorkflowDocumentType,
  entityId: string,
  preparedBy: string | null | undefined,
  opts: {
    /**
     * When the document was raised. Falls back to the first approval request, but a document
     * below its approval limit never raised one — so the builder passes its own date and the
     * first row still carries a date rather than an empty rule.
     */
    raisedAt?: string | Date | null;
    /**
     * Who put the document through when no workflow was involved — a receipt under the approval
     * limit is posted outright. There is no approver to name, and the page still has to say who
     * is answerable, so that person signs all three rows.
     */
    clearedBy?: string | null;
  } = {},
): Promise<PrintSignature[]> {
  const decided = await all<{ decided_by: string; decided_at: string | null }>(
    `SELECT decided_by, decided_at FROM workflow_task
     WHERE document_type = ? AND entity_id = ? AND status = 'APPROVED' AND decided_by IS NOT NULL
     ORDER BY decided_at, id`,
    documentType, String(entityId),
  );
  // One line per person, in the order they cleared it — a group-sequence step can record the
  // same approver twice, and two identical signatures on one page tell the reader nothing.
  const seen = new Map<string, string | null>();
  for (const d of decided) if (!seen.has(d.decided_by)) seen.set(d.decided_by, d.decided_at);
  const approvers = [...seen.entries()].map(([username, at]) => ({ username, at }));

  const raised = await documentRaisedAt(documentType, String(entityId));
  const created = raised?.at ?? (opts.raisedAt ? String(opts.raisedAt) : null);
  // Checked by is whoever sent it for approval. On a document that never went for approval
  // that is the person who put it through instead.
  const checkedBy = raised?.by ?? opts.clearedBy ?? preparedBy;

  // Nobody approved it because nobody had to: below its limit the document posts outright, and
  // the person who posted it answers for every role rather than the page showing three blanks.
  if (!approvers.length && opts.clearedBy) {
    approvers.push({ username: opts.clearedBy, at: created });
  }

  const authoriser = approvers.length ? approvers[approvers.length - 1] : null;
  // One approver signs both lines; two or more and the roles separate.
  const approver = approvers.length > 1 ? approvers[approvers.length - 2] : authoriser;

  const blocks = await signaturesFor([checkedBy, ...approvers.map((a) => a.username)]);
  const of = (username: string | null | undefined): SignatureBlock | null =>
    blocks.get(username?.trim() ?? '') ?? null;
  const nameOf = (username: string | null | undefined): string | null =>
    (username ? of(username)?.full_name || username : null);

  return [
    { label: 'Checked by', block: of(checkedBy), name: nameOf(checkedBy), date: created },
    {
      label: 'Approved by',
      block: of(approver?.username), name: nameOf(approver?.username), date: approver?.at ?? null,
    },
    {
      label: 'Authorised by',
      block: of(authoriser?.username), name: nameOf(authoriser?.username), date: authoriser?.at ?? null,
    },
  ];
}

/**
 * When the document was raised, for the Checked by date. Read from the requesting task rather
 * than each document's own table, so one query serves every document type.
 */
async function documentRaisedAt(
  documentType: WorkflowDocumentType,
  entityId: string,
): Promise<{ by: string | null; at: string | null } | null> {
  const row = await one<{ requested_by: string | null; requested_at: string | null }>(
    `SELECT requested_by, requested_at FROM workflow_task
     WHERE document_type = ? AND entity_id = ? ORDER BY id LIMIT 1`,
    documentType, entityId,
  );
  return row ? { by: row.requested_by, at: row.requested_at } : null;
}

/* ------------------------------------------------------------------------ rendering */

const align = (c: PrintColumn): string => `ta-${c.align ?? 'left'}`;

/** The letterhead on its own — for a `custom_html` document (a letter) that lays out its own body. */
export function headerBlock(doc: PrintDocument): string {
  const b = doc.brand;
  return `
  <header class="dp-head">
    <div class="dp-brand">
      ${b.logo ? `<img class="dp-logo" src="${esc(b.logo)}" alt="" />` : ''}
      <div class="dp-brand-text">
        <div class="dp-org">${esc(b.name)}</div>
        ${b.address_lines.map((l) => `<div class="dp-line">${esc(l)}</div>`).join('')}
        ${b.contact_lines.map((l) => `<div class="dp-line">${esc(l)}</div>`).join('')}
      </div>
    </div>
    <div class="dp-ident-box">
      <div class="dp-title">${esc(doc.title)}</div>
      ${doc.subtitle ? `<div class="dp-subtitle">${esc(doc.subtitle)}</div>` : ''}
      ${doc.status ? `<div class="dp-status dp-${doc.status.tone}">${esc(doc.status.label)}</div>` : ''}
    </div>
  </header>`;
}

function metaBlock(doc: PrintDocument, wide = false): string {
  if (!doc.meta.length) return '';
  // Beside a party the meta is a two-column table; spanning the page on its own (a register's
  // filter header) that would strand labels and values at opposite edges, so it wraps into
  // label-over-value cells instead.
  if (wide) {
    return `
  <div class="dp-meta-wide">
    ${doc.meta.map((m) => `
    <div class="dp-meta-item">
      <div class="dp-meta-k">${esc(m.label)}</div>
      <div class="dp-meta-v${m.strong ? ' dp-meta-strong' : ''}">${esc(m.value)}</div>
    </div>`).join('')}
  </div>`;
  }
  return `
  <table class="dp-meta">
    <tbody>
      ${doc.meta.map((m) => `
      <tr>
        <td class="dp-meta-k">${esc(m.label)}</td>
        <td class="dp-meta-v${m.strong ? ' dp-meta-strong' : ''}">${esc(m.value)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function partiesBlock(doc: PrintDocument): string {
  const parties = doc.parties.map((p) => `
    <div class="dp-party">
      <div class="dp-party-h">${esc(p.heading)}</div>
      <div class="dp-party-n">${esc(p.name)}</div>
      ${p.lines.filter(Boolean).map((l) => `<div class="dp-line">${esc(l)}</div>`).join('')}
    </div>`).join('');
  // With no trading party — a register or a schedule — the meta grid takes the full width
  // instead of sitting in a narrow column beside nothing.
  const meta = doc.meta.length
    ? `<div class="dp-party dp-party-meta${doc.parties.length ? '' : ' dp-meta-only'}">${metaBlock(doc, !doc.parties.length)}</div>`
    : '';
  if (!parties && !meta) return '';
  return `<section class="dp-parties">${parties}${meta}</section>`;
}

/** One line table — the document's own lines, or a section's. */
function tableHtml(columns: PrintColumn[], rows: PrintRow[], empty: string): string {
  const head = columns
    .map((c) => `<th class="${align(c)}"${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`)
    .join('');
  const noteKey = columns[1]?.key ?? columns[0].key;
  const body = rows.length
    ? rows.map((r) => {
      if (r.muted) {
        return `<tr class="dp-note-row"><td colspan="${columns.length}">${esc(r.cells[noteKey] ?? '')}</td></tr>`;
      }
      const cells = columns.map((c) => {
        const value = r.cells[c.key] ?? '';
        const body = c.kind === 'signature'
          ? (value ? `<img class="dp-cell-sig" src="${esc(value)}" alt="" />` : '<div class="dp-cell-rule"></div>')
          : esc(value);
        return `<td class="${align(c)}">${body}</td>`;
      }).join('');
      return `<tr class="${r.strong ? 'dp-strong-row' : ''}">${cells}</tr>`;
    }).join('')
    : `<tr><td class="dp-empty" colspan="${columns.length}">${esc(empty)}</td></tr>`;
  return `
  <table class="dp-lines">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function linesBlock(doc: PrintDocument): string {
  if (!doc.columns.length) return '';
  return tableHtml(doc.columns, doc.rows, doc.empty ?? 'No lines on this document.');
}

function sectionsBlock(doc: PrintDocument): string {
  const sections = doc.sections ?? [];
  if (!sections.length) return '';
  return sections.map((s) => `
  <section class="dp-sec">
    <div class="dp-sec-h">
      <div>
        <div class="dp-sec-t">${esc(s.heading)}</div>
        ${s.sub ? `<div class="dp-sec-s">${esc(s.sub)}</div>` : ''}
      </div>
      ${s.badge ? `<div class="dp-sec-b">${esc(s.badge)}</div>` : ''}
    </div>
    ${tableHtml(s.columns, s.rows, s.empty ?? 'No activity in the selected period.')}
  </section>`).join('');
}

function totalsBlock(doc: PrintDocument): string {
  const totals = doc.totals.length ? `
    <table class="dp-totals">
      <tbody>
        ${doc.totals.map((t) => `
        <tr class="${t.grand ? 'dp-grand' : ''}">
          <td class="dp-t-k">${esc(t.label)}</td>
          <td class="dp-t-v">${t.negative ? `(${esc(t.value)})` : esc(t.value)}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '';
  const words = doc.amount_words ? `
    <div class="dp-words">
      <div class="dp-words-h">Amount in words</div>
      <div class="dp-words-b">${esc(doc.amount_words)}</div>
    </div>` : '';
  if (!totals && !words) return '';
  return `<section class="dp-foot-grid">${words || '<div></div>'}${totals}</section>`;
}

function notesBlock(doc: PrintDocument): string {
  const notes = (doc.notes ?? []).filter((n) => n.body && n.body.trim());
  if (!notes.length) return '';
  return `
  <section class="dp-notes">
    ${notes.map((n) => `
    <div class="dp-note">
      <div class="dp-note-h">${esc(n.heading)}</div>
      <div class="dp-note-b">${esc(n.body)}</div>
    </div>`).join('')}
  </section>`;
}

/**
 * Approval Details — a ruled table, a row per role, carrying the three things a cleared document
 * has to show: who, when, and their mark. A role nobody has filled yet still prints its row with
 * a rule to sign on, so the page works on paper too.
 *
 * A table rather than side-by-side blocks because the roles are a sequence, not a set: read down
 * the column and the order the document travelled in is plain, and every name lines up under one
 * heading instead of each block setting its own width.
 */
function approvalBlock(doc: PrintDocument): string {
  const rows = doc.approvals ?? [];
  const ack = doc.acknowledgement;
  if (!rows.length && !ack) return '';

  const rule = '<span class="dp-appr-blank"></span>';
  const table = rows.length ? `
    <table class="dp-appr-table">
      <thead>
        <tr>
          <th class="dp-appr-role"></th><th>Name</th><th>Date &amp; Time</th><th>Signature</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((sig) => {
    const name = sig.name ?? sig.block?.full_name ?? sig.block?.username ?? '';
    const when = sig.date ? formatDateTime(String(sig.date)) : '';
    const mark = sig.block?.src
      ? `<img class="dp-appr-sig" src="${esc(sig.block.src)}" alt="" />`
      : rule;
    return `<tr>
          <th class="dp-appr-role">${esc(sig.label)}</th>
          <td class="dp-appr-name">${name ? esc(name) : rule}</td>
          <td class="dp-appr-when">${when ? esc(when) : rule}</td>
          <td class="dp-appr-mark">${mark}</td>
        </tr>`;
  }).join('')}
      </tbody>
    </table>` : '';

  const fields = ack?.fields ?? ['Name', 'Signature', 'Date'];
  const ackBlock = ack ? `
    <div class="dp-ack">
      <div class="dp-ack-t">${esc(ack.title)}</div>
      <div class="dp-ack-fields">${fields.map((f) => `<span class="dp-ack-field">`
    + `<span class="dp-ack-cap">${esc(f)}</span><span class="dp-ack-rule"></span></span>`).join('')}</div>
    </div>` : '';

  return `<section class="dp-appr">
    <div class="dp-appr-h"><span class="dp-appr-t">Approval Details</span></div>
    <div class="dp-appr-card">${table}${ackBlock}</div>
  </section>`;
}

/**
 * The plain signature strip — a column per signatory, for documents that get signed rather than
 * approved: a payslip, a member statement, a loan agreement.
 */
function signBlock(doc: PrintDocument): string {
  const sigs = doc.signatures ?? [];
  if (!sigs.length) return '';
  const field = (caption: string, value: string): string =>
    `<div class="dp-sig-field"><span class="dp-sig-cap">${caption}</span>`
    + `<span class="dp-sig-val">${value}</span></div>`;
  return `<section class="dp-sign">${sigs.map((sig) => {
    const name = sig.name ?? sig.block?.full_name ?? sig.block?.username ?? '';
    const mark = sig.block?.src
      ? `<img class="dp-sig-img" src="${esc(sig.block.src)}" alt="" />`
      : '';
    return `
    <div class="dp-sig-block">
      <div class="dp-sig-role">${esc(sig.label)}</div>
      ${field('Name', esc(name))}
      ${field('Date', esc(sig.date ? formatDate(String(sig.date).slice(0, 10)) : ''))}
      ${field('Signature', mark)}
    </div>`;
  }).join('')}</section>`;
}

/** The document body itself, without the stylesheet — see renderDocuments(). */
function documentBody(doc: PrintDocument): string {
  const b = doc.brand;
  return `
<div class="dp${doc.slip ? ' dp-slip' : ''}">
  ${doc.watermark ? `<div class="dp-watermark">${esc(doc.watermark)}</div>` : ''}
  ${doc.custom_html ?? `
  ${headerBlock(doc)}
  <div class="dp-rule"></div>
  <div class="dp-rule-2"></div>
  ${partiesBlock(doc)}
  ${linesBlock(doc)}
  ${totalsBlock(doc)}
  ${sectionsBlock(doc)}
  ${notesBlock(doc)}
  ${approvalBlock(doc)}
  ${signBlock(doc)}`}
  <footer class="dp-footer">
    <div>${esc(doc.footnote || b.footer || 'This is a computer-generated document.')}</div>
    <div>Printed ${esc(formatDateTime(new Date().toISOString()))}</div>
  </footer>
</div>`;
}

/**
 * Several documents as one printout — a batch of statements, one member per sheet. The
 * stylesheet is emitted once, since every document in a batch shares the same brand colours.
 */
export function renderDocuments(docs: PrintDocument[]): string {
  if (!docs.length) return '';
  return documentStyles(docs[0]) + docs.map(documentBody).join('\n');
}

/** One document — inline styles only, its own `@page` / `@media print` rules. */
export function renderDocument(doc: PrintDocument): string {
  return documentStyles(doc) + documentBody(doc);
}

/** Width of a slip-sized document body — Payslip.rdl's 9.95cm, rounded to whole millimetres. */
export const SLIP_WIDTH_MM = 100;

function documentStyles(doc: PrintDocument): string {
  const b = doc.brand;
  return `
<style>
  @page { size: A4${doc.landscape ? ' landscape' : ''}; margin: 12mm 12mm 14mm; }
  .dp {
    --dp-primary: ${esc(b.primary)};
    --dp-accent: ${esc(b.accent)};
    --dp-ink: #16211d;
    --dp-muted: #667077;
    --dp-rule: #dfe4e2;
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    color: var(--dp-ink);
    /* On screen the document is a sheet of paper on the app's own background — which may be
       dark — so it paints its own white ground rather than inheriting one. */
    background: #fff;
    max-width: ${doc.landscape ? '301mm' : '214mm'}; margin: 0 auto; padding: 12mm 12mm 8mm;
    border-radius: 2px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .12), 0 10px 30px rgba(0, 0, 0, .09);
    font-size: 11.5px; line-height: 1.45; position: relative; overflow: hidden;
  }
  .dp * { box-sizing: border-box; }

  /* ------------------------------------------------------------------ slip width */
  .dp.dp-slip { max-width: ${SLIP_WIDTH_MM}mm; padding: 7mm 6mm 5mm; font-size: 10px; line-height: 1.4; }
  .dp-slip .dp-head { flex-direction: column; gap: 8px; }
  .dp-slip .dp-logo { width: 44px; height: 44px; }
  .dp-slip .dp-org { font-size: 14px; }
  .dp-slip .dp-line { font-size: 9px; }
  .dp-slip .dp-ident-box { text-align: left; display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }
  .dp-slip .dp-title { font-size: 13px; letter-spacing: .1em; }
  .dp-slip .dp-subtitle { margin-top: 0; }
  .dp-slip .dp-status { margin-top: 0; font-size: 8.5px; padding: 1px 8px; }
  .dp-slip .dp-rule { margin-top: 6px; height: 2px; }
  .dp-slip .dp-rule-2 { margin-bottom: 8px; }
  .dp-slip .dp-parties { flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .dp-slip .dp-party { padding: 6px 8px; }
  .dp-slip .dp-party-n { font-size: 11.5px; }
  .dp-slip .dp-party-meta { flex: 1 1 100%; padding: 6px 8px; }
  .dp-slip .dp-meta-wide { gap: 4px 14px; }
  .dp-slip .dp-meta-item { min-width: 90px; }
  .dp-slip .dp-meta-item .dp-meta-v { font-size: 10.5px; }
  .dp-slip .dp-foot-grid { flex-direction: column; gap: 8px; }
  .dp-slip .dp-sign { gap: 10px; margin-top: 16px; }
  .dp-slip .dp-footer { flex-direction: column; gap: 2px; }

  /* ---------------------------------------------------------------- letterhead */
  .dp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .dp-brand { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
  .dp-logo { width: 66px; height: 66px; object-fit: contain; flex: none; }
  .dp-org { font-size: 19px; font-weight: 700; letter-spacing: .01em; color: var(--dp-primary);
    line-height: 1.2; margin-bottom: 3px; text-transform: uppercase; }
  .dp-line { font-size: 10.5px; color: var(--dp-muted); }

  .dp-ident-box { text-align: right; flex: none; }
  .dp-title { font-size: 17px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    color: var(--dp-ink); white-space: nowrap; }
  .dp-subtitle { font-size: 10px; color: var(--dp-muted); letter-spacing: .06em;
    text-transform: uppercase; margin-top: 2px; }
  .dp-status { display: inline-block; margin-top: 6px; padding: 2px 10px; border-radius: 999px;
    font-size: 9.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    border: 1px solid currentColor; }
  .dp-ok { color: #0f7a52; } .dp-warn { color: #b96b00; }
  .dp-bad { color: #c0392b; } .dp-info { color: #1d6fb8; }

  .dp-rule { height: 3px; margin-top: 9px; background: var(--dp-primary); }
  .dp-rule-2 { height: 1px; margin-bottom: 12px; background: var(--dp-accent); }

  /* ------------------------------------------------------------- parties / meta */
  .dp-parties { display: flex; gap: 12px; align-items: stretch; margin-bottom: 12px; }
  .dp-party { flex: 1 1 0; min-width: 0; padding: 8px 10px; border: 1px solid var(--dp-rule);
    border-radius: 4px; background: #fbfcfc; }
  .dp-party-h { font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--dp-primary); margin-bottom: 3px; }
  .dp-party-n { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
  .dp-party-meta { flex: 0 0 44%; padding: 4px 10px; background: #fff; }
  .dp-party-meta.dp-meta-only { flex: 1 1 100%; padding: 8px 10px; }
  .dp-meta-wide { display: flex; flex-wrap: wrap; gap: 6px 28px; }
  .dp-meta-item { min-width: 130px; }
  .dp-meta-item .dp-meta-k { font-size: 9px; font-weight: 700; letter-spacing: .09em;
    text-transform: uppercase; }
  .dp-meta-item .dp-meta-v { text-align: left; font-size: 12px; }
  .dp-cell-sig { display: block; max-width: 130px; max-height: 34px; object-fit: contain; }
  .dp-cell-rule { height: 26px; border-bottom: 1px solid #8b9490; min-width: 90px; }

  .dp-meta { width: 100%; border-collapse: collapse; }
  .dp-meta td { padding: 2.5px 0; font-size: 10.5px; vertical-align: top; }
  .dp-meta-k { color: var(--dp-muted); white-space: nowrap; padding-right: 10px; }
  .dp-meta-v { text-align: right; font-weight: 600; }
  .dp-meta-strong { color: var(--dp-primary); font-size: 12px; }

  /* --------------------------------------------------------------------- lines */
  .dp-lines { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .dp-lines thead th { background: var(--dp-primary); color: #fff; font-size: 9.5px; font-weight: 700;
    letter-spacing: .07em; text-transform: uppercase; padding: 7px 8px; text-align: left;
    white-space: nowrap; }
  .dp-lines thead th.ta-right { text-align: right; }
  .dp-lines thead th.ta-center { text-align: center; }
  /* pre-line so a builder can stack two figures in one cell (the voucher's VAT / WHT column)
     with a newline, while ordinary text still wraps on its own. */
  .dp-lines tbody td { padding: 6px 8px; border-bottom: 1px solid var(--dp-rule); font-size: 11px;
    vertical-align: top; white-space: pre-line; }
  .dp-lines tbody tr:nth-child(even) td { background: #f7f9f8; }
  .dp-lines .ta-right { text-align: right; } .dp-lines .ta-center { text-align: center; }
  .dp-note-row td { color: var(--dp-muted); font-style: italic; }
  .dp-lines tbody tr.dp-strong-row td { font-weight: 700; background: #eef4f1;
    border-bottom: 1px solid #c9d6d0; }
  .dp-empty { text-align: center; color: var(--dp-muted); padding: 16px 8px; }

  /* ------------------------------------------------------------------ sections */
  .dp-sec { margin-top: 14px; page-break-inside: auto; }
  .dp-sec-h { display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    border-left: 3px solid var(--dp-accent); padding: 4px 10px; background: #f5f7f6;
    margin-bottom: 6px; }
  .dp-sec-t { font-size: 12.5px; font-weight: 700; }
  .dp-sec-s { font-size: 9.5px; color: var(--dp-muted); letter-spacing: .04em;
    text-transform: uppercase; }
  .dp-sec-b { font-size: 12.5px; font-weight: 700; color: var(--dp-primary); white-space: nowrap; }

  /* ------------------------------------------------------------ totals / words */
  .dp-foot-grid { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; }
  .dp-words { flex: 1 1 auto; padding: 8px 10px; border-left: 3px solid var(--dp-accent);
    background: #fbfaf5; align-self: stretch; display: flex; flex-direction: column;
    justify-content: center; }
  .dp-words-h { font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--dp-muted); }
  .dp-words-b { font-size: 11.5px; font-style: italic; font-weight: 600; margin-top: 2px; }
  .dp-totals { flex: 0 0 46%; border-collapse: collapse; }
  .dp-totals td { padding: 4px 8px; font-size: 11.5px; border-bottom: 1px solid var(--dp-rule); }
  .dp-t-k { color: var(--dp-muted); }
  .dp-t-v { text-align: right; font-weight: 600; white-space: nowrap; }
  .dp-totals tr.dp-grand td { background: var(--dp-primary); color: #fff; font-weight: 700;
    font-size: 13px; border-bottom: none; padding: 7px 8px; }
  .dp-totals tr.dp-grand .dp-t-k { color: #fff; letter-spacing: .05em; text-transform: uppercase;
    font-size: 10px; }

  /* --------------------------------------------------------------------- notes */
  .dp-notes { margin-top: 12px; display: flex; gap: 12px; }
  .dp-note { flex: 1 1 0; padding: 7px 10px; border: 1px dashed var(--dp-rule); border-radius: 4px; }
  .dp-note-h { font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--dp-muted); margin-bottom: 2px; }
  .dp-note-b { font-size: 10.5px; white-space: pre-wrap; }

  /* ---------------------------------------------------------------- signatures */
  /* ------------------------------------------------------------ approval details */
  .dp-appr { margin-top: 20px; page-break-inside: avoid; }
  .dp-appr-h { display: flex; align-items: center; gap: 9px; padding-bottom: 6px; }
  .dp-appr-h::after { content: ""; flex: 1; height: 1px; background: var(--dp-rule); }
  .dp-appr-t { font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
    color: var(--dp-primary); white-space: nowrap; }
  .dp-appr-card { border: 1px solid var(--dp-rule); border-radius: 5px; overflow: hidden; }
  .dp-appr-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .dp-appr-table thead th { background: var(--dp-primary); color: #fff; font-size: 9px;
    font-weight: 700; letter-spacing: .07em; text-transform: uppercase; text-align: left;
    padding: 6px 10px; white-space: nowrap; }
  .dp-appr-table tbody th, .dp-appr-table tbody td { padding: 7px 10px; text-align: left;
    vertical-align: middle; border-bottom: 1px solid var(--dp-rule); }
  .dp-appr-table tbody tr:last-child th, .dp-appr-table tbody tr:last-child td {
    border-bottom: 0; }
  /* Tall enough that a row nobody has signed yet has somewhere to put a pen. */
  .dp-appr-table tbody tr { height: 34px; }
  .dp-appr-table .dp-appr-role { width: 22%; background: #f5f7f6; color: var(--dp-primary);
    font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    border-right: 1px solid var(--dp-rule); }
  .dp-appr-name { font-weight: 600; }
  .dp-appr-when { color: var(--dp-muted); white-space: nowrap; }
  .dp-appr-table .dp-appr-mark { width: 25%; }
  .dp-appr-sig { display: block; max-width: 140px; max-height: 28px; }
  /* An unfilled cell prints the rule to write on instead of reading as a mistake. */
  .dp-appr-blank { display: block; height: 13px; max-width: 150px;
    border-bottom: 1px dotted #8b9490; }
  .dp-ack { border-top: 1px solid var(--dp-rule); background: #fbfaf5; padding: 8px 10px 10px; }
  .dp-ack-t { font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--dp-muted); padding-bottom: 9px; }
  .dp-ack-fields { display: flex; gap: 16px; }
  .dp-ack-field { flex: 1; display: flex; align-items: flex-end; gap: 6px; font-size: 10px; }
  .dp-ack-cap { white-space: nowrap; color: var(--dp-muted); }
  .dp-ack-rule { flex: 1; height: 14px; border-bottom: 1px dotted #8b9490; }

  .dp-sign { display: flex; justify-content: space-between; gap: 18px; margin-top: 26px;
    page-break-inside: avoid; }
  .dp-sig-block { flex: 1; min-width: 150px; }
  .dp-sig-role { font-size: 9.5px; font-weight: 700; color: var(--dp-ink); letter-spacing: .05em;
    text-transform: uppercase; padding-bottom: 5px; }
  /* Caption then a ruled space: filled in on screen, writable on paper when it is not. */
  .dp-sig-field { display: flex; align-items: flex-end; gap: 5px; margin-top: 5px; font-size: 9.5px; }
  .dp-sig-cap { color: var(--dp-muted); white-space: nowrap; }
  .dp-sig-val { flex: 1; min-height: 13px; border-bottom: 1px solid #8b9490; color: var(--dp-ink);
    line-height: 1.25; word-break: break-word; }
  .dp-sig-field:last-child .dp-sig-val { min-height: 30px; }
  .dp-sig-img { display: block; max-width: 150px; max-height: 28px; }
  /* The old single-rule block, still used by the standalone slips. */
  .dp .sig-block { flex: 1; min-width: 130px; }
  .dp .sig-block .sig-img { display: block; max-width: 170px; max-height: 48px; margin-bottom: 2px; }
  .dp .sig-block .sig-rule { height: 44px; border-bottom: 1px solid #8b9490; margin-bottom: 2px; }
  .dp .sig-block .sig-label { font-size: 9.5px; color: var(--dp-muted); padding-top: 3px;
    letter-spacing: .04em; text-transform: uppercase; }

  /* ------------------------------------------------------------------- footers */
  .dp-footer { margin-top: 18px; padding-top: 7px; border-top: 1px solid var(--dp-rule);
    display: flex; justify-content: space-between; gap: 12px; font-size: 9px; color: var(--dp-muted); }
  /* Centred on the sheet rather than the viewport, so the stamp lands the same way on screen
     and on paper however long the document runs. */
  .dp-watermark { position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; font-size: 48px; font-weight: 800; letter-spacing: .12em;
    color: rgba(20,40,32,.07); transform: rotate(-24deg); pointer-events: none; z-index: 0;
    text-transform: uppercase; white-space: nowrap; }
  .dp > *:not(.dp-watermark) { position: relative; z-index: 1; }
  /* A batch printout (renderDocuments) — one document per sheet. */
  .dp + .dp { margin-top: 20px; }

  @media print {
    .dp + .dp { break-before: page; page-break-before: always; margin-top: 0; }
    .no-print { display: none !important; }
    body { margin: 0; background: #fff; }
    /* The @page margin above is the paper's margin — the sheet drops its screen padding. The
       screen-only overflow clip has to go too: a clipped box that spans pages loses the pages
       after the first. */
    /* components/ui/print-sheets.tsx scales the sheet to the screen; paper gets it full size. */
    .dp { max-width: none; width: auto !important; zoom: 1 !important; font-size: 11px; padding: 0; box-shadow: none; border-radius: 0;
      overflow: visible; }
    /* A slip keeps its width on paper and sits at the left margin, as the RDL lays it out. */
    .dp.dp-slip { max-width: ${SLIP_WIDTH_MM}mm; margin: 0; font-size: 10px; }
    .dp-lines thead { display: table-header-group; }
    .dp-lines tr, .dp-party, .dp-foot-grid { page-break-inside: avoid; }
    .dp-sec-h { page-break-after: avoid; break-after: avoid; }
    .dp-lines thead th, .dp-totals tr.dp-grand td, .dp-lines tbody tr:nth-child(even) td,
    .dp-lines tbody tr.dp-strong-row td, .dp-sec-h,
    .dp-appr-table thead th, .dp-appr-table .dp-appr-role, .dp-ack {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
  }
  ${doc.custom_css ?? ''}
</style>`;
}
