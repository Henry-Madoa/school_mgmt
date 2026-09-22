/*
 * Bank Accounts + Bank Account Ledger Entries + Bank Reconciliation — the "Cash Management" area
 * of Business Central, moved out of lib/gl.ts. A bank account is a subledger master that controls
 * its own G/L account (flagged no_direct_posting) and carries its own currency; postJournal()
 * writes a bank_account_ledger_entry for every line hitting that control account.
 *
 * The reconciliation is BC's model (Tables 273/274): a statement has a No. Series number and an
 * ending balance; Suggest Lines pulls the open ledger entries; a G/L Adjustment line books a
 * statement-only item (bank charges / credit interest); Post closes the matched entries and rolls
 * the account's "Balance Last Statement" forward.
 */
import { one, all, run, tx, nextSequence, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import { postJournal } from './accounting.ts';
import { buildFilterClause, type FilterCondition, type FilterFieldDef } from './listFilters.ts';
import { buildOrderClause, type SortState } from './listSort.ts';
import type {
  Actor, BankAccount, BankAccountLedgerEntryWithJournal, BankAccountListRow, BankReconciliation,
  BankReconciliationDetail, BankRecLineView, Cents, IsoDate,
} from './types.ts';

const now = (): string => new Date().toISOString();

/* ------------------------------------------------------------- bank accounts */

const BA_SELECT = `
  SELECT ba.*, g.code AS gl_account_code, g.name AS gl_account_name
  FROM bank_account ba JOIN gl_account g ON g.id = ba.gl_account_id`;

export const listBankAccounts = (): Promise<BankAccountListRow[]> =>
  all<BankAccountListRow>(`${BA_SELECT} ORDER BY ba.code`);

export const getBankAccount = (id: number): Promise<BankAccountListRow | undefined> =>
  one<BankAccountListRow>(`${BA_SELECT} WHERE ba.id = ?`, id);

export const getBankAccountByCode = (code: string): Promise<BankAccountListRow | undefined> =>
  one<BankAccountListRow>(`${BA_SELECT} WHERE ba.code = ?`, code);

/** Every enabled Bank/Cashbook account — the Payment Channel picklist for a manual external
 *  a fee receipt, or any document that lets its user pick which of the school's own
 *  bank/cash/mobile-money accounts a posting moved through. */
export const listActiveBankAccounts = (): Promise<BankAccount[]> =>
  all<BankAccount>("SELECT * FROM bank_account WHERE status = 'ACTIVE' ORDER BY code");

export const hasAnyBankAccounts = (): Promise<boolean> => hasAnyRow('bank_account');

export interface BankAccountInput {
  code: string;
  name: string;
  glAccountId?: number | null;
  bankAccPostingGroupCode?: string | null;
  bankName?: string | null;
  accountNo?: string | null;
  currencyCode?: string | null;
  bankBranchNo?: string | null;
  bankSortCode?: string | null;
  externalBankCode?: string | null;
  iban?: string | null;
  swiftCode?: string | null;
  minBalance?: Cents;
  accountType?: string | null;
  blocked?: boolean;
  status?: 'ACTIVE' | 'INACTIVE';
}

/** The G/L control account: an explicit `glAccountId`, else the one on the Bank Acc. Posting Group. */
async function resolveControlAccount(input: BankAccountInput): Promise<number> {
  if (input.glAccountId) return input.glAccountId;
  if (input.bankAccPostingGroupCode) {
    const pg = await one<{ gl_account_id: number }>(
      'SELECT gl_account_id FROM bank_acc_posting_group WHERE code = ?', input.bankAccPostingGroupCode,
    );
    if (pg) return pg.gl_account_id;
  }
  throw new AppError('A G/L control account (or a Bank Acc. Posting Group) is required', 'VALIDATION');
}

/** Creating a bank account also flags its control account no_direct_posting — from that point a
 *  manual G/L journal can no longer touch it; only postJournal()'s automatic subledger posting
 *  (Receivables and Payables postings, Cash Management documents, Bank Reconciliation adjustments) can. */
export async function createBankAccount(input: BankAccountInput, user: Actor): Promise<{ id: number }> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code || !name) throw new AppError('Code and name are required', 'VALIDATION');
  if (await hasAnyRow('bank_account', 'code = ?', code)) throw new AppError('Bank account code already exists', 'DUPLICATE');
  const glAccountId = await resolveControlAccount(input);
  if (await hasAnyRow('bank_account', 'gl_account_id = ?', glAccountId)) {
    throw new AppError('That G/L account is already a bank account control account', 'DUPLICATE');
  }
  if (input.currencyCode && !(await hasAnyRow('currency', 'code = ? AND blocked = 0', input.currencyCode))) {
    throw new AppError('Unknown or blocked currency', 'VALIDATION');
  }
  const info = await run(
    `INSERT INTO bank_account
       (code, name, gl_account_id, bank_acc_posting_group_code, bank_name, account_no, currency_code,
        bank_branch_no, bank_sort_code, external_bank_code, iban, swift_code, min_balance, account_type,
        blocked, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, name, glAccountId, input.bankAccPostingGroupCode || null, input.bankName || null, input.accountNo || null,
    input.currencyCode || 'KES', input.bankBranchNo || null, input.bankSortCode || null, input.externalBankCode || null,
    input.iban || null, input.swiftCode || null, Math.round(input.minBalance ?? 0), input.accountType || 'OTHER',
    input.blocked ? 1 : 0, input.status || 'ACTIVE', now(),
  );
  await run('UPDATE gl_account SET no_direct_posting = 1 WHERE id = ?', glAccountId);
  await audit(user, 'BANK_ACCOUNT_CREATE', 'bank_account', info.lastInsertRowid, { code, name });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateBankAccount(id: number, input: BankAccountInput, user: Actor): Promise<void> {
  const before = await one<{ code: string; currency_code: string }>('SELECT code, currency_code FROM bank_account WHERE id = ?', id);
  if (!before) throw new AppError('Bank account not found', 'NOT_FOUND');
  if (!input.name?.trim()) throw new AppError('Name is required', 'VALIDATION');
  const hasEntries = await hasAnyRow('bank_account_ledger_entry', 'bank_account_id = ?', id);
  if (hasEntries && input.currencyCode && input.currencyCode !== before.currency_code) {
    throw new AppError('The currency cannot change once the account has ledger entries', 'VALIDATION');
  }
  await run(
    `UPDATE bank_account SET name = ?, bank_acc_posting_group_code = ?, bank_name = ?, account_no = ?,
       bank_branch_no = ?, bank_sort_code = ?, external_bank_code = ?, iban = ?, swift_code = ?,
       min_balance = ?, blocked = ?, status = ? WHERE id = ?`,
    input.name.trim(), input.bankAccPostingGroupCode || null, input.bankName || null, input.accountNo || null,
    input.bankBranchNo || null, input.bankSortCode || null, input.externalBankCode || null, input.iban || null,
    input.swiftCode || null, Math.round(input.minBalance ?? 0), input.blocked ? 1 : 0, input.status || 'ACTIVE', id,
  );
  await audit(user, 'BANK_ACCOUNT_UPDATE', 'bank_account', id, { code: before.code });
}

/* --------------------------------------------------- bank account ledger entries */

export const BANK_LEDGER_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'bank_account_id', label: 'Bank Account', type: 'select', column: 'bale.bank_account_id' },
  { key: 'document_type', label: 'Document Type', type: 'select', column: 'bale.document_type',
    options: ['Payment', 'Refund', 'Receipt', 'Transfer', 'Reconciliation'].map((v) => ({ value: v, label: v })) },
  { key: 'posting_date', label: 'Posting Date', type: 'date', column: 'bale.posting_date' },
];

export interface ListBankLedgerOptions {
  bankAccountId?: number; from?: IsoDate; to?: IsoDate; openOnly?: boolean;
  search?: string; filters?: FilterCondition[]; sort?: SortState | null;
}

export const listBankAccountLedgerEntries = (
  { bankAccountId, from, to, openOnly = false, search = '', filters = [], sort = null }: ListBankLedgerOptions = {},
): Promise<BankAccountLedgerEntryWithJournal[]> => {
  const { clause, params } = buildFilterClause(BANK_LEDGER_FILTER_FIELDS, filters);
  const orderBy = buildOrderClause(
    { posting_date: 'bale.posting_date', amount: 'bale.amount', document_no: 'bale.document_no' },
    sort, 'bale.posting_date DESC, bale.id DESC',
  );
  return all<BankAccountLedgerEntryWithJournal>(
    `SELECT bale.*, j.journal_no, j.source_module
     FROM bank_account_ledger_entry bale JOIN journal j ON j.id = bale.journal_id
     WHERE (bale.description ILIKE @like OR bale.document_no ILIKE @like OR bale.external_document_no ILIKE @like)
       ${bankAccountId ? 'AND bale.bank_account_id = @bankAccountId' : ''}
       ${from ? 'AND bale.posting_date >= @from' : ''}
       ${to ? 'AND bale.posting_date <= @to' : ''}
       ${openOnly ? 'AND bale.open = 1' : ''}
       ${clause}
     ${orderBy}`,
    { like: `%${String(search).trim()}%`, bankAccountId, from, to, ...params },
  );
};

/* -------------------------------------------------------- bank reconciliation (BC model) */

export async function startBankReconciliation(
  bankAccountId: number, statementDate: IsoDate, statementEndingBalance: Cents, user: Actor,
): Promise<{ id: number; statementNo: string }> {
  const ba = await one<{ balance_last_statement: Cents }>('SELECT balance_last_statement FROM bank_account WHERE id = ?', bankAccountId);
  if (!ba) throw new AppError('Bank account not found', 'NOT_FOUND');
  if (await hasAnyRow('bank_reconciliation', "bank_account_id = ? AND status = 'OPEN'", bankAccountId)) {
    throw new AppError('An open reconciliation already exists for this bank account', 'DUPLICATE');
  }
  const statementNo = await nextSequence('BANK_RECONCILIATION');
  const info = await run(
    `INSERT INTO bank_reconciliation (bank_account_id, statement_no, statement_date, statement_balance,
       balance_last_statement, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    bankAccountId, statementNo, statementDate, Math.round(statementEndingBalance), ba.balance_last_statement,
    user.username, now(),
  );
  await audit(user, 'BANK_RECONCILIATION_START', 'bank_reconciliation', info.lastInsertRowid, { bankAccountId, statementNo });
  return { id: Number(info.lastInsertRowid), statementNo };
}

