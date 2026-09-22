import Link from 'next/link';
import { headers } from 'next/headers';
import { currentCanAction } from '@/lib/session';
import { listWebServices, getWebService, listUnregisteredObjects, listAccessKeys, listWebServiceLog } from '@/lib/webServices';
import { findObject, keyField, type WsPage, type WsQuery, type WsCodeunit } from '@/lib/webServices/objects';
import { listUsers } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { Card, CardHead, DefinitionList, EmptyState, Pill, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import {
  WebServiceFormButton, PublishToggleButton, DeleteWebServiceButton, GenerateKeyButton, RevokeKeyButton, ClearLogButton, CopyButton,
  type PublishableObject,
} from './web-service-forms';

/** The public base URL integrations should use — from the request, like BC composes its URLs. */
async function baseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

const SCREEN = '/admin/data/web-services';

/** How an object type reads on screen. */
const objectTypeLabel = (t: string) => (t === 'PAGE' ? 'Page' : t === 'QUERY' ? 'Query' : 'Codeunit');

export const odataUrl = (base: string, s: { object_type: string; service_name: string }) =>
  s.object_type === 'CODEUNIT' ? `${base}/ODataV4/${s.service_name}_<Procedure>` : `${base}/ODataV4/${s.service_name}`;
export const soapUrl = (base: string, s: { object_type: string; service_name: string }) =>
  `${base}/WS/${s.object_type === 'CODEUNIT' ? 'Codeunit' : 'Page'}/${s.service_name}`;

/* ------------------------------------------------------------------------------ Web Services */

export async function WebServicesTab({ service }: { service?: string }) {
  if (service) return <WebServiceCard id={Number(service)} />;
  const [rows, unregistered, canManage, base] = await Promise.all([listWebServices(), listUnregisteredObjects(), currentCanAction('WEB_SERVICES_MANAGE'), baseUrl()]);
  const objects: PublishableObject[] = unregistered.map((o) => ({
    value: `${o.kind}:${o.id}`, type: objectTypeLabel(o.kind), id: o.id, name: o.name, caption: o.caption,
    defaultServiceName: o.kind === 'CODEUNIT' ? o.name.replace(/[^A-Za-z0-9]+/g, '') : o.entitySetName,
  }));
  return (
    <>
      <Toolbar>
        <Spacer />
        {canManage ? <WebServiceFormButton objects={objects}>New web service</WebServiceFormButton> : null}
      </Toolbar>
      <Card>
        <CardHead title="Web Services" sub="Objects published as OData V4 entity sets/actions and SOAP services. Callers authenticate with HTTP Basic (username + Web Service Access Key) and act with that user's permissions." />
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>Object Type</th><th className="num">Object ID</th><th>Object Name</th><th>Service Name</th><th>Published</th><th>OData V4 URL</th><th>SOAP URL</th><th className="num" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{objectTypeLabel(r.object_type)}</td>
                  <td className="num mono">{r.object_id}</td>
                  <td>{r.object_name}</td>
                  <td className="mono"><Link href={`${SCREEN}?service=${r.id}`}>{r.service_name}</Link></td>
                  <td><Pill tone={r.published ? 'ok' : ''}>{r.published ? 'Published' : 'Not published'}</Pill></td>
                  <td className="tiny mono">{r.published ? <a href={odataUrl(base, r)} target="_blank" rel="noreferrer">{odataUrl(base, r).replace(base, '')}</a> : <span className="muted-cell">—</span>}</td>
                  <td className="tiny mono">{r.published ? <a href={`${soapUrl(base, r)}?wsdl`} target="_blank" rel="noreferrer">{soapUrl(base, r).replace(base, '')}</a> : <span className="muted-cell">—</span>}</td>
                  <td className="num">{canManage ? <PublishToggleButton service={r} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🔌" title="No web services registered" sub="Register a page, query or codeunit and publish it to expose it over OData and SOAP." />}
      </Card>
      <CollapsibleCard title="How integrations connect" defaultCollapsed>
        <DefinitionList items={[
          ['Service document', <span className="mono" key="sd">{base}/ODataV4</span>],
          ['Metadata (EDMX)', <span className="mono" key="md">{base}/ODataV4/$metadata</span>],
          ['SOAP system service', <span className="mono" key="ss">{base}/WS/SystemService?wsdl</span>],
          ['Authentication', 'HTTP Basic — user name and the user\'s Web Service Access Key (Admin Centre → Data Management → Web Service Access Keys). A signed-in browser session also works for trying URLs.'],
          ['Permissions', 'A call may read a page/query only if the user has Read on its tables; create/update/delete need Insert/Modify/Delete; a codeunit procedure needs the same action grant as the screen that does the same thing.'],
          ['Company', "/ODataV4/Company('Name')/… and /WS/Name/Page/… company prefixes are accepted; this system has one company, so they can also be left out."],
          ['Logging', 'Every request is written to the Web Service Log with the caller, status and duration.'],
        ]} />
      </CollapsibleCard>
    </>
  );
}

async function WebServiceCard({ id }: { id: number }) {
  const [s, canManage, base] = await Promise.all([getWebService(id), currentCanAction('WEB_SERVICES_MANAGE'), baseUrl()]);
  if (!s) return <Card><EmptyState icon="🔌" title="Web service not found" /><Link href={SCREEN} className="btn ghost sm">← Web services</Link></Card>;
  const obj = findObject(s.object_type, s.object_id);
  const odata = odataUrl(base, s); const soap = soapUrl(base, s);
  const isCodeunit = obj?.kind === 'CODEUNIT';
  const entity = obj && !isCodeunit ? (obj as WsPage | WsQuery) : null;
  const key = entity ? keyField(entity) : null;
  const sampleKey = key ? (key.type === 'Integer' ? '1' : `'${key.name === 'No' ? 'X00001' : 'CODE'}'`) : '';
  const firstProc = isCodeunit ? (obj as WsCodeunit).procedures[0] : null;
  const soapSample = entity
    ? `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ReadMultiple xmlns="urn:school-erp-schemas/page/${s.service_name.toLowerCase()}">
      <filter><Field>${entity.fields[1]?.name ?? key!.name}</Field><Criteria>*</Criteria></filter>
      <setSize>50</setSize>
    </ReadMultiple>
  </soap:Body>
</soap:Envelope>`
    : `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${firstProc?.name ?? 'Procedure'} xmlns="urn:school-erp-schemas/codeunit/${s.service_name}">
${(firstProc?.params ?? []).map((p) => `      <${p.name}>…</${p.name}>`).join('\n')}
    </${firstProc?.name ?? 'Procedure'}>
  </soap:Body>
</soap:Envelope>`;
  const odataSample = entity
    ? `curl -u USERNAME:ACCESS_KEY "${odata}?$top=5&$orderby=${key!.name}"
curl -u USERNAME:ACCESS_KEY "${odata}(${sampleKey})"
curl -u USERNAME:ACCESS_KEY "${odata}?$filter=${entity.fields.find((f) => f.name === 'Status')?.name ?? key!.name} eq 'ACTIVE'&$select=${entity.fields.slice(0, 3).map((f) => f.name).join(',')}&$count=true"`
    : `curl -u USERNAME:ACCESS_KEY -H "Content-Type: application/json" -X POST "${base}/ODataV4/${s.service_name}_${firstProc?.name ?? 'Procedure'}" -d '${JSON.stringify(Object.fromEntries((firstProc?.params ?? []).map((p) => [p.name, p.type === 'Decimal' || p.type === 'Money' || p.type === 'Integer' ? 0 : '…'])))}'`;
  return (
    <>
      <Toolbar>
        <Link href={SCREEN} className="btn ghost sm">← Web services</Link>
        <Spacer />
        {canManage ? <WebServiceFormButton service={s} objects={[]} className="btn ghost">Edit</WebServiceFormButton> : null}
        {canManage ? <PublishToggleButton service={s} className="btn ghost" /> : null}
        {canManage ? <DeleteWebServiceButton service={s} className="btn ghost" /> : null}
      </Toolbar>
      <CollapsibleCard title={`${s.service_name}`} sub={`${objectTypeLabel(s.object_type)} ${s.object_id} — ${s.object_name}`}>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <div className="dl-caption">Registration</div>
            <DefinitionList items={[
              ['Object', `${objectTypeLabel(s.object_type)} ${s.object_id} · ${s.object_name}`],
              ['Service Name', <span className="mono" key="n">{s.service_name}</span>],
              ['Published', <Pill tone={s.published ? 'ok' : ''} key="p">{s.published ? 'Published' : 'Not published'}</Pill>],
              ['Description', s.description || '—'],
              ['Registered', `${s.created_by ?? '—'} · ${formatDateTime(s.created_at)}`],
              obj && !isCodeunit ? ['Operations', obj.kind === 'PAGE' ? ['Read', 'ReadMultiple', (obj as WsPage).insert ? 'Create' : null, (obj as WsPage).modify ? 'Update' : null, (obj as WsPage).delete ? 'Delete' : null].filter(Boolean).join(', ') : 'Read, ReadMultiple (read-only query)'] : null,
            ]} />
          </section>
          <section className="dl-group">
            <div className="dl-caption">Endpoints</div>
            <DefinitionList items={[
              ['OData V4', <span className="inline" key="o" style={{ gap: 6 }}><span className="mono tiny" style={{ wordBreak: 'break-all' }}>{odata}</span><CopyButton text={odata} /></span>],
              ['SOAP', <span className="inline" key="s" style={{ gap: 6 }}><span className="mono tiny" style={{ wordBreak: 'break-all' }}>{soap}</span><CopyButton text={soap} /></span>],
              ['WSDL', <a key="w" className="mono tiny" href={`${soap}?wsdl`} target="_blank" rel="noreferrer">{soap}?wsdl</a>],
              !isCodeunit ? ['$metadata', <a key="m" className="mono tiny" href={`${base}/ODataV4/$metadata`} target="_blank" rel="noreferrer">{base}/ODataV4/$metadata</a>] : null,
            ]} />
          </section>
        </div>
      </CollapsibleCard>

      {entity ? (
        <CollapsibleCard title="Fields" sub={`${entity.fields.length} fields — the entity's properties in OData and elements in SOAP`}>
          <TableWrap>
            <thead><tr><th>Field</th><th>Type</th><th>Key</th><th>Writable</th><th>Required</th><th>Source column</th></tr></thead>
            <tbody>
              {entity.fields.map((f) => (
                <tr key={f.name}>
                  <td className="mono">{f.name}</td>
                  <td>{f.type}</td>
                  <td>{f.key ? 'Yes' : ''}</td>
                  <td>{entity.kind === 'PAGE' && !f.readOnly && !f.key ? 'Yes' : <span className="muted-cell">read-only</span>}</td>
                  <td>{f.required ? 'Yes' : ''}</td>
                  <td className="tiny mono muted-cell">{f.column}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </CollapsibleCard>
      ) : null}

      {isCodeunit ? (
        <CollapsibleCard title="Procedures" sub="Each procedure is an OData unbound action (POST ServiceName_Procedure) and a SOAP operation">
          <TableWrap>
            <thead><tr><th>Procedure</th><th>Parameters</th><th>Returns</th><th>Requires</th><th>Description</th></tr></thead>
            <tbody>
              {(obj as WsCodeunit).procedures.map((p) => (
                <tr key={p.name}>
                  <td className="mono">{p.name}</td>
                  <td className="tiny mono">{p.params.length ? p.params.map((prm) => `${prm.name}: ${prm.type}${prm.required ? '' : '?'}`).join(', ') : '—'}</td>
                  <td>{p.returns}</td>
                  <td className="tiny mono">{p.action ?? '—'}</td>
                  <td>{p.caption}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </CollapsibleCard>
      ) : null}

      <CollapsibleCard title="Sample requests" sub="Replace USERNAME and ACCESS_KEY with a user and their Web Service Access Key">
        <div className="grid g2">
          <div>
            <div className="dl-caption">OData V4</div>
            <pre className="tiny mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>{odataSample}</pre>
            {entity?.kind === 'PAGE' && (entity as WsPage).insert ? (
              <pre className="tiny mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>{`curl -u USERNAME:ACCESS_KEY -H "Content-Type: application/json" -X POST "${odata}" -d '${JSON.stringify(Object.fromEntries(entity.fields.filter((f) => !f.readOnly && !f.key).slice(0, 4).map((f) => [f.name, f.type === 'Money' || f.type === 'Decimal' || f.type === 'Integer' ? 0 : f.type === 'Boolean' ? false : '…'])))}'
curl -u USERNAME:ACCESS_KEY -H "Content-Type: application/json" -H "If-Match: *" -X PATCH "${odata}(${sampleKey})" -d '{"${entity.fields.find((f) => !f.readOnly && !f.key)?.name}": "…"}'`}</pre>
            ) : null}
          </div>
          <div>
            <div className="dl-caption">SOAP</div>
            <pre className="tiny mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>{`curl -u USERNAME:ACCESS_KEY -H "Content-Type: text/xml" -H "SOAPAction: ${entity ? 'ReadMultiple' : firstProc?.name ?? ''}" -X POST "${soap}" -d @request.xml

# request.xml
${soapSample}`}</pre>
          </div>
        </div>
      </CollapsibleCard>
    </>
  );
}

/* ------------------------------------------------------------------------------ Access keys */

export async function WebServiceKeysTab() {
  const [keys, users, canManage] = await Promise.all([listAccessKeys(), listUsers(), currentCanAction('WEB_SERVICES_MANAGE')]);
  const active = keys.filter((k) => !k.revoked_at);
  const withKey = new Set(active.map((k) => k.user_id));
  return (
    <>
      <Toolbar>
        <Spacer />
        {canManage ? <GenerateKeyButton users={users.filter((u) => u.status === 'ACTIVE').map((u) => ({ id: u.id, username: u.username, full_name: u.full_name, hasKey: withKey.has(u.id) }))}>Generate key</GenerateKeyButton> : null}
      </Toolbar>
      <Card>
        <CardHead title="Web Service Access Keys" sub="The password an integration presents with the user's name in HTTP Basic authentication. One active key per user; generating a new one replaces the old." />
        {keys.length ? (
          <TableWrap>
            <thead><tr><th>User</th><th>Key</th><th>Scope</th><th>Status</th><th>Expires</th><th>Issued</th><th>Last used</th><th className="num" /></tr></thead>
            <tbody>
              {keys.map((k) => {
                const expired = !!k.expires_at && new Date(k.expires_at) < new Date();
                return (
                  <tr key={k.id}>
                    <td><b>{k.username}</b><div className="tiny muted-cell">{k.full_name}{k.user_status !== 'ACTIVE' ? ` · user ${k.user_status.toLowerCase()}` : ''}</div></td>
                    <td className="mono">••••••••{k.key_hint}</td>
                    <td>{k.scope === 'READ_ONLY' ? 'Read only' : 'Read & write'}
                      <div className="tiny muted-cell">{k.services ? k.services.split(',').join(', ') : 'all services'}{k.rate_limit_per_minute ? ` · ${k.rate_limit_per_minute}/min` : ''}</div></td>
                    <td><Pill tone={k.revoked_at ? 'bad' : expired ? 'warn' : 'ok'}>{k.revoked_at ? 'Revoked' : expired ? 'Expired' : 'Active'}</Pill></td>
                    <td>{k.expires_at ? k.expires_at.slice(0, 10) : 'Never'}</td>
                    <td>{formatDateTime(k.created_at)}<div className="tiny muted-cell">{k.created_by}</div></td>
                    <td>{k.last_used_at ? formatDateTime(k.last_used_at) : '—'}</td>
                    <td className="num">{canManage && !k.revoked_at ? <RevokeKeyButton id={k.id} username={k.username} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🔑" title="No access keys issued" sub="Generate a key for the user an integration will run as." />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------------------ Log */

export async function WebServiceLogTab() {
  const [rows, canManage] = await Promise.all([listWebServiceLog(300), currentCanAction('WEB_SERVICES_MANAGE')]);
  return (
    <>
      <Toolbar>
        <Spacer />
        {canManage && rows.length ? <ClearLogButton /> : null}
      </Toolbar>
      <Card>
        <CardHead title="Web Service Log" sub="The last 300 OData and SOAP requests — who called what, the HTTP status and how long it took" />
        {rows.length ? (
          <TableWrap>
            <thead><tr><th>When</th><th>Protocol</th><th>Method</th><th>Service</th><th>Operation</th><th>User</th><th>Status</th><th className="num">ms</th><th>Path / error</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="tiny">{formatDateTime(r.at)}</td>
                  <td>{r.protocol}</td>
                  <td className="mono">{r.method}</td>
                  <td className="mono">{r.service_name ?? '—'}</td>
                  <td>{r.operation ?? '—'}</td>
                  <td>{r.username ?? <span className="muted-cell">anonymous</span>}</td>
                  <td><Pill tone={r.status < 300 ? 'ok' : r.status < 500 ? 'warn' : 'bad'}>{r.status}</Pill></td>
                  <td className="num">{r.duration_ms}</td>
                  <td className="tiny mono" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.error ?? r.path}>{r.error ? <span style={{ color: 'var(--danger)' }}>{r.error}</span> : r.path}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📡" title="No calls yet" />}
      </Card>
    </>
  );
}
