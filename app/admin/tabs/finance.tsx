/* Admin Centre tabs — finance. Rendered by app/admin/[[...tab]]/page.tsx; moved out of it so each area reads on its own. */
import { currentCanAction } from '@/lib/session';
import { listPaymentTerms, listPaymentMethods, listCustomerPostingGroups } from '@/lib/receivablesSetup';
import { listVendorPostingGroups } from '@/lib/payablesSetup';
import { PaymentTermsFormButton, PaymentMethodFormButton, CustomerPostingGroupFormButton, DeleteCustomerPostingGroupButton, DeletePaymentTermsButton, DeletePaymentMethodButton } from '@/app/receivables/receivables-forms';
import { VendorPostingGroupFormButton, DeleteVendorPostingGroupButton } from '@/app/payables/payables-forms';
import { listPostableAccounts, listActiveBankAccounts } from '@/lib/gl';
import { Card, CardHead, EmptyState, Pill, TableWrap } from '@/components/ui/primitives';
import { listImprestPurposes } from '@/lib/imprest';
import { ImprestPurposeFormButton, ImprestPurposeRow } from '../../imprest/imprest-actions';
import { listVatBusinessPostingGroups, listVatProductPostingGroups, listVatPostingSetup } from '@/lib/vatSetup';
import { VatBusinessGroupButton, VatProductGroupButton, VatPostingSetupRowButton } from '../vat-forms';

export async function PaymentTermsTab() {
  const [rows, canManage] = await Promise.all([
    listPaymentTerms(), currentCanAction('RECEIVABLES_SETUP_MANAGE'),
  ]);
  return (
    <Card>
      <CardHead title="Payment Terms"
        sub="When an invoice falls due, and any settlement discount. Due Date and Discount Date use a date formula (30D, CM, CM+10D). Referenced by the Customer and Vendor cards and every sales and purchase document.">
        {canManage ? <PaymentTermsFormButton>New terms</PaymentTermsFormButton> : null}
      </CardHead>
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>Code</th><th>Description</th><th>Due Date Calc.</th><th>Discount Date Calc.</th><th className="num">Discount %</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.code}</td><td>{t.description}</td>
                <td className="mono">{t.due_date_calculation || '—'}</td>
                <td className="mono">{t.discount_date_calculation || '—'}</td>
                <td className="num">{t.discount_pct}</td><td><Pill status={t.status} /></td>
                <td className="num">{canManage ? (<div className="inline" style={{ justifyContent: 'flex-end' }}><PaymentTermsFormButton row={t} className="btn sm ghost">Edit</PaymentTermsFormButton><DeletePaymentTermsButton id={t.id} /></div>) : null}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="🗓" title="No payment terms yet" sub="Add the terms your invoices fall due on — 30 days, cash on delivery, end of month." />}
    </Card>
  );
}

export async function PaymentMethodsTab() {
  const [rows, canManage, banks] = await Promise.all([
    listPaymentMethods(), currentCanAction('RECEIVABLES_SETUP_MANAGE'), listActiveBankAccounts(),
  ]);
  return (
    <Card>
      <CardHead title="Payment Methods"
        sub="How money actually moves: cash, cheque, M-Pesa, EFT. Referenced by the Customer and Vendor cards, and chosen on every Receipt and Payment Voucher.">
        {canManage ? <PaymentMethodFormButton banks={banks.map((b) => ({ code: b.code, name: b.name }))}>New method</PaymentMethodFormButton> : null}
      </CardHead>
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>Code</th><th>Description</th><th>Bal. Account Type</th><th>Bal. Account No.</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.code}</td><td>{m.description}</td><td>{m.bal_account_type}</td>
                <td className="mono muted-cell">{m.bal_account_no ?? '—'}</td><td><Pill status={m.status} /></td>
                <td className="num">{canManage ? (<div className="inline" style={{ justifyContent: 'flex-end' }}><PaymentMethodFormButton row={m} banks={banks.map((b) => ({ code: b.code, name: b.name }))} className="btn sm ghost">Edit</PaymentMethodFormButton><DeletePaymentMethodButton id={m.id} /></div>) : null}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="💳" title="No payment methods yet" sub="Add the ways money reaches you — cash, cheque, M-Pesa, bank transfer." />}
    </Card>
  );
}

export async function CustomerPostingGroupsTab() {
  const [rows, canManage, accounts] = await Promise.all([
    listCustomerPostingGroups(), currentCanAction('RECEIVABLES_SETUP_MANAGE'), listPostableAccounts(),
  ]);
  return (
    <Card>
      <CardHead title="Customer Posting Groups"
        sub="The G/L accounts every customer posting resolves against. Each customer card names one, and it is what decides which receivables account their invoices land in.">
        {canManage ? <CustomerPostingGroupFormButton accounts={accounts}>New group</CustomerPostingGroupFormButton> : null}
      </CardHead>
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>Code</th><th>Description</th><th>Receivables</th><th>Service charge</th><th>Additional fee</th><th className="num">Customers</th><th /></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td className="mono">{g.code}</td><td>{g.description}</td>
                <td className="mono muted-cell">{g.receivables_account_code}</td>
                <td className="mono muted-cell">{g.service_charge_account_code}</td>
                <td className="mono muted-cell">{g.additional_fee_account_code}</td>
                <td className="num">{g.customers_using}</td>
                <td className="num">{canManage ? (<div className="inline" style={{ justifyContent: 'flex-end' }}><CustomerPostingGroupFormButton row={g} accounts={accounts} className="btn sm ghost">Edit</CustomerPostingGroupFormButton><DeleteCustomerPostingGroupButton id={g.id} /></div>) : null}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="⚖" title="No customer posting groups yet" sub="A customer cannot be invoiced until one exists — it is what names their receivables account." />}
    </Card>
  );
}