async function loadReconciliation(id: number): Promise<BankReconciliation> {
  const r = await one<BankReconciliation>('SELECT * FROM bank_reconciliation WHERE id = ?', id);
  if (!r) throw new AppError('Reconciliation not found', 'NOT_FOUND');
  return r;
}

/** BC "Suggest Lines" — a Bank Account Ledger Entry line for every open entry on the account up to
 *  the statement date that is not already on a line. */
export async function suggestBankRecLines(id: number, user: Actor): Promise<{ added: number }> {
  const r = await loadReconciliation(id);
  if (r.status !== 'OPEN') throw new AppError('This reconciliation is already posted', 'VALIDATION');
  const entries = await all<{ id: number; posting_date: IsoDate; document_no: string | null; description: string | null; amount: Cents }>(
    `SELECT bale.id, bale.posting_date, bale.document_no, bale.description, bale.amount
     FROM bank_account_ledger_entry bale
     WHERE bale.bank_account_id = ? AND bale.open = 1 AND bale.posting_date <= ? AND bale.reversed = 0
       AND NOT EXISTS (SELECT 1 FROM bank_rec_line l WHERE l.bank_reconciliation_id = ? AND l.bank_account_ledger_entry_id = bale.id)
     ORDER BY bale.posting_date, bale.id`,
    r.bank_account_id, r.statement_date, id,
  );
  const maxLine = await one<{ m: number | null }>('SELECT MAX(line_no) AS m FROM bank_rec_line WHERE bank_reconciliation_id = ?', id);
  let lineNo = (maxLine?.m ?? 0) + 10000;
  for (const e of entries) {
    await run(
      `INSERT INTO bank_rec_line (bank_reconciliation_id, line_no, type, transaction_date, document_no, description,
         statement_amount, applied_amount, bank_account_ledger_entry_id, applied)
       VALUES (?,?, 'Bank Account Ledger Entry', ?,?,?,?,?,?,0)`,
      id, lineNo, e.posting_date, e.document_no, e.description, e.amount, e.amount, e.id,
    );
    lineNo += 10000;
  }
  await audit(user, 'BANK_RECONCILIATION_SUGGEST', 'bank_reconciliation', id, { added: entries.length });
  return { added: entries.length };
}

