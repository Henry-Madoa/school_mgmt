/* Admin Centre tabs — security. Rendered by app/admin/[[...tab]]/page.tsx; moved out of it so each area reads on its own. */
import { PAGES } from '@/lib/permissions';
import { listUsers, listRoles, listAuditLog, hasAnyAuditLog, AUDIT_FILTER_FIELDS } from '@/lib/admin';
import { listProfiles, listUserProfiles } from '@/lib/profiles';
import { listChangeLogSetup, listChangeLogEntries, hasAnyChangeLogEntries, listAvailableChangeLogTables, CHANGE_LOG_FILTER_FIELDS } from '@/lib/changeLog';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { listApprovalUserSetup } from '@/lib/workflow';
import { imageSrc, isConfigured } from '@/lib/cloudinary';
import { formatDateTime } from '@/lib/format';
import { Card, CardHead, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { ExportButton } from '@/components/ui/export-button';
import { UserFormButton, UnlockUserButton, ResetTwoFactorButton } from '../user-form';
import { UserPermissionsButton } from '../user-permissions-form';
import { RoleFormButton, RoleRow } from '../role-form';
import { ProfileFormButton, DeleteProfileButton } from '../profile-forms';
import { ApprovalUserSetupFormButton } from '../approval-user-setup-form';
import { listActiveEmployees } from '@/lib/employees';
import { listActiveStudentsPick, listGuardians } from '@/lib/students';
import { UserSignatureButton } from '../user-signature-form';
import { ChangeLogSetupTable } from '../change-log-setup-table';
import { listCompanies } from '@/lib/companies';

export async function UsersTab() {
  const [users, roles, profiles, companies] = await Promise.all([listUsers(), listRoles(), listProfiles(), listCompanies()]);

  return (
    <>
      <Toolbar>
        <Spacer />
        <UserFormButton roles={roles} profiles={profiles} companies={companies}>Add user</UserFormButton>
      </Toolbar>
      <Card>
        <CardHead title={`${users.length} system users`}
          sub="The permission set sets the defaults; per-user overrides tune an individual user; Role Centres are just the landing dashboard" />
        <TableWrap>
          <thead>
            <tr>
              <th>User</th><th>Username</th><th>Roles &amp; permissions</th><th>Role Centres</th>
              {companies.length > 1 ? <th>Company</th> : null}<th>Last sign-in</th><th>Status</th><th className="num" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <b>{u.full_name}</b>
                  <div className="tiny">{u.email || ''}</div>
                </td>
                <td className="mono">{u.username}</td>
                <td>
                  <b>{u.role_name}</b>
                  {u.extra_permission_set_names.length ? (
                    <div className="tiny muted-cell">+ {u.extra_permission_set_names.join(', ')}</div>
                  ) : null}
                  {u.override_count ? (
                    <div><Pill tone="warn">{u.override_count} permission override{u.override_count === 1 ? '' : 's'}</Pill></div>
                  ) : null}
                </td>
                <td className="tiny">
                  {u.profile_codes.length
                    ? profiles.filter((p) => u.profile_codes.includes(p.code)).map((p) => p.name).join(', ')
                    : <span className="muted-cell">Super (default)</span>}
                </td>
                {companies.length > 1 ? (
                  <td className="tiny">{u.company_code ? (companies.find((c) => c.code === u.company_code)?.display_name ?? u.company_code) : <span className="muted-cell">Not assigned</span>}</td>
                ) : null}
                <td>{u.last_login_at ? formatDateTime(u.last_login_at) : 'never'}</td>
                <td>
                  <Pill status={u.status} />
                  {u.locked_until && u.locked_until > new Date().toISOString()
                    ? <div><Pill tone="bad">Locked until {formatDateTime(u.locked_until)}</Pill></div>
                    : u.failed_logins > 0 ? <div className="tiny muted-cell">{u.failed_logins} failed sign-in{u.failed_logins === 1 ? '' : 's'}</div> : null}
                  {u.must_change_password ? <div className="tiny muted-cell">Must change password</div> : null}
                  {u.totp_enabled ? <div className="tiny muted-cell">🔐 Two-factor on</div> : null}
                </td>
                <td className="num">
                  <span className="inline" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    {(u.locked_until && u.locked_until > new Date().toISOString()) || u.failed_logins > 0 ? <UnlockUserButton user={u} /> : null}
                    {u.totp_enabled ? <ResetTwoFactorButton user={u} /> : null}
                    <UserPermissionsButton user={u} pages={PAGES}>Permissions</UserPermissionsButton>
                    <UserFormButton user={u} roles={roles} profiles={profiles} companies={companies} className="btn sm ghost">
                      Edit
                    </UserFormButton>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

export async function RolesTab() {
  const roles = await listRoles();

  return (
    <>
      <Toolbar>
        <Spacer />
        <RoleFormButton pages={PAGES}>Add permission set</RoleFormButton>
      </Toolbar>
      <Card>
        <CardHead title={`${roles.length} permission sets`}
          sub="Click a permission code to see its full line-by-line grant" />
        <TableWrap>
          <thead>
            <tr>
              <th>Permission code</th><th>Description</th>
              <th className="num">Lines</th><th className="num">Assigned users</th>
              <th>Type</th><th className="num" />
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => <RoleRow key={r.id} role={r} pages={PAGES} />)}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

/** Setup Pool → General → Role Centre Profiles. A Profile is a landing-page selector — it decides
 *  which Role Centre dashboard a user sees and carries no permissions. Assign them to users on the
 *  Users tab; a user switches their active one in My Settings. */
export async function ProfilesTab() {
  const [profiles, links] = await Promise.all([
    listProfiles(),
    Promise.all((await listUsers()).map(async (u) => ({ user: u, profiles: await listUserProfiles(u.id) }))),
  ]);
  const usersByProfile = new Map<number, string[]>();
  for (const { user, profiles: ups } of links) {
    for (const p of ups) usersByProfile.set(p.id, [...(usersByProfile.get(p.id) ?? []), user.full_name]);
  }

  return (
    <>
      <Toolbar>
        <span className="tiny muted-cell">
          A Role Centre chooses a user&apos;s home dashboard and which sidebar groups they see — it
          grants no rights. Permissions come from the roles assigned on the Users tab.
        </span>
        <Spacer />
        <ProfileFormButton>New profile</ProfileFormButton>
      </Toolbar>
      <Card>
        <CardHead title={`${profiles.length} Role Centre profiles`}
          sub="The six built-in profiles cannot be deleted; you can rename them or add your own" />
        <TableWrap>
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Role Centre</th><th>Assigned users</th><th>Type</th><th className="num" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.icon ? `${p.icon} ` : ''}{p.code}</td>
                <td><b>{p.name}</b><div className="tiny muted-cell">{p.description}</div></td>
                <td className="tiny">{p.role_centre}</td>
                <td className="tiny">{(usersByProfile.get(p.id) ?? []).join(', ') || <span className="muted-cell">none</span>}</td>
                <td>{p.is_system ? <Pill tone="info">Built-in</Pill> : <Pill>Custom</Pill>}</td>
                <td className="num">
                  <span className="inline" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <ProfileFormButton profile={p} className="btn sm ghost">Edit</ProfileFormButton>
                    {p.is_system ? null : <DeleteProfileButton code={p.code} />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

export async function ApprovalUserSetupTab() {
  const [rows, employees, students, guardians] = await Promise.all([listApprovalUserSetup(), listActiveEmployees(), listActiveStudentsPick(), listGuardians()]);
  const guardianPicks = guardians.map((g) => ({ id: g.id, full_name: g.full_name, phone: g.phone }));
  const mediaEnabled = isConfigured();

  return (
    <Card>
      <CardHead
        title="User setup"
        sub="Who each login is — the employee behind it (Employee Self Service, and Teacher for the Teacher Portal) or the student / guardian (the portal) — who approves each user's requests, their substitute, fallback approval administrators, per-user posting-date overrides, and the signature stamped onto documents they approve"
      />
      <TableWrap>
        <thead>
          <tr><th>User</th><th>Employee / portal</th><th>Approver</th><th>Substitute</th><th>Approval admin</th><th>Can Reverse Journal</th><th>Posting window</th><th>Signature</th><th className="num" /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id}>
              <td><b>{r.full_name}</b> <span className="tiny">({r.username})</span></td>
              <td>
                {r.employee_no ? <><span className="mono">{r.employee_no}</span> <span className="tiny">{r.employee_name}</span>{r.is_teacher ? <> <Pill tone="ok">Teacher</Pill></> : null}</>
                  : r.student_name ? <><Pill tone="info">Student</Pill> <span className="tiny">{r.student_name}</span></>
                    : r.guardian_name ? <><Pill tone="info">Guardian</Pill> <span className="tiny">{r.guardian_name}</span></>
                      : <span className="tiny muted-cell">Not linked</span>}
              </td>
              <td>{r.approver_name || '—'}</td>
              <td>{r.substitute_name || '—'}</td>
              <td>{r.is_approval_administrator ? <Pill tone="info">YES</Pill> : '—'}</td>
              <td>{r.can_reverse_journal ? <Pill tone="info">YES</Pill> : '—'}</td>
              <td className="tiny">
                {r.allow_posting_from || r.allow_posting_to
                  ? `${r.allow_posting_from ?? '…'}${r.allow_posting_from_time ? ` ${r.allow_posting_from_time}` : ''} – ${r.allow_posting_to ?? '…'}${r.allow_posting_to_time ? ` ${r.allow_posting_to_time}` : ''}`
                  : 'Company default'}
              </td>
              <td>
                <div className="inline" style={{ gap: 8 }}>
                  {imageSrc(r.signature_image, { width: 120, height: 40, crop: 'fit' })
                    ? <img src={imageSrc(r.signature_image, { width: 120, height: 40, crop: 'fit' })!}
                        alt={`${r.full_name} signature`} style={{ maxHeight: 32 }} />
                    : <span className="tiny muted-cell">None on file</span>}
                  <UserSignatureButton
                    userId={r.user_id} fullName={r.full_name} mediaEnabled={mediaEnabled}
                    src={imageSrc(r.signature_image, { width: 360, height: 140, crop: 'fit' })}
                  />
                </div>
              </td>
              <td className="num">
                <ApprovalUserSetupFormButton row={r} users={rows} employees={employees} students={students} guardians={guardianPicks} className="btn sm ghost">Edit</ApprovalUserSetupFormButton>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

export async function AuditTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty] = await Promise.all([
    listAuditLog({ search, filters, sort }),
    hasAnyAuditLog().then((any) => !any),
  ]);

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Filter by user, action or entity…" disabled={empty} />
        <DynamicFilterBar fields={AUDIT_FILTER_FIELDS} disabled={empty} />
        <Spacer />
        <ExportButton href="/api/export/audit" params={{ q: search, filters: filtersRaw, sort: sortRaw }} disabled={!rows.length} />
      </Toolbar>
      <Card>
        <CardHead title="Audit trail" sub="Append-only record of every privileged and financial action" />
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="at">When</SortLink></th>
                <th><SortLink sortKey="username">User</SortLink></th>
                <th><SortLink sortKey="action">Action</SortLink></th>
                <th><SortLink sortKey="entity">Entity</SortLink></th>
                <th><SortLink sortKey="detail">Detail</SortLink></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.at)}</td>
                  <td>{a.username || 'system'}</td>
                  <td><Pill status={a.action} /></td>
                  <td className="mono tiny">{a.entity || ''}{a.entity_id ? `#${a.entity_id}` : ''}</td>
                  <td className="mono tiny" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.detail || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📋" title="No audit entries match" />}
      </Card>
    </>
  );
}

/**
 * Field-level change tracking, modelled on Business Central's Change Log Management —
 * nothing is recorded for a table until it's checked in below, unlike the always-on
 * Audit Trail tab.
 */
export async function ChangeLogTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [setup, entries, empty, available] = await Promise.all([
    listChangeLogSetup(), listChangeLogEntries({ search, filters, sort }),
    hasAnyChangeLogEntries().then((any) => !any),
    listAvailableChangeLogTables(),
  ]);
  const fields = CHANGE_LOG_FILTER_FIELDS.map((f) => (
    f.key === 'table_name' ? { ...f, options: setup.map((s) => ({ value: s.table_name, label: s.table_caption })) } : f
  ));

  return (
    <>
      <Card>
        <CardHead title="Change Log Setup" sub="Only the tables checked here get field-level change tracking" />
        <ChangeLogSetupTable setup={setup} available={available} />
      </Card>

      <Toolbar>
        <SearchInput placeholder="Filter by record, field or user…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        <ExportButton href="/api/export/change-log" params={{ q: search, filters: filtersRaw, sort: sortRaw }} disabled={!entries.length} />
      </Toolbar>
      <Card>
        <CardHead title="Change Log Entries" sub="Every logged field change, newest first" />
        {entries.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="changed_at">When</SortLink></th>
                <th><SortLink sortKey="username">User</SortLink></th>
                <th><SortLink sortKey="table_caption">Table</SortLink></th>
                <th><SortLink sortKey="record_id">Record</SortLink></th>
                <th><SortLink sortKey="field_name">Field</SortLink></th>
                <th><SortLink sortKey="old_value">Old value</SortLink></th>
                <th><SortLink sortKey="new_value">New value</SortLink></th>
                <th><SortLink sortKey="type">Type</SortLink></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.changed_at)}</td>
                  <td>{e.username}</td>
                  <td>{e.table_caption}</td>
                  <td className="mono tiny">{e.record_id}</td>
                  <td>{e.field_name}</td>
                  <td className="mono tiny">{e.old_value ?? '—'}</td>
                  <td className="mono tiny">{e.new_value ?? '—'}</td>
                  <td><Pill status={e.type} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📜" title="No change log entries yet" />}
      </Card>
    </>
  );
}