export async function VendorPostingGroupsTab() {
  const [rows, canManage, accounts] = await Promise.all([
    listVendorPostingGroups(), currentCanAction('PAYABLES_SETUP_MANAGE'), listPostableAccounts(),
  ]);
  return (
    <Card>
      <CardHead title="Vendor Posting Groups"
        sub="The G/L accounts every vendor posting resolves against. Each vendor card names one, and it is what decides which payables account their invoices land in.">
        {canManage ? <VendorPostingGroupFormButton accounts={accounts}>New group</VendorPostingGroupFormButton> : null}
      </CardHead>
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>Code</th><th>Description</th><th>Payables</th><th>Service charge</th><th>Invoice rounding</th><th className="num">Vendors</th><th /></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td className="mono">{g.code}</td><td>{g.description}</td>
                <td className="mono muted-cell">{g.payables_account_code}</td>
                <td className="mono muted-cell">{g.service_charge_account_code}</td>
                <td className="mono muted-cell">{g.invoice_rounding_account_code}</td>
                <td className="num">{g.vendors_using}</td>
                <td className="num">{canManage ? (<div className="inline" style={{ justifyContent: 'flex-end' }}><VendorPostingGroupFormButton row={g} accounts={accounts} className="btn sm ghost">Edit</VendorPostingGroupFormButton><DeleteVendorPostingGroupButton id={g.id} /></div>) : null}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="⚖" title="No vendor posting groups yet" sub="A vendor cannot be invoiced until one exists — it is what names their payables account." />}
    </Card>
  );
}

export async function ImprestPurposesTab() {
  const [rows, canManage] = await Promise.all([listImprestPurposes(), currentCanAction('ADMIN_POOL_IMPREST_PURPOSES_MANAGE')]);
  return (
    <Card>
      <CardHead title="Imprest Purposes" sub="The standard reasons an imprest is requested for; picked on the request and printed on the form.">
        {canManage ? <ImprestPurposeFormButton>New purpose</ImprestPurposeFormButton> : null}
      </CardHead>
      {rows.length ? (
        <TableWrap>
          <thead><tr><th>Code</th><th>Description</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => <ImprestPurposeRow key={r.code} row={r} canManage={canManage} />)}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="🧭" title="No imprest purposes yet" sub="Add the standard reasons — travel, training, field work, procurement — an imprest is requested for." />}
    </Card>
  );
}

export async function VatPostingSetupTab() {
  const [busGroups, prodGroups, setup, accounts] = await Promise.all([
    listVatBusinessPostingGroups(), listVatProductPostingGroups(), listVatPostingSetup(), listPostableAccounts(),
  ]);
  return (
    <>
      <Card>
        <CardHead title="VAT Business Posting Groups" sub="Assigned to a vendor — combines with the product group to find the rate"><VatBusinessGroupButton>New</VatBusinessGroupButton></CardHead>
        <TableWrap><thead><tr><th>Code</th><th>Description</th><th className="num" /></tr></thead><tbody>
          {busGroups.map((g) => <tr key={g.id}><td className="mono">{g.code}</td><td>{g.description}</td><td className="num"><VatBusinessGroupButton row={g} className="btn sm ghost">Edit</VatBusinessGroupButton></td></tr>)}
        </tbody></TableWrap>
      </Card>
      <Card>
        <CardHead title="VAT Product Posting Groups" sub="Type VAT or WHT — the code carried on a G/L account or a payment-voucher line"><VatProductGroupButton>New</VatProductGroupButton></CardHead>
        <TableWrap><thead><tr><th>Code</th><th>Description</th><th>Type</th><th className="num" /></tr></thead><tbody>
          {prodGroups.map((g) => <tr key={g.id}><td className="mono">{g.code}</td><td>{g.description}</td><td>{g.tax_type}</td><td className="num"><VatProductGroupButton row={g} className="btn sm ghost">Edit</VatProductGroupButton></td></tr>)}
        </tbody></TableWrap>
      </Card>
      <Card>
        <CardHead title="VAT Posting Setup" sub="The % and G/L account for each business × product combination"><VatPostingSetupRowButton busGroups={busGroups} prodGroups={prodGroups} accounts={accounts}>New row</VatPostingSetupRowButton></CardHead>
        <TableWrap><thead><tr><th>Business</th><th>Product</th><th>Type</th><th className="num">Rate %</th><th>Calc</th><th>Tax account</th><th className="num" /></tr></thead><tbody>
          {setup.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.vat_bus_posting_group_code}</td><td className="mono">{s.vat_prod_posting_group_code}</td>
              <td>{s.tax_type}</td><td className="num">{s.vat_pct}</td><td>{s.vat_calculation_type}</td>
              <td className="mono muted-cell">{s.tax_account_code ?? '—'}</td>
              <td className="num"><VatPostingSetupRowButton row={s} busGroups={busGroups} prodGroups={prodGroups} accounts={accounts} className="btn sm ghost">Edit</VatPostingSetupRowButton></td>
            </tr>
          ))}
        </tbody></TableWrap>
      </Card>
    </>
  );
}