export async function matchBankRecLine(lineId: number, applied: boolean, user: Actor): Promise<void> {
  const line = await one<{ bank_reconciliation_id: number; bank_account_ledger_entry_id: number | null }>(
    'SELECT bank_reconciliation_id, bank_account_ledger_entry_id FROM bank_rec_line WHERE id = ?', lineId,
  );
  if (!line) throw new AppError('Reconciliation line not found', 'NOT_FOUND');
  const r = await loadReconciliation(line.bank_reconciliation_id);
  if (r.status !== 'OPEN') throw new AppError('This reconciliation is already posted', 'VALIDATION');
  await run('UPDATE bank_rec_line SET applied = ? WHERE id = ?', applied ? 1 : 0, lineId);
  await audit(user, 'BANK_RECONCILIATION_MATCH', 'bank_rec_line', lineId, { applied });
}

export interface BankRecAdjustmentInput { glAccountId: number; amount: Cents; description: string }

/** A statement-only item (bank charges, credit interest) — booked to the G/L on Post. */
export async function addBankRecGlAdjustmentLine(id: number, input: BankRecAdjustmentInput, user: Actor): Promise<void> {
  const r = await loadReconciliation(id);
  if (r.status !== 'OPEN') throw new AppError('This reconciliation is already posted', 'VALIDATION');
  if (!input.glAccountId) throw new AppError('A G/L account is required', 'VALIDATION');
  if (!input.amount) throw new AppError('An amount is required (negative for a charge, positive for interest received)', 'VALIDATION');
  const acc = await one<{ is_postable: number; status: string; no_direct_posting: number }>(
    'SELECT is_postable, status, no_direct_posting FROM gl_account WHERE id = ?', input.glAccountId,
  );
  if (!acc || !acc.is_postable || acc.status !== 'ACTIVE' || acc.no_direct_posting) {
    throw new AppError('That G/L account is not an active direct-posting account', 'VALIDATION');
  }
  const maxLine = await one<{ m: number | null }>('SELECT MAX(line_no) AS m FROM bank_rec_line WHERE bank_reconciliation_id = ?', id);
  await run(
    `INSERT INTO bank_rec_line (bank_reconciliation_id, line_no, type, transaction_date, description,
       statement_amount, applied_amount, gl_account_id, applied)
     VALUES (?,?, 'G/L Adjustment', ?,?,?,?,?,1)`,
    id, (maxLine?.m ?? 0) + 10000, r.statement_date, input.description.trim() || 'Bank statement adjustment',
    Math.round(input.amount), Math.round(input.amount), input.glAccountId,
  );
  await audit(user, 'BANK_RECONCILIATION_ADJUSTMENT', 'bank_reconciliation', id, input);
}

