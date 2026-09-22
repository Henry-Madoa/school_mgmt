/*
 * Payroll printouts — the employee Payslip and the annual P9 tax-deduction card, rendered
 * through the shared document chrome in lib/documentPrint.ts.
 *
 * Both delegate every figure to lib/payroll.ts (getPayslip / getP9Annual), which the payroll
 * period reports read too, so the payslip, the P9 and the period report can never disagree.
 */
import { getPayslip, getP9Annual, type P9AnnualRow } from './payroll.ts';
import { formatDate, formatMoney } from './format.ts';
import { amountInWords } from './numberToWords.ts';
import { printBrand, documentMoney, currencyLabel, renderDocument, esc } from './documentPrint.ts';
import type { PrintDocument, PrintColumn, PrintRow, PrintSection } from './documentPrint.ts';
import type { Cents } from './types.ts';
import { getOrg } from './org.ts';
import { getPayrollSetup } from './payrollSetup.ts';

export { renderDocument };

const bare = (c: Cents): string => formatMoney(c, { showSymbol: false });

/** The payslip's sections, in the order a payslip reads: what was earned, then what was taken. */
const SECTION_LABELS: Record<string, string> = {
  'BASIC SALARY': 'Basic Pay',
  'ALLOWANCE': 'Allowances',
  'GROSS PAY': 'Gross Pay',
  'TAX CALCULATIONS': 'Tax Workings',
  'STATUTORIES': 'Statutory Deductions',
  'DEDUCTIONS': 'Other Deductions',
  'EMPLOYER': 'Employer Contributions',
  'NET PAY': 'Net Pay',
};
const SECTION_ORDER = ['BASIC SALARY', 'ALLOWANCE', 'GROSS PAY', 'TAX CALCULATIONS', 'STATUTORIES', 'DEDUCTIONS', 'EMPLOYER', 'NET PAY'];

const LINE_COLUMNS: PrintColumn[] = [
  { key: 'code', label: 'Code', width: '18%' },
  { key: 'name', label: 'Description' },
  { key: 'amount', label: 'Amount', align: 'right', width: '25%' },
];

/* ------------------------------------------------------------------------- Payslip */

export async function buildPayslipDocument(periodId: number, employeeId: number): Promise<PrintDocument | null> {
  const [brand, slip] = await Promise.all([printBrand(), getPayslip(periodId, employeeId)]);
  if (!brand) return null;
  const money = documentMoney(brand, brand.currency_code);
  const { employee, period, lines, p9 } = slip;

  // Employer-side lines are a debit and a credit each — the payslip shows the cost once.
  const bySection = new Map<string, typeof lines>();
  for (const l of lines.filter((x) => x.section !== 'EMPLOYER' || x.isDebit)) {
    if (!bySection.has(l.section)) bySection.set(l.section, []);
    bySection.get(l.section)!.push(l);
  }

  // The summary the payslip leads with is the P9 line for the period; the per-code detail
  // follows underneath, one section per pay element group.
  const sections: PrintSection[] = SECTION_ORDER.filter((s) => bySection.has(s)).map((section) => {
    const rows = bySection.get(section)!;
    return {
      heading: SECTION_LABELS[section] || section,
      badge: money(rows.reduce((s, l) => s + l.amountCents, 0)),
      columns: LINE_COLUMNS,
      rows: rows.map((l): PrintRow => ({
        cells: { code: l.code, name: l.name, amount: bare(l.amountCents) },
      })),
    };
  });

  return {
    brand,
    title: 'Payslip',
    subtitle: period.period_name,
    // Payslip.rdl renders a 9.95cm-wide body on A4 — the slip, not the whole page.
    slip: true,
    status: {
      label: period.status,
      tone: period.status === 'CLOSED' || period.status === 'APPROVED' ? 'ok' : 'info',
    },
    parties: [{
      heading: 'Employee',
      name: `${employee.first_name} ${employee.last_name}`,
      lines: [
        `Employee No. ${employee.employee_no}`,
        employee.job_title || '',
      ].filter(Boolean),
    }],
    meta: [
      { label: 'Pay Period', value: period.period_name },
      { label: 'Period Start', value: formatDate(period.start_date) },
      { label: 'Period End', value: formatDate(period.end_date) },
      ...(p9 ? [{ label: 'Gross Pay', value: money(p9.gross_pay_cents) }] : []),
      ...(p9 ? [{ label: 'Net Pay', value: money(p9.net_pay_cents), strong: true }] : []),
    ],
    columns: [
      { key: 'item', label: 'Summary' },
      { key: 'amount', label: 'Amount', align: 'right', width: '28%' },
    ],
    empty: 'This employee was not processed in the selected period.',
    rows: p9
      ? [
        { cells: { item: 'Gross pay', amount: money(p9.gross_pay_cents) } },
        { cells: { item: 'Taxable pay', amount: money(p9.taxable_pay_cents) } },
        { cells: { item: 'PAYE', amount: money(p9.paye_cents) } },
        { cells: { item: 'NSSF', amount: money(p9.nssf_cents) } },
        { cells: { item: 'SHIF', amount: money(p9.shif_cents) } },
        { cells: { item: 'Housing Levy', amount: money(p9.housing_levy_cents) } },
        { cells: { item: 'Other deductions', amount: money(p9.deductions_cents) } },
      ]
      : [],
    totals: p9
      ? [
        { label: 'Gross pay', value: money(p9.gross_pay_cents) },
        {
          label: 'Less: total deductions',
          value: money(p9.gross_pay_cents - p9.net_pay_cents),
          negative: true,
        },
        { label: `Net pay (${brand.currency_code})`, value: money(p9.net_pay_cents), grand: true },
      ]
      : [],
    amount_words: p9 ? amountInWords(p9.net_pay_cents, currencyLabel(brand.currency_code)) : null,
    sections,
    signatures: [
      { label: 'Prepared by', block: null },
      { label: 'Employee', block: null },
    ],
    footnote: brand.footer || 'This payslip is computer-generated and does not require a signature.',
  };
}

