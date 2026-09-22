import { listActiveImprestPurposes, listPettyCashFloats } from '@/lib/imprest';
import { listActiveEmployees } from '@/lib/employees';
import { listPostableAccounts } from '@/lib/gl';
import { listBankAccounts } from '@/lib/bankMgmt';
import { listActivePaymentMethods } from '@/lib/receivablesSetup';
import type { ImprestLookups } from './imprest-actions';

/** The lookups the imprest, surrender and petty cash forms need — shared by the list tabs and the cards. */
export async function imprestLookups(): Promise<ImprestLookups> {
  const [employees, purposes, accounts, banks, payMethods, floats] = await Promise.all([
    listActiveEmployees(), listActiveImprestPurposes(), listPostableAccounts(), listBankAccounts(), listActivePaymentMethods(), listPettyCashFloats(),
  ]);
  return {
    employees, purposes,
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    banks: banks.filter((b) => b.status === 'ACTIVE').map((b) => ({ id: b.id, code: b.code, name: b.name })),
    payMethods: payMethods.map((m) => ({ code: m.code, description: m.description })),
    floats: floats.map((b) => ({ id: b.id, code: b.code, name: b.name, account_type: b.account_type })),
  };
}