export async function deleteBankRecLine(lineId: number, user: Actor): Promise<void> {
  const line = await one<{ bank_reconciliation_id: number }>('SELECT bank_reconciliation_id FROM bank_rec_line WHERE id = ?', lineId);
  if (!line) return;
  const r = await loadReconciliation(line.bank_reconciliation_id);
  if (r.status !== 'OPEN') throw new AppError('This reconciliation is already posted', 'VALIDATION');
  await run('DELETE FROM bank_rec_line WHERE id = ?', lineId);
  await audit(user, 'BANK_RECONCILIATION_LINE_DELETE', 'bank_rec_line', lineId, {});
}

export async function getBankReconciliationDetail(id: number): Promise<BankReconciliationDetail | null> {
  const reconciliation = await one<BankReconciliation>('SELECT * FROM bank_reconciliation WHERE id = ?', id);
  if (!reconciliation) return null;
  const bankAccount = await one<BankAccount>('SELECT * FROM bank_account WHERE id = ?', reconciliation.bank_account_id);
  if (!bankAccount) return null;
  const lines = await all<BankRecLineView>(
    `SELECT l.*, bale.amount AS entry_amount, bale.open AS entry_open, g.code AS gl_account_code
     FROM bank_rec_line l
     LEFT JOIN bank_account_ledger_entry bale ON bale.id = l.bank_account_ledger_entry_id
     LEFT JOIN gl_account g ON g.id = l.gl_account_id
     WHERE l.bank_reconciliation_id = ? ORDER BY l.line_no`,
    id,
  );
  const unmatchedEntries = await all<BankAccountLedgerEntryWithJournal>(
    `SELECT bale.*, j.journal_no, j.source_module
     FROM bank_account_ledger_entry bale JOIN journal j ON j.id = bale.journal_id
     WHERE bale.bank_account_id = ? AND bale.open = 1 AND bale.posting_date <= ? AND bale.reversed = 0
       AND NOT EXISTS (SELECT 1 FROM bank_rec_line l WHERE l.bank_reconciliation_id = ? AND l.bank_account_ledger_entry_id = bale.id)
     ORDER BY bale.posting_date, bale.id`,
    reconciliation.bank_account_id, reconciliation.statement_date, id,
  );
  const appliedTotal = lines
    .filter((l) => l.type === 'Bank Account Ledger Entry' && l.applied === 1)
    .reduce((s, l) => s + l.applied_amount, 0);
  const adjustmentTotal = lines
    .filter((l) => l.type === 'G/L Adjustment')
    .reduce((s, l) => s + l.applied_amount, 0);
  const totalBalance = reconciliation.balance_last_statement + appliedTotal + adjustmentTotal;
  return {
    reconciliation, bankAccount, lines, unmatchedEntries,
    appliedTotal, adjustmentTotal, totalBalance,
    difference: reconciliation.statement_balance - totalBalance,
  };
}

