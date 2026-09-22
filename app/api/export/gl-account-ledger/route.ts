import { getAccountLedger } from '@/lib/gl';
import { getDimensionCaptions } from '@/lib/org';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import { formatDate } from '@/lib/format';
import { AppError } from '@/lib/errors';
import { NATURAL_DEBIT_TYPES } from '@/lib/constants';
import type { LedgerLine } from '@/lib/types';

interface Row extends LedgerLine { balance: number }

/** The Chart of Accounts / Trial Balance balance drill-down's own export — same query
 *  (getAccountLedger), same date/Dimensional filters, same running balance the modal computes
 *  client-side, so the workbook always matches exactly what was on screen when it was clicked. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') || '';
  const asOf = searchParams.get('asOf') || null;
  const from = searchParams.get('from') || null;
  const filters = parseFilters(searchParams.get('filters'));

  return excelExportResponse('GL_READ', async () => {
    const [ledger, { caption1, caption2 }] = await Promise.all([
      getAccountLedger(code, { from, asOf, filters }),
      getDimensionCaptions(),
    ]);
    if (!ledger) throw new AppError('Account not found', 'NOT_FOUND');

    const naturalDebit = NATURAL_DEBIT_TYPES.includes(ledger.account.type);
    let running = 0;
    const rows: Row[] = ledger.lines.map((l) => {
      running += naturalDebit ? l.debit - l.credit : l.credit - l.debit;
      return { ...l, balance: running };
    });

    const columns: ExcelColumn<Row>[] = [
      { header: 'Date', key: 'value_date', value: (r) => formatDate(r.value_date) },
      { header: 'Journal', key: 'journal_no', value: (r) => r.journal_no },
      { header: 'Document No.', key: 'reference', value: (r) => r.reference },
      { header: 'Description', key: 'description', width: 32, value: (r) => r.narration || r.description },
      { header: 'Source', key: 'source_module', value: (r) => r.source_module },
      { header: caption1, key: 'gd1', value: (r) => r.global_dimension_1_code },
      { header: caption2, key: 'gd2', value: (r) => r.global_dimension_2_code },
      { header: 'Debit', key: 'debit', width: 14, value: (r) => (r.debit ? r.debit / 100 : null) },
      { header: 'Credit', key: 'credit', width: 14, value: (r) => (r.credit ? r.credit / 100 : null) },
      { header: 'Balance', key: 'balance', width: 14, value: (r) => r.balance / 100 },
    ];
    return {
      filename: `gl-${ledger.account.code}-ledger.xlsx`,
      buffer: await buildWorkbookBuffer(`${ledger.account.code} Ledger`, columns, rows),
    };
  });
}