/* ----------------------------------------------------------------------------- P9 */

/**
 * The KRA P9 Tax Deduction Card, laid out as the revised form (Tax Laws (Amendment) Act 2024):
 * the lettered columns A–O with the three-way defined-contribution test under E, the employer /
 * employee identification block above, and the "to be completed by the employer at the end of
 * the year" strip with the form's notes beneath. Confirmed against the Sacco ERP P9 Report.rdl
 * (which carries the older H–L lettering) — the figures come from the same P9 line the run writes.
 */
const P9_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The card's Month column — from the period's start date, however the period was named. */
const p9Month = (r: P9AnnualRow): string => P9_MONTHS[r.monthNo - 1] ?? r.periodName;

/** The card's lettered columns in order, each reading one field of a P9 row. */
const P9_COLS: { key: keyof P9AnnualRow; letter: string; label: string; sub?: string }[] = [
  { key: 'basicCents', letter: 'A', label: 'Basic Salary' },
  { key: 'benefitsCents', letter: 'B', label: 'Benefits Non-Cash' },
  { key: 'quartersCents', letter: 'C', label: 'Value of Quarters' },
  { key: 'grossCents', letter: 'D', label: 'Total Gross Pay' },
  { key: 'e1Cents', letter: 'E1', label: '30% of A', sub: 'E' },
  { key: 'e2Cents', letter: 'E2', label: 'Actual', sub: 'E' },
  { key: 'e3Cents', letter: 'E3', label: 'Fixed', sub: 'E' },
  { key: 'ownerOccupierInterestCents', letter: 'F', label: 'Owner Occupied Interest' },
  { key: 'retirementAndInterestCents', letter: 'G', label: 'Retirement Contribution & Owner Occupied Interest' },
  { key: 'housingLevyCents', letter: 'H', label: 'Affordable Housing Levy' },
  { key: 'shifCents', letter: 'I', label: 'SHIF Contribution' },
  { key: 'prmfCents', letter: 'J', label: 'Post-Retirement Medical Fund' },
  { key: 'taxableCents', letter: 'K', label: 'Chargeable Pay' },
  { key: 'taxChargedCents', letter: 'L', label: 'Tax Charged' },
  { key: 'personalReliefCents', letter: 'M', label: 'Personal Relief' },
  { key: 'insuranceReliefCents', letter: 'N', label: 'Insurance Relief' },
  { key: 'payeCents', letter: 'O', label: 'PAYE Tax (L − M − N)' },
];

