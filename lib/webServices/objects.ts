/*
 * Web Services — the objects that can be published (Business Central's object list behind the
 * Web Services page): Pages (an entity with fields, readable and — where the domain allows —
 * writable), Queries (read-only datasets) and Codeunits (procedures). Both the OData V4 and the
 * SOAP endpoints are generated from these definitions, so adding an object here is all it takes
 * to expose it in both protocols.
 *
 * Money columns are stored in cents and exposed as decimals (12.50), as BC exposes Decimal.
 * Field names follow BC's PascalCase convention ("No", "Name", "Balance").
 */
import { one, all, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { createCustomer, updateCustomer, type CustomerInput } from '../customers.ts';
import { createVendor, updateVendor, type VendorInput } from '../vendors.ts';
import type { Actor, SessionUser, WebServiceObjectType, CustomerBlocked } from '../types.ts';
import type { ActionKey } from '../permissions.ts';
import { CHANNELS_INTEGRATION } from './channels.ts';

export type WsType = 'Code' | 'Text' | 'Integer' | 'Decimal' | 'Money' | 'Boolean' | 'Date' | 'DateTime';

export interface WsField {
  /** The field's name in both protocols (BC-style PascalCase). */
  name: string;
  /** SQL expression yielding the value — a column of the object's FROM clause. */
  column: string;
  type: WsType;
  /** The primary key field — exactly one per page/query. */
  key?: boolean;
  /** Not accepted on Create/Update (system fields, balances, computed columns). */
  readOnly?: boolean;
  /** Required on Create. */
  required?: boolean;
  caption?: string;
}

export interface WsContext { user: SessionUser; actor: Actor }

export interface WsPage {
  kind: 'PAGE';
  id: number;
  name: string;
  caption: string;
  /** Singular entity type name and the entity set (URL segment default). */
  entityName: string;
  entitySetName: string;
  /** FROM clause — a table or a joined subquery aliased `t`. */
  from: string;
  /** Tables whose Read permission a caller needs. */
  readTables: string[];
  fields: WsField[];
  /** Absent = read-only in both protocols. */
  insert?: (values: Record<string, unknown>, ctx: WsContext) => Promise<string | number>;
  modify?: (key: string, values: Record<string, unknown>, ctx: WsContext) => Promise<void>;
  delete?: (key: string, ctx: WsContext) => Promise<void>;
  /** Permission table checked for insert/modify/delete. */
  writeTable?: string;
}

export interface WsQuery {
  kind: 'QUERY';
  id: number;
  name: string;
  caption: string;
  entityName: string;
  entitySetName: string;
  from: string;
  readTables: string[];
  fields: WsField[];
}

export interface WsProcedure {
  name: string;
  caption: string;
  params: { name: string; type: WsType; required?: boolean }[];
  /** 'Json' returns a structured object (OData) / a JSON string (SOAP). */
  returns: WsType | 'Json';
  /** The action the caller must hold — the same grant the equivalent screen needs. */
  action?: ActionKey;
  run: (args: Record<string, unknown>, ctx: WsContext) => Promise<unknown>;
}

export interface WsCodeunit {
  kind: 'CODEUNIT';
  id: number;
  name: string;
  caption: string;
  procedures: WsProcedure[];
}

export type WsObject = WsPage | WsQuery | WsCodeunit;

/* ------------------------------------------------------------------------------ helpers */

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const cents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';
const F = (name: string, column: string, type: WsType, extra: Partial<WsField> = {}): WsField => ({ name, column, type, ...extra });

/** A code that names a record (a student's admission no., a customer no.), resolved to its row id. */
async function idOf(table: string, codeColumn: string, code: unknown, what: string): Promise<number> {
  const row = await one<{ id: number }>(`SELECT id FROM ${table} WHERE ${codeColumn} = ?`, String(code ?? '').trim());
  if (!row) throw new AppError(`${what} ${String(code ?? '')} not found`, 'NOT_FOUND');
  return row.id;
}

/* ------------------------------------------------------------------------------ pages */

async function genericModify(table: string, keyColumn: string, key: string, fields: WsField[], editable: Set<string> | null, values: Record<string, unknown>, ctx: WsContext, auditAction: string): Promise<void> {
  const sets: string[] = []; const args: unknown[] = [];
  for (const [name, value] of Object.entries(values)) {
    const f = fields.find((x) => x.name === name);
    if (!f) throw new AppError(`Unknown field ${name}`, 'VALIDATION');
    if (f.key) continue;
    if (f.readOnly || (editable && !editable.has(name))) throw new AppError(`Field ${name} is read-only`, 'VALIDATION');
    sets.push(`${f.column} = ?`);
    args.push(f.type === 'Money' ? cents(value) : f.type === 'Boolean' ? (bool(value) ? 1 : 0) : f.type === 'Integer' || f.type === 'Decimal' ? num(value) : str(value));
  }
  if (!sets.length) return;
  const res = await run(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${keyColumn} = ?`, ...args, key);
  if (!res.changes) throw new AppError(`${table} ${key} not found`, 'NOT_FOUND');
  const { audit } = await import('../db.ts');
  await audit(ctx.actor, auditAction, table, key, { via: 'WEB_SERVICE', fields: Object.keys(values) });
}

const CUSTOMER_FIELDS: WsField[] = [
  F('No', 'no', 'Code', { key: true, readOnly: true }),
  F('Name', 'name', 'Text', { required: true }),
  F('Name2', 'name_2', 'Text'),
  F('Address', 'address', 'Text'), F('Address2', 'address_2', 'Text'), F('City', 'city', 'Text'), F('PostCode', 'post_code', 'Code'), F('Country', 'country', 'Code'),
  F('Contact', 'contact', 'Text'), F('Phone', 'phone', 'Text'), F('Email', 'email', 'Text'),
  F('CustomerPostingGroup', 'customer_posting_group_code', 'Code'),
  F('PaymentTermsCode', 'payment_terms_code', 'Code'), F('PaymentMethodCode', 'payment_method_code', 'Code'),
  F('ReminderTermsCode', 'reminder_terms_code', 'Code'), F('FinChargeTermsCode', 'fin_charge_terms_code', 'Code'),
  F('Salesperson', 'salesperson', 'Code'), F('CurrencyCode', 'currency_code', 'Code'),
  F('CreditLimit', 'credit_limit', 'Money'), F('Blocked', 'blocked', 'Code'),
  F('GlobalDimension1Id', 'global_dimension_1_id', 'Integer'), F('GlobalDimension2Id', 'global_dimension_2_id', 'Integer'),
  F('Balance', 'balance', 'Money', { readOnly: true }),
  F('CreatedAt', 'created_at', 'DateTime', { readOnly: true }),
];
function customerInput(cur: Record<string, unknown> | null, v: Record<string, unknown>): CustomerInput {
  const g = (name: string, col: string) => (name in v ? v[name] : cur?.[col]);
  return {
    name: String(g('Name', 'name') ?? ''), name2: str(g('Name2', 'name_2')), address: str(g('Address', 'address')), address2: str(g('Address2', 'address_2')),
    city: str(g('City', 'city')), postCode: str(g('PostCode', 'post_code')), country: str(g('Country', 'country')), contact: str(g('Contact', 'contact')),
    phone: str(g('Phone', 'phone')), email: str(g('Email', 'email')), customerPostingGroupCode: str(g('CustomerPostingGroup', 'customer_posting_group_code')),
    paymentTermsCode: str(g('PaymentTermsCode', 'payment_terms_code')), paymentMethodCode: str(g('PaymentMethodCode', 'payment_method_code')),
    reminderTermsCode: str(g('ReminderTermsCode', 'reminder_terms_code')), finChargeTermsCode: str(g('FinChargeTermsCode', 'fin_charge_terms_code')),
    salesperson: str(g('Salesperson', 'salesperson')), currencyCode: str(g('CurrencyCode', 'currency_code')),
    creditLimit: 'CreditLimit' in v ? cents(v.CreditLimit) : Number(cur?.credit_limit ?? 0),
    blocked: (str(g('Blocked', 'blocked')) ?? '') as CustomerBlocked,
    globalDimension1Id: num(g('GlobalDimension1Id', 'global_dimension_1_id')), globalDimension2Id: num(g('GlobalDimension2Id', 'global_dimension_2_id')),
  };
}

const VENDOR_FIELDS: WsField[] = [
  F('No', 'no', 'Code', { key: true, readOnly: true }),
  F('Name', 'name', 'Text', { required: true }), F('Name2', 'name_2', 'Text'),
  F('Address', 'address', 'Text'), F('Address2', 'address_2', 'Text'), F('City', 'city', 'Text'), F('PostCode', 'post_code', 'Code'), F('Country', 'country', 'Code'),
  F('Contact', 'contact', 'Text'), F('Phone', 'phone', 'Text'), F('Email', 'email', 'Text'),
  F('VendorPostingGroup', 'vendor_posting_group_code', 'Code'), F('VatBusPostingGroup', 'vat_bus_posting_group_code', 'Code'),
  F('PinNo', 'pin_no', 'Code'), F('WhtExempt', 'wht_exempt', 'Boolean'),
  F('PaymentTermsCode', 'payment_terms_code', 'Code'), F('PaymentMethodCode', 'payment_method_code', 'Code'),
  F('Purchaser', 'purchaser', 'Code'), F('OurAccountNo', 'our_account_no', 'Code'), F('CurrencyCode', 'currency_code', 'Code'),
  F('CreditLimit', 'credit_limit', 'Money'), F('Blocked', 'blocked', 'Code'),
  F('Balance', 'balance', 'Money', { readOnly: true }),
  F('CreatedAt', 'created_at', 'DateTime', { readOnly: true }),
];
function vendorInput(cur: Record<string, unknown> | null, v: Record<string, unknown>): VendorInput {
  const g = (name: string, col: string) => (name in v ? v[name] : cur?.[col]);
  return {
    name: String(g('Name', 'name') ?? ''), name2: str(g('Name2', 'name_2')), address: str(g('Address', 'address')), address2: str(g('Address2', 'address_2')),
    city: str(g('City', 'city')), postCode: str(g('PostCode', 'post_code')), country: str(g('Country', 'country')), contact: str(g('Contact', 'contact')),
    phone: str(g('Phone', 'phone')), email: str(g('Email', 'email')), vendorPostingGroupCode: str(g('VendorPostingGroup', 'vendor_posting_group_code')),
    vatBusPostingGroupCode: str(g('VatBusPostingGroup', 'vat_bus_posting_group_code')), pinNo: str(g('PinNo', 'pin_no')),
    whtExempt: 'WhtExempt' in v ? bool(v.WhtExempt) : !!Number(cur?.wht_exempt ?? 0),
    paymentTermsCode: str(g('PaymentTermsCode', 'payment_terms_code')), paymentMethodCode: str(g('PaymentMethodCode', 'payment_method_code')),
    purchaser: str(g('Purchaser', 'purchaser')), ourAccountNo: str(g('OurAccountNo', 'our_account_no')), currencyCode: str(g('CurrencyCode', 'currency_code')),
    creditLimit: 'CreditLimit' in v ? cents(v.CreditLimit) : Number(cur?.credit_limit ?? 0),
    blocked: (str(g('Blocked', 'blocked')) ?? '') as VendorInput['blocked'],
  };
}

export const PAGES: WsPage[] = [
  {
    kind: 'PAGE', id: 50100, name: 'Student Card', caption: 'Students', entityName: 'Student', entitySetName: 'Students',
    from: `(SELECT s.*, g.name AS grade_level_name, st.name AS stream_name, c.no AS fee_account_no, COALESCE(c.balance, 0) AS fee_balance,
                   pg.full_name AS guardian_name, pg.phone AS guardian_phone, pg.email AS guardian_email
            FROM student s
            LEFT JOIN grade_level g ON g.id = s.current_grade_level_id
            LEFT JOIN stream st ON st.id = s.current_stream_id
            LEFT JOIN customer c ON c.id = s.customer_id
            LEFT JOIN LATERAL (SELECT gu.full_name, gu.phone, gu.email FROM student_guardian sg JOIN guardian gu ON gu.id = sg.guardian_id
                               WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1) pg ON true) t`,
    readTables: ['student', 'guardian', 'customer'],
    fields: [
      F('No', 'admission_no', 'Code', { key: true }), F('FirstName', 'first_name', 'Text'), F('MiddleName', 'middle_name', 'Text'), F('LastName', 'last_name', 'Text'),
      F('Gender', 'gender', 'Code'), F('DateOfBirth', 'date_of_birth', 'Date'), F('BirthCertificateNo', 'birth_certificate_no', 'Code'), F('NemisUpi', 'nemis_upi', 'Code'),
      F('Grade', 'grade_level_name', 'Text'), F('Class', 'stream_name', 'Text'), F('AdmissionDate', 'admission_date', 'Date'), F('Status', 'status', 'Code'),
      F('FeeAccountNo', 'fee_account_no', 'Code'), F('FeeBalance', 'fee_balance', 'Money'),
      F('GuardianName', 'guardian_name', 'Text'), F('GuardianPhone', 'guardian_phone', 'Text'), F('GuardianEmail', 'guardian_email', 'Text'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
  {
    kind: 'PAGE', id: 50103, name: 'Employee Card', caption: 'Employees', entityName: 'Employee', entitySetName: 'Employees',
    from: `(SELECT e.*, g.code AS job_grade_code, g.name AS job_grade_name, cj.job_id AS company_job_code, cj.name AS company_job_name,
                   d1.code AS global_dimension_1_code, d2.code AS global_dimension_2_code
            FROM employee e LEFT JOIN hr_job_grade g ON g.id = e.job_grade_id LEFT JOIN company_job cj ON cj.id = e.company_job_id
            LEFT JOIN global_dimension_1_value d1 ON d1.id = e.global_dimension_1_id LEFT JOIN global_dimension_2_value d2 ON d2.id = e.global_dimension_2_id) t`,
    readTables: ['employee'],
    fields: [
      F('No', 'employee_no', 'Code', { key: true }), F('FirstName', 'first_name', 'Text'), F('MiddleName', 'middle_name', 'Text'), F('LastName', 'last_name', 'Text'),
      F('Gender', 'gender', 'Code'), F('DateOfBirth', 'date_of_birth', 'Date'), F('NationalId', 'national_id', 'Code'), F('KraPin', 'kra_pin', 'Code'),
      F('NssfNo', 'nssf_no', 'Code'), F('ShifNo', 'shif_no', 'Code'), F('Phone', 'phone', 'Text'), F('Email', 'email', 'Text'),
      F('JobTitle', 'job_title', 'Text'), F('JobGradeCode', 'job_grade_code', 'Code'), F('CompanyJobCode', 'company_job_code', 'Code'), F('CompanyJobName', 'company_job_name', 'Text'),
      F('GlobalDimension1Code', 'global_dimension_1_code', 'Code'), F('GlobalDimension2Code', 'global_dimension_2_code', 'Code'),
      F('EmploymentDate', 'employment_date', 'Date'), F('NatureOfEmployment', 'nature_of_employment', 'Code'), F('EmployeeType', 'employee_type', 'Code'),
      F('Status', 'status', 'Code'), F('TerminationDate', 'termination_date', 'Date'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
  {
    kind: 'PAGE', id: 50104, name: 'Customer Card', caption: 'Customers', entityName: 'Customer', entitySetName: 'Customers',
    from: 'customer t', readTables: ['customer'], writeTable: 'customer', fields: CUSTOMER_FIELDS,
    insert: async (values, ctx) => (await createCustomer(customerInput(null, values), ctx.actor)).no,
    modify: async (key, values, ctx) => {
      const cur = await one<Record<string, unknown>>('SELECT * FROM customer WHERE no = ?', key);
      if (!cur) throw new AppError(`Customer ${key} not found`, 'NOT_FOUND');
      await updateCustomer(key, customerInput(cur, values), ctx.actor);
    },
  },
  {
    kind: 'PAGE', id: 50105, name: 'Vendor Card', caption: 'Vendors', entityName: 'Vendor', entitySetName: 'Vendors',
    from: 'vendor t', readTables: ['vendor'], writeTable: 'vendor', fields: VENDOR_FIELDS,
    insert: async (values, ctx) => (await createVendor(vendorInput(null, values), ctx.actor)).no,
    modify: async (key, values, ctx) => {
      const cur = await one<Record<string, unknown>>('SELECT * FROM vendor WHERE no = ?', key);
      if (!cur) throw new AppError(`Vendor ${key} not found`, 'NOT_FOUND');
      await updateVendor(key, vendorInput(cur, values), ctx.actor);
    },
  },
  {
    kind: 'PAGE', id: 50106, name: 'G/L Account Card', caption: 'G/L Accounts', entityName: 'GLAccount', entitySetName: 'GLAccounts',
    from: 'gl_account t', readTables: ['gl_account'],
    fields: [
      F('No', 'code', 'Code', { key: true }), F('Name', 'name', 'Text'), F('IncomeBalance', 'type', 'Code'), F('AccountType', 'account_type', 'Code'),
      F('Totaling', 'totaling', 'Text'), F('ParentNo', 'parent_code', 'Code'), F('Indentation', 'indentation', 'Integer'),
      F('DirectPosting', 'CASE WHEN t.no_direct_posting = 1 THEN 0 ELSE 1 END', 'Boolean'), F('Balance', 'balance', 'Money'), F('Blocked', "CASE WHEN t.status = 'ACTIVE' THEN 0 ELSE 1 END", 'Boolean'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
  {
    kind: 'PAGE', id: 50107, name: 'Item Card', caption: 'Items', entityName: 'Item', entitySetName: 'Items',
    from: 'item t', readTables: ['item'],
    fields: [
      F('No', 'no', 'Code', { key: true }), F('Description', 'description', 'Text'), F('Description2', 'description_2', 'Text'),
      F('CostingMethod', 'costing_method', 'Code'), F('UnitCost', 'unit_cost', 'Money'), F('UnitPrice', 'unit_price', 'Money'), F('Inventory', 'inventory', 'Integer'),
      F('ReorderingPolicy', 'reordering_policy', 'Code'), F('ReorderPoint', 'reorder_point', 'Integer'), F('ReorderQuantity', 'reorder_quantity', 'Integer'), F('MaximumInventory', 'maximum_inventory', 'Integer'),
      F('Status', 'status', 'Code'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
  {
    kind: 'PAGE', id: 50108, name: 'Fixed Asset Card', caption: 'Fixed Assets', entityName: 'FixedAsset', entitySetName: 'FixedAssets',
    from: 'fixed_asset t', readTables: ['fixed_asset'],
    fields: [
      F('No', 'no', 'Code', { key: true }), F('Description', 'description', 'Text'), F('Description2', 'description_2', 'Text'),
      F('FAClassCode', 'fa_class_code', 'Code'), F('FASubclassCode', 'fa_subclass_code', 'Code'), F('FALocationCode', 'fa_location_code', 'Code'),
      F('ResponsibleEmployee', 'responsible_employee', 'Code'), F('SerialNo', 'serial_no', 'Code'), F('VendorName', 'vendor_name', 'Text'), F('AssetTag', 'asset_tag', 'Code'),
      F('AcquisitionDate', 'acquisition_date', 'Date'), F('DisposalDate', 'disposal_date', 'Date'), F('Blocked', 'blocked', 'Boolean'), F('Inactive', 'inactive', 'Boolean'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
  {
    kind: 'PAGE', id: 50109, name: 'Company Job Card', caption: 'Company Jobs', entityName: 'CompanyJob', entitySetName: 'CompanyJobs',
    from: `(SELECT j.*, p.job_id AS reports_to_job_code,
                   (SELECT COUNT(*) FROM employee e WHERE e.company_job_id = j.id AND e.status IN ('ACTIVE','ON_LEAVE')) AS occupied
            FROM company_job j LEFT JOIN company_job p ON p.id = j.reports_to_job_id) t`,
    readTables: ['company_job'],
    fields: [
      F('No', 'job_id', 'Code', { key: true }), F('Name', 'name', 'Text'), F('Objective', 'objective', 'Text'), F('ReportsToJobNo', 'reports_to_job_code', 'Code'),
      F('NoOfPosts', 'no_of_posts', 'Integer'), F('Occupied', 'occupied', 'Integer'), F('Vacant', 'GREATEST(t.no_of_posts - t.occupied, 0)', 'Integer'),
      F('IsManagement', 'is_management', 'Boolean'), F('Profession', 'profession', 'Text'), F('Status', 'status', 'Code'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
];

/* ------------------------------------------------------------------------------ queries */

export const QUERIES: WsQuery[] = [
  {
    kind: 'QUERY', id: 50200, name: 'Trial Balance', caption: 'Trial Balance', entityName: 'TrialBalanceLine', entitySetName: 'TrialBalance',
    from: `(SELECT g.code, g.name, g.type, g.account_type,
                   COALESCE(SUM(jl.debit_lcy), 0) AS debits, COALESCE(SUM(jl.credit_lcy), 0) AS credits,
                   COALESCE(SUM(jl.debit_lcy), 0) - COALESCE(SUM(jl.credit_lcy), 0) AS net
            FROM gl_account g LEFT JOIN journal_line jl ON jl.gl_account_id = g.id
            WHERE g.is_postable = 1 GROUP BY g.id, g.code, g.name, g.type, g.account_type) t`,
    readTables: ['gl_account', 'journal_line'],
    fields: [
      F('AccountNo', 'code', 'Code', { key: true }), F('AccountName', 'name', 'Text'), F('IncomeBalance', 'type', 'Code'), F('AccountType', 'account_type', 'Code'),
      F('Debits', 'debits', 'Money'), F('Credits', 'credits', 'Money'), F('NetBalance', 'net', 'Money'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
  {
    kind: 'QUERY', id: 50201, name: 'Fee Balances', caption: 'Fee Balances', entityName: 'FeeBalance', entitySetName: 'FeeBalances',
    from: `(SELECT s.admission_no, s.first_name || ' ' || s.last_name AS student_name, g.name AS grade_level_name, st.name AS stream_name, s.status,
                   c.no AS fee_account_no, COALESCE(c.balance, 0) AS balance,
                   COALESCE((SELECT SUM(cle.remaining_amount_lcy) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.open = 1 AND cle.positive = 1 AND cle.due_date < CURRENT_DATE::text), 0) AS overdue,
                   (SELECT MAX(cle.posting_date) FROM cust_ledger_entry cle WHERE cle.customer_id = c.id AND cle.document_type = 'Payment') AS last_payment_date
            FROM student s JOIN customer c ON c.id = s.customer_id
            LEFT JOIN grade_level g ON g.id = s.current_grade_level_id LEFT JOIN stream st ON st.id = s.current_stream_id) t`,
    readTables: ['student', 'customer', 'cust_ledger_entry'],
    fields: [
      F('AdmissionNo', 'admission_no', 'Code', { key: true }), F('StudentName', 'student_name', 'Text'), F('Grade', 'grade_level_name', 'Text'), F('Class', 'stream_name', 'Text'), F('Status', 'status', 'Code'),
      F('FeeAccountNo', 'fee_account_no', 'Code'), F('Balance', 'balance', 'Money'), F('Overdue', 'overdue', 'Money'), F('LastPaymentDate', 'last_payment_date', 'Date'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
  {
    kind: 'QUERY', id: 50202, name: 'G/L Entries', caption: 'G/L Entries', entityName: 'GLEntry', entitySetName: 'GLEntries',
    from: `(SELECT jl.id, j.journal_no, j.value_date, j.posted_at, j.source_module, j.event_type, j.description AS journal_description, j.reference,
                   g.code AS account_no, g.name AS account_name, jl.debit_lcy, jl.credit_lcy, jl.debit_lcy - jl.credit_lcy AS amount, jl.narration,
                   d1.code AS global_dimension_1_code, d2.code AS global_dimension_2_code, j.posted_by
            FROM journal_line jl JOIN journal j ON j.id = jl.journal_id JOIN gl_account g ON g.id = jl.gl_account_id
            LEFT JOIN global_dimension_1_value d1 ON d1.id = jl.global_dimension_1_id LEFT JOIN global_dimension_2_value d2 ON d2.id = jl.global_dimension_2_id) t`,
    readTables: ['journal', 'journal_line', 'gl_account'],
    fields: [
      F('EntryNo', 'id', 'Integer', { key: true }), F('DocumentNo', 'journal_no', 'Code'), F('PostingDate', 'value_date', 'Date'), F('PostedAt', 'posted_at', 'DateTime'),
      F('SourceModule', 'source_module', 'Code'), F('EventType', 'event_type', 'Code'), F('Description', 'journal_description', 'Text'), F('ExternalDocumentNo', 'reference', 'Code'),
      F('GLAccountNo', 'account_no', 'Code'), F('GLAccountName', 'account_name', 'Text'),
      F('DebitAmount', 'debit_lcy', 'Money'), F('CreditAmount', 'credit_lcy', 'Money'), F('Amount', 'amount', 'Money'), F('Narration', 'narration', 'Text'),
      F('GlobalDimension1Code', 'global_dimension_1_code', 'Code'), F('GlobalDimension2Code', 'global_dimension_2_code', 'Code'), F('UserId', 'posted_by', 'Code'),
    ].map((f) => ({ ...f, readOnly: true })),
  },
];

/* ------------------------------------------------------------------------------ codeunits */

const P = (name: string, type: WsType, required = true) => ({ name, type, required });

export const CODEUNITS: WsCodeunit[] = [
  {
    kind: 'CODEUNIT', id: 50301, name: 'System Service', caption: 'System Service',
    procedures: [
      {
        name: 'Companies', caption: 'The companies on this server', params: [], returns: 'Json',
        run: async () => {
          const org = await one<{ name: string; short_name: string | null }>('SELECT name, short_name FROM organisation LIMIT 1').catch(() => undefined);
          return [org?.name ?? 'School'];
        },
      },
      {
        name: 'Ping', caption: 'Connectivity and authentication check', params: [], returns: 'Json',
        run: async (_a, ctx) => ({ ok: true, user: ctx.user.username, serverTime: new Date().toISOString() }),
      },
    ],
  },
];

export const ALL_OBJECTS: WsObject[] = [...PAGES, ...QUERIES, ...CODEUNITS, CHANNELS_INTEGRATION];

export function findObject(type: WebServiceObjectType, id: number): WsObject | undefined {
  return ALL_OBJECTS.find((o) => o.kind === type && o.id === id);
}

/** The key field of a page or query. */
export const keyField = (o: WsPage | WsQuery): WsField => o.fields.find((f) => f.key) ?? o.fields[0];

/** Fetch every row a SELECT * of the object's FROM produces — for a codeunit or a test. */
export const rawRows = (o: WsPage | WsQuery): Promise<Record<string, unknown>[]> => all(`SELECT * FROM ${o.from}`);
