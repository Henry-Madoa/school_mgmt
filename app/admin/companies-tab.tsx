import { currentCanAction } from '@/lib/session';
import { listCompanies, companyStats, usersAssignedTo } from '@/lib/companies';
import { getActiveCompany } from '@/lib/companyContext';
import { formatBytes, formatDate } from '@/lib/format';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { CopyCompanyButton, DeleteCompanyButton, RenameCompanyButton } from './company-forms';

/** Admin Centre → Companies: the company list with Copy Company and Delete Company. */
export async function CompaniesTab() {
  const [companies, active, canManage] = await Promise.all([listCompanies(), getActiveCompany(), currentCanAction('COMPANIES_MANAGE')]);
  const stats = await Promise.all(companies.map((c) => companyStats(c).catch(() => null)));
  const pinned = await Promise.all(companies.map((c) => usersAssignedTo(c.code)));
  return (
    <>
      <Toolbar>
        <Spacer />
        {canManage ? <CopyCompanyButton companies={companies} defaultSource={active.code}>New company</CopyCompanyButton> : null}
      </Toolbar>
      <Card>
        <CardHead title="Companies" sub="Each company is an independent set of business data. Create a test copy of the live company, a setup-only company to prepare for production, or an empty one. A user changes company on My Settings unless an administrator has assigned them one on the User card." />
        {companies.length ? (
          <TableWrap>
            <thead>
              <tr><th>Code</th><th>Company</th><th>Kind</th><th>Assigned users</th><th>Created</th><th className="num">Members</th><th className="num">Loans</th><th className="num">Journals</th><th className="num">Size</th><th className="num" /></tr>
            </thead>
            <tbody>
              {companies.map((c, i) => {
                const s = stats[i]; const isActive = c.code === active.code;
                return (
                  <tr key={c.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}><b>{c.code}</b>{isActive ? <> <Pill tone="ok">current</Pill></> : null}</td>
                    <td><b>{c.display_name}</b>{c.copied_from ? <div className="tiny muted-cell">from {c.copied_from}</div> : null}</td>
                    <td>{c.is_default ? <Pill tone="info">Live</Pill> : <Pill tone="warn">Test copy</Pill>}</td>
                    <td className="tiny">{pinned[i].length ? pinned[i].map((u) => u.username).join(', ') : <span className="muted-cell">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(c.created_at.slice(0, 10))}<div className="tiny muted-cell">{c.created_by}</div></td>
                    <td className="num">{s ? s.members.toLocaleString() : '—'}</td>
                    <td className="num">{s ? s.loans.toLocaleString() : '—'}</td>
                    <td className="num">{s ? s.journals.toLocaleString() : '—'}</td>
                    <td className="num">{s ? formatBytes(s.sizeBytes) : '—'}</td>
                    <td className="num">
                      <span className="inline" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {canManage ? <RenameCompanyButton company={c} /> : null}
                        {canManage && !c.is_default ? (
                          <DeleteCompanyButton company={c} blockedReason={isActive ? 'You cannot delete the company you are currently working in — switch to another company first' : pinned[i].length ? `${pinned[i].length} user${pinned[i].length === 1 ? ' is' : 's are'} assigned to this company — reassign them on the User card first` : null} />
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏢" title="No companies" />}
      </Card>
      <CollapsibleCard title="How companies work" defaultCollapsed>
        <DefinitionList items={[
          ['What is copied', 'Every business table: setup, members, accounts, loans, journals and ledgers, documents, payroll, HR, web service registrations and logs — with their numbering series continuing from where the source was.'],
          ['What is shared', 'Users, sessions, roles, permission sets, user permissions and Role Centre profiles. The same sign-in works in every company with the same rights.'],
          ['Switching', 'A user with no assignment picks a company on My Settings; it changes only which company their browser works in. A user assigned to a company on the User card always works there and cannot switch. The badge on the top bar shows the current company and marks a copy as TEST.'],
          ['Integrations', "OData and SOAP calls run in the live company unless the URL names another with the Company('CODE') / /WS/CODE/ prefix."],
          ['Schema changes', 'A copy is a snapshot: database migrations apply to the live company only. After a migration, delete old copies and copy again.'],
          ['Setup data only', 'Products, the chart of accounts (balances zeroed), number series (restarted), charges, dimensions, posting groups, VAT, fixed-asset and HR/payroll setup, workflows and approval setup — nothing that belongs to a member, customer, vendor, employee, item or asset, and no postings.'],
          ['Deleting', 'Deleting a company drops its data permanently and immediately. The live company can never be deleted, nor the company you are currently working in, nor one that users are still assigned to.'],
        ]} />
      </CollapsibleCard>
    </>
  );
}
