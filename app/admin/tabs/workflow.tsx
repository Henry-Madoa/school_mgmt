/* Admin Centre tabs — workflow. Rendered by app/admin/[[...tab]]/page.tsx; moved out of it so each area reads on its own. */
import { listUsers } from '@/lib/admin';
import { listActiveCounties, listActiveDimensionValues } from '@/lib/pool';
import { listWorkflows, listWorkflowUserGroups, listWorkflowUserGroupMembers, listWorkflowTableRelations, listDocumentTypeOptions, listWorkflowDocumentTypes, documentTypeLabel } from '@/lib/workflow';
import { getDimensionCaptions } from '@/lib/org';
import { Card, CardHead, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { WorkflowFormButton } from '../workflow-form';
import { WorkflowUserGroupFormButton } from '../workflow-user-group-form';
import { WorkflowTableRelationFormButton } from '../workflow-table-relation-form';

export async function WorkflowsTab() {
  const [
    workflows, users, groups, county, globalDimension1, globalDimension2,
    captions, documentTypes,
  ] = await Promise.all([
    listWorkflows(), listUsers(), listWorkflowUserGroups(),
    listActiveCounties(), listActiveDimensionValues(1), listActiveDimensionValues(2),
    getDimensionCaptions(), listWorkflowDocumentTypes(),
  ]);
  const relationProps = {
    county, globalDimension1, globalDimension2,
    dimensionCaption1: captions.caption1, dimensionCaption2: captions.caption2,
  };
  const wiredByType = new Map(documentTypes.map((d) => [d.documentType, d.wired]));

  return (
    <>
      <Toolbar>
        <Spacer />
        <WorkflowFormButton documentTypes={documentTypes} users={users} groups={groups} {...relationProps}>
          Add workflow
        </WorkflowFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Workflows" sub="Route approvals by document field values instead of a flat permission" />
        {workflows.length ? (
          <TableWrap>
            <thead>
              <tr><th>Name</th><th>Document type</th><th className="num">Steps</th><th>Enabled</th><th className="num" /></tr>
            </thead>
            <tbody>
              {workflows.map((w) => (
                <tr key={w.id}>
                  <td><b>{w.name}</b></td>
                  <td>
                    {documentTypeLabel(w.document_type)}
                    {wiredByType.get(w.document_type) === false ? <> <Pill tone="warn">NOT YET ENFORCED</Pill></> : null}
                  </td>
                  <td className="num">{w.steps.length}</td>
                  <td>{w.enabled ? <Pill tone="ok">ENABLED</Pill> : <Pill tone="bad">DISABLED</Pill>}</td>
                  <td className="num">
                    <WorkflowFormButton
                      workflow={w} documentTypes={documentTypes} users={users} groups={groups}
                      {...relationProps} className="btn sm ghost"
                    >
                      Edit
                    </WorkflowFormButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🔀" title="No workflows yet" sub="Documents fall back to a plain permission check until one is defined" />}
      </Card>
    </>
  );
}

export async function WorkflowGroupsTab() {
  const [groups, users] = await Promise.all([listWorkflowUserGroups(), listUsers()]);
  const membersByGroup = Object.fromEntries(
    await Promise.all(groups.map(async (g) => [g.id, await listWorkflowUserGroupMembers(g.id)] as const)),
  );

  return (
    <>
      <Toolbar>
        <Spacer />
        <WorkflowUserGroupFormButton users={users}>Add group</WorkflowUserGroupFormButton>
      </Toolbar>
      <Card>
        <CardHead title="Approval user groups" sub="A step routed to a group can be actioned by any of its members" />
        {groups.length ? (
          <TableWrap>
            <thead>
              <tr><th>Name</th><th className="num">Members</th><th>Status</th><th className="num" /></tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td><b>{g.name}</b></td>
                  <td className="num">{g.members}</td>
                  <td><Pill status={g.status} /></td>
                  <td className="num">
                    <WorkflowUserGroupFormButton group={g} members={membersByGroup[g.id]} users={users} className="btn sm ghost">
                      Edit
                    </WorkflowUserGroupFormButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="👥" title="No approval user groups yet" />}
      </Card>
    </>
  );
}

export async function TableRelationsTab() {
  const [documentTypes, relations, dimensionCaptions] = await Promise.all([
    listDocumentTypeOptions(), listWorkflowTableRelations(), getDimensionCaptions(),
  ]);
  const relationByType = new Map(relations.map((r) => [r.document_type, r]));

  return (
    <Card>
      <CardHead
        title="Table relations"
        sub="Which table backs each document type, and which of its fields a workflow's conditions may route approvals on"
      />
      <TableWrap>
        <thead>
          <tr><th>Document type</th><th>Table</th><th>Enforced</th><th className="num">Fields enabled</th><th className="num" /></tr>
        </thead>
        <tbody>
          {documentTypes.map((d) => {
            const relation = relationByType.get(d.documentType) ?? null;
            return (
              <tr key={d.documentType}>
                <td><b>{d.label}</b></td>
                <td className="mono">{d.table}</td>
                <td>{d.wired ? <Pill tone="ok">YES</Pill> : <Pill tone="warn">NOT YET</Pill>}</td>
                <td className="num">{relation?.fields.length ?? 0}</td>
                <td className="num">
                  <WorkflowTableRelationFormButton
                    documentType={d.documentType} documentTypeLabel={d.label} tableName={d.table}
                    relation={relation} className="btn sm ghost"
                    dimensionCaption1={dimensionCaptions.caption1} dimensionCaption2={dimensionCaptions.caption2}
                  >
                    Configure fields
                  </WorkflowTableRelationFormButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </Card>
  );
}