export async function postBankReconciliation(id: number, user: Actor): Promise<{ journalNo: string | null }> {
  return tx(async () => {
    const detail = await getBankReconciliationDetail(id);
    if (!detail) throw new AppError('Reconciliation not found', 'NOT_FOUND');
    if (detail.reconciliation.status !== 'OPEN') throw new AppError('This reconciliation is already posted', 'VALIDATION');
    if (detail.difference !== 0) {
      throw new AppError('The reconciliation is out of balance — match every entry and account for statement-only items before posting', 'VALIDATION');
    }
    const bank = detail.bankAccount;
    const bankGl = await one<{ gl_account_id: number }>('SELECT gl_account_id FROM bank_account WHERE id = ?', bank.id);

    let journalNo: string | null = null;
    let journalId: number | null = null;
    const adjustments = detail.lines.filter((l) => l.type === 'G/L Adjustment');
    if (adjustments.length) {
      const glLines: { account: number; debit: Cents; credit: Cents; narration: string }[] = [];
      for (const a of adjustments) {
        // amount > 0 (interest received) → Dr bank / Cr the account; amount < 0 (charge) → the reverse.
        const amt = Math.abs(a.applied_amount);
        if (a.applied_amount > 0) {
          glLines.push({ account: bankGl!.gl_account_id, debit: amt, credit: 0, narration: a.description || 'Bank statement adjustment' });
          glLines.push({ account: a.gl_account_id!, debit: 0, credit: amt, narration: a.description || 'Bank statement adjustment' });
        } else {
          glLines.push({ account: a.gl_account_id!, debit: amt, credit: 0, narration: a.description || 'Bank charges' });
          glLines.push({ account: bankGl!.gl_account_id, debit: 0, credit: amt, narration: a.description || 'Bank charges' });
        }
      }
      const j = await postJournal({
        valueDate: detail.reconciliation.statement_date, module: 'CASH_MGMT', eventType: 'BANK_STMT_ADJUSTMENT',
        description: `Bank reconciliation ${detail.reconciliation.statement_no} — ${bank.code}`,
        reference: detail.reconciliation.statement_no, user,
        currencyCode: bank.currency_code,
        lines: glLines.map((l) => ({
          account: l.account, debit: l.debit, credit: l.credit, narration: l.narration,
          bankDocumentType: 'Reconciliation', bankDocumentNo: detail.reconciliation.statement_no,
        })),
      });
      journalNo = j.journal_no;
      journalId = j.id;
    }

    // Close every matched Bank Account Ledger Entry and the fresh adjustment BALE(s).
    for (const l of detail.lines) {
      if (l.type === 'Bank Account Ledger Entry' && l.applied === 1 && l.bank_account_ledger_entry_id) {
        await run(
          "UPDATE bank_account_ledger_entry SET reconciled = 1, open = 0, statement_no = ?, statement_line_no = ?, bank_reconciliation_id = ? WHERE id = ?",
          detail.reconciliation.statement_no, l.line_no, id, l.bank_account_ledger_entry_id,
        );
      }
    }
    if (journalId) {
      await run(
        "UPDATE bank_account_ledger_entry SET reconciled = 1, open = 0, statement_no = ?, bank_reconciliation_id = ? WHERE journal_id = ? AND bank_account_id = ?",
        detail.reconciliation.statement_no, id, journalId, bank.id,
      );
    }

    await run(
      "UPDATE bank_account SET balance_last_statement = ?, last_statement_no = last_statement_no + 1 WHERE id = ?",
      detail.reconciliation.statement_balance, bank.id,
    );
    await run(
      "UPDATE bank_reconciliation SET status = 'POSTED', posted = true, posted_by = ?, posted_at = ?, journal_id = ?, completed_by = ?, completed_at = ? WHERE id = ?",
      user.username, now(), journalId, user.username, now(), id,
    );
    await audit(user, 'BANK_RECONCILIATION_POST', 'bank_reconciliation', id, { journalNo });
    return { journalNo };
  });
}

export const listBankReconciliations = (bankAccountId?: number): Promise<(BankReconciliation & { bank_account_code: string })[]> =>
  all(
    `SELECT r.*, ba.code AS bank_account_code
     FROM bank_reconciliation r JOIN bank_account ba ON ba.id = r.bank_account_id
     ${bankAccountId ? 'WHERE r.bank_account_id = @bankAccountId' : ''}
     ORDER BY r.id DESC`,
    { bankAccountId },
  );
