import { listBankAccountLedgerEntries } from '@/lib/bankMgmt';
import { parseFilters } from '@/lib/listFilters';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { BankAccountLedgerEntry } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const bankAccountId = searchParams.get('bankAccountId') ? Number(searchParams.get('bankAccountId')) : undefined;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const filters = parseFilters(searchParams.get('filters'));
  return excelExportResponse('CASH_MGMT_READ', async () => {
    const rows = await listBankAccountLedgerEntries({ bankAccountId, from, to, filters });
    const columns: ExcelColumn<BankAccountLedgerEntry & { bank_account_code?: string }>[] = [
      { header: 'Posting Date', key: 'posting_date', value: (r) => r.posting_date },
      { header: 'Document Type', key: 'document_type', value: (r) => r.document_type ?? '' },
      { header: 'Document No.', key: 'document_no', value: (r) => r.document_no ?? '' },
      { header: 'External Doc.', key: 'external_document_no', value: (r) => r.external_document_no ?? '' },
      { header: 'Description', key: 'description', width: 36, value: (r) => r.description ?? '' },
      { header: 'Amount', key: 'amount', value: (r) => Number(r.amount) / 100 },
      { header: 'Amount (LCY)', key: 'amount_lcy', value: (r) => Number(r.amount_lcy) / 100 },
      { header: 'Open', key: 'open', value: (r) => (r.open ? 'Yes' : 'No') },
      { header: 'Statement No.', key: 'statement_no', value: (r) => r.statement_no ?? '' },
    ];
    return { filename: 'bank-account-ledger.xlsx', buffer: await buildWorkbookBuffer('Bank Ledger', columns, rows) };
  });
}