export async function buildP9Document(employeeId: number, year: string): Promise<PrintDocument | null> {
  const [brand, org, setup, p9] = await Promise.all([printBrand(), getOrg(), getPayrollSetup(), getP9Annual(employeeId, year)]);
  if (!brand) return null;
  const money = documentMoney(brand, brand.currency_code);
  const { employee, rows, totals } = p9;
  const cell = (v: number) => (v ? bare(v) : '-');
  const otherNames = [employee.first_name, employee.middle_name].filter(Boolean).join(' ');

  // Column headers: one row of letters, one of captions, with E1–E3 grouped under E.
  const groupHead = P9_COLS.map((c) => {
    if (c.sub === 'E') return c.letter === 'E1' ? '<th colspan="3" class="p9-e">E<div class="p9-cap">Defined Contribution Retirement Scheme</div></th>' : '';
    return `<th rowspan="2">${esc(c.letter)}<div class="p9-cap">${esc(c.label)}</div></th>`;
  }).join('');
  const subHead = P9_COLS.filter((c) => c.sub === 'E').map((c) => `<th class="p9-e">${esc(c.letter)}<div class="p9-cap">${esc(c.label)}</div></th>`).join('');
  // Every month of the year is on the card, January to December; months not yet run print as
  // blank rules, and a month run in more than one period keeps each period's row.
  const seen = new Set(rows.map((r) => r.monthNo));
  const entries = [
    ...rows.map((r) => ({ monthNo: r.monthNo, html: `
      <tr>
        <td class="p9-month">${esc(p9Month(r))}</td>
        ${P9_COLS.map((c) => `<td class="num">${cell(r[c.key] as number)}</td>`).join('')}
      </tr>` })),
    ...P9_MONTHS.map((m, i) => ({ monthNo: i + 1, html: `
      <tr class="p9-blank"><td class="p9-month">${esc(m)}</td>${P9_COLS.map(() => '<td class="num"></td>').join('')}</tr>` }))
      .filter((e) => !seen.has(e.monthNo)),
  ].sort((a, b) => a.monthNo - b.monthNo);
  const bodyRows = entries.map((e) => e.html).join('');

  const html = `
  <header class="p9-head">
    <div class="p9-authority">
      ${brand.logo ? `<img class="p9-logo" src="${esc(brand.logo)}" alt="" />` : ''}
      <div>
        <div class="p9-kra">Kenya Revenue Authority</div>
        <div class="p9-dept">Domestic Taxes Department</div>
      </div>
    </div>
    <div class="p9-form">
      <div class="p9-form-no">P9</div>
      <div class="p9-form-t">Tax Deduction Card</div>
      <div class="p9-form-y">Year <strong>${esc(year)}</strong></div>
    </div>
  </header>
  <section class="p9-ident">
    <div class="p9-id"><span class="p9-k">Employer's Name</span><span class="p9-v">${esc(brand.name)}</span></div>
    <div class="p9-id"><span class="p9-k">Employer's PIN</span><span class="p9-v mono">${esc(org?.kra_pin || '')}</span></div>
    <div class="p9-id"><span class="p9-k">Employee's Main Name</span><span class="p9-v">${esc(employee.last_name)}</span></div>
    <div class="p9-id"><span class="p9-k">Employee's Other Names</span><span class="p9-v">${esc(otherNames)}</span></div>
    <div class="p9-id"><span class="p9-k">Employee's PIN</span><span class="p9-v mono">${esc(employee.kra_pin || '')}</span></div>
    <div class="p9-id"><span class="p9-k">Employee No.</span><span class="p9-v mono">${esc(employee.employee_no)}</span></div>
  </section>
  <table class="p9-card">
    <thead>
      <tr><th rowspan="2" class="p9-month">Month</th>${groupHead}</tr>
      <tr>${subHead}</tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="p9-total">
        <td class="p9-month">Totals</td>
        ${P9_COLS.map((c) => `<td class="num">${cell(totals[c.key] as number)}</td>`).join('')}
      </tr>
    </tbody>
  </table>
  <section class="p9-close">
    <div class="p9-close-h">To be completed by the employer at the end of the year</div>
    <div class="p9-close-grid">
      <div class="p9-id p9-fixed"><span class="p9-k">Total chargeable pay (col. K)</span><span class="p9-v p9-amt">${esc(money(totals.taxableCents))}</span></div>
      <div class="p9-id p9-fixed"><span class="p9-k">Total tax (col. O)</span><span class="p9-v p9-amt">${esc(money(totals.payeCents))}</span></div>
      <div class="p9-id p9-grow"><span class="p9-k">Employer's signature &amp; stamp</span><span class="p9-v p9-rule"></span></div>
      <div class="p9-id p9-grow p9-date"><span class="p9-k">Date</span><span class="p9-v p9-rule"></span></div>
    </div>
  </section>
  <section class="p9-notes">
    <div class="p9-notes-h">Important</div>
    <ol>
      <li>Use P9 (a) for all liable employees and where the director / employee received benefits in addition to cash emoluments; (b) where the employee is eligible for a deduction on owner-occupier interest.</li>
      <li>(a) Deductible owner-occupier interest in any month must not exceed KSh ${bare(setup.mortgage_relief_cents)} (col. F); the defined-contribution deduction (col. E) is the lowest of E1, E2 and E3. (b) Attach (i) a photostat copy of the interest certificate and statement of account from the financial institution, and (ii) the declaration duly signed by the employee.</li>
      <li>Columns H, I and J are the allowable deductions introduced by the Tax Laws (Amendment) Act, 2024 — Affordable Housing Levy, SHIF and post-retirement medical fund contributions — deducted before the chargeable pay in column K.</li>
      <li>Column O is the tax payable after personal relief (col. M) and insurance relief (col. N): O = L − M − N.</li>
    </ol>
  </section>`;

  const css = `
  .p9-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    border-bottom: 3px double var(--dp-ink); padding-bottom: 8px; margin-bottom: 8px; }
  .p9-authority { display: flex; gap: 12px; align-items: center; }
  .p9-logo { width: 52px; height: 52px; object-fit: contain; }
  .p9-kra { font-size: 17px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .p9-dept { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--dp-muted); }
  .p9-form { text-align: right; }
  .p9-form-no { font-size: 26px; font-weight: 800; line-height: 1; letter-spacing: .04em; }
  .p9-form-t { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--dp-muted); }
  .p9-form-y { font-size: 12px; margin-top: 3px; }
  .p9-ident { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 18px; margin-bottom: 10px; }
  .p9-id { display: flex; align-items: baseline; gap: 6px; font-size: 10.5px; min-width: 0; }
  .p9-k { color: var(--dp-muted); white-space: nowrap; }
  .p9-v { flex: 1; font-weight: 700; border-bottom: 1px dotted #9aa3a0; padding: 0 4px 1px; min-height: 13px; }
  .p9-v.mono { font-family: Consolas, "Courier New", monospace; letter-spacing: .04em; }
  .p9-v.p9-rule { min-height: 16px; }
  .p9-card { width: 100%; border-collapse: collapse; font-size: 8.5px; table-layout: fixed; }
  /* The app's global table styles uppercase and nowrap every th — this card wraps its captions. */
  .p9-card th, .p9-card td { border: 1px solid #5f6a66; padding: 3px 3px; vertical-align: top;
    white-space: normal; text-transform: none; letter-spacing: 0; }
  .p9-card thead th { background: #eef1f0; font-weight: 700; text-align: center; vertical-align: middle; line-height: 1.15; font-size: 9px; }
  .p9-card thead th.p9-e { background: #e4e9e7; }
  .p9-cap { font-weight: 400; font-size: 7px; color: #3d4744; margin-top: 2px; line-height: 1.2;
    white-space: normal; overflow-wrap: anywhere; hyphens: auto; }
  .p9-card th.p9-month { width: 62px; text-align: left; }
  .p9-card td.p9-month { font-weight: 600; white-space: nowrap; }
  .p9-card td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .p9-card tbody tr.p9-blank td { height: 15px; color: #9aa3a0; }
  .p9-card tr.p9-total td { font-weight: 800; background: #f4f6f5; border-top: 2px solid var(--dp-ink); }
  .p9-close { margin-top: 10px; border: 1px solid #5f6a66; padding: 6px 10px; }
  .p9-close-h { font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 4px; }
  .p9-close-grid { display: flex; align-items: baseline; gap: 8px 22px; flex-wrap: wrap; }
  .p9-close-grid .p9-fixed { flex: 0 0 auto; }
  .p9-close-grid .p9-grow { flex: 1 1 160px; }
  .p9-close-grid .p9-date { flex: 0 1 200px; }
  .p9-v.p9-amt { white-space: nowrap; flex: 0 0 auto; min-width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
  .p9-notes { margin-top: 8px; font-size: 8.5px; color: #3d4744; }
  .p9-notes-h { font-weight: 800; letter-spacing: .1em; text-transform: uppercase; font-size: 8.5px; margin-bottom: 2px; }
  .p9-notes ol { margin: 0; padding-left: 16px; }
  .p9-notes li { margin-bottom: 2px; line-height: 1.35; }
  @media print {
    .p9-card thead th, .p9-card tr.p9-total td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .p9-card tr { page-break-inside: avoid; }
  }`;

  return {
    brand,
    title: 'P9 Tax Deduction Card',
    subtitle: `Year ${year}`,
    landscape: true,
    parties: [],
    meta: [],
    columns: [],
    rows: [],
    totals: [],
    custom_html: html,
    custom_css: css,
    footnote: `Issued by ${brand.name} under the Income Tax Act (Cap. 470). Figures are as processed in the payroll periods of ${year}.`,
  };
}
