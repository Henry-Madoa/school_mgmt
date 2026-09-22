'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useRunAction } from '@/components/ui/run-action';
import { useToast } from '@/components/ui/toast';
import {
  createWebServiceRequest, updateWebServiceRequest, setWebServicePublishedRequest, deleteWebServiceRequest,
  generateAccessKeyRequest, revokeAccessKeyRequest, clearWebServiceLogRequest,
} from '@/app/actions/webServices';
import type { ActionResult, WebService } from '@/lib/types';

/** A publishable object as the New form lists it (plain data — the registry itself stays server-side). */
export interface PublishableObject { value: string; type: string; id: number; name: string; caption: string; defaultServiceName: string }

export function WebServiceFormButton({ service, objects, className = 'btn', children }: {
  service?: WebService | null; objects: PublishableObject[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [object, setObject] = useState('');
  const [serviceName, setServiceName] = useState(service?.service_name ?? '');
  const s = service ?? null;
  const pick = (v: string) => {
    setObject(v);
    const o = objects.find((x) => x.value === v);
    if (o && !serviceName) setServiceName(o.defaultServiceName);
  };
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title={s ? `Edit ${s.service_name}` : 'New web service'}
          onClose={() => setOpen(false)}
          onSubmit={async (values): Promise<ActionResult<unknown>> => (s ? updateWebServiceRequest(s.id, values) : createWebServiceRequest(values))}
          submitLabel={s ? 'Save changes' : 'Register'}
          successTitle={s ? 'Web service updated' : 'Web service registered'}
          successDetail={s ? undefined : 'Open the service to see its OData and SOAP endpoints.'}
        >
          {s ? (
            <div className="note" style={{ marginBottom: 'var(--sp)' }}>{s.object_type} {s.object_id} — {s.object_name}</div>
          ) : (
            <SearchableSelect id="f_object" name="object" label="Object" required items={objects}
              getValue={(o) => o.value} getLabel={(o) => `${o.type} ${o.id} · ${o.name}`} value={object} onChange={pick}
              placeholder="Search page, query or codeunit…" emptyText="Every object is already registered"
              hint="Pages expose records (read, and where allowed create/update/delete); queries are read-only datasets; codeunits expose procedures" />
          )}
          <Field name="service_name" label="Service Name" required defaultValue={serviceName} onChange={(e) => setServiceName(e.target.value)}
            hint="The URL segment: letters, digits and underscores — e.g. Students → /ODataV4/Students and /WS/Page/Students" />
          <Field name="description" label="Description" defaultValue={s?.description ?? ''} />
          <Field name="published" label="Published" type="checkbox" defaultValue={s ? (s.published ? 1 : 0) : 1}
            hint="Only a published service answers requests" />
        </FormModal>
      ) : null}
    </>
  );
}

export function PublishToggleButton({ service, className = 'btn sm ghost' }: { service: WebService; className?: string }) {
  const { run, busy } = useRunAction();
  const next = !service.published;
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => setWebServicePublishedRequest(service.id, next), { successTitle: next ? `${service.service_name} published` : `${service.service_name} unpublished` })}>
      {busy ? 'Working…' : next ? 'Publish' : 'Unpublish'}
    </button>
  );
}

export function DeleteWebServiceButton({ service, className = 'btn sm ghost' }: { service: WebService; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => deleteWebServiceRequest(service.id), {
        confirm: { title: `Delete web service ${service.service_name}?`, message: 'Integrations calling this endpoint will start getting 404 Not Found.', confirmLabel: 'Delete', danger: true },
        successTitle: 'Deleted', redirectTo: '/admin/data/web-services',
      })}>
      {busy ? 'Working…' : 'Delete'}
    </button>
  );
}

export function GenerateKeyButton({ users, className = 'btn', children }: {
  users: { id: number; username: string; full_name: string; hasKey: boolean }[]; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [issued, setIssued] = useState<{ key: string; user: string } | null>(null);
  const toast = useToast();
  const chosen = users.find((u) => String(u.id) === userId);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <FormModal
          title="Generate Web Service Access Key"
          onClose={() => setOpen(false)}
          onSubmit={async (values) => {
            const res = await generateAccessKeyRequest(values);
            if (res.ok) setIssued({ key: res.data.key, user: chosen?.username ?? '' });
            return res;
          }}
          submitLabel="Generate key"
          successTitle="Key generated"
          successDetail={() => 'Copy it now — it is shown only once.'}
        >
          <SearchableSelect id="f_user" name="user_id" label="User" required items={users}
            getValue={(u) => String(u.id)} getLabel={(u) => `${u.username} — ${u.full_name}${u.hasKey ? ' (has a key — will be replaced)' : ''}`}
            value={userId} onChange={setUserId} placeholder="Search user…"
            hint="Calls made with the key run with this user's permissions; give integrations their own user" />
          <div className="grid g2">
            <Field name="scope" label="Scope" type="select" defaultValue="READ_WRITE"
              options={[{ value: 'READ_WRITE', label: 'Read and write' }, { value: 'READ_ONLY', label: 'Read only' }]}
              hint="Read only refuses every create, modify, delete and posting call, whatever the user may do" />
            <Field name="expires_at" label="Expiry date" type="date" hint="Leave blank for a key that never expires" />
          </div>
          <Field name="services" label="Limit to services" placeholder="e.g. Students, FeeBalances"
            hint="Comma-separated service names the key may call; blank = every published service" />
          <Field name="rate_limit_per_minute" label="Requests per minute" type="number" min={1} placeholder="unlimited"
            hint="The key's own throttle, on top of the per-address limits" />
        </FormModal>
      ) : null}
      {issued ? (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label="Web Service Access Key">
          <div className="modal">
            <h3 style={{ marginTop: 0 }}>Web Service Access Key for {issued.user}</h3>
            <p className="tiny muted-cell">This is the only time the key is shown. Store it in the integration's configuration; a lost key is replaced by generating a new one.</p>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>{issued.key}</pre>
            <p className="tiny muted-cell">HTTP Basic authentication: username <b>{issued.user}</b>, password = this key.</p>
            <div className="inline" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn ghost" onClick={async () => { try { await navigator.clipboard.writeText(issued.key); toast('Key copied', undefined, 'ok'); } catch { /* clipboard unavailable */ } }}>Copy</button>
              <button type="button" className="btn" onClick={() => setIssued(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function RevokeKeyButton({ id, username, className = 'btn sm ghost' }: { id: number; username: string; className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => revokeAccessKeyRequest(id), {
        confirm: { title: `Revoke ${username}'s key?`, message: 'Every integration using it will be refused from now on.', confirmLabel: 'Revoke', danger: true },
        successTitle: 'Key revoked',
      })}>
      {busy ? 'Working…' : 'Revoke'}
    </button>
  );
}

export function ClearLogButton({ className = 'btn sm ghost' }: { className?: string }) {
  const { run, busy } = useRunAction();
  return (
    <button type="button" className={className} disabled={busy}
      onClick={() => run(() => clearWebServiceLogRequest(), { confirm: { title: 'Clear the web service log?', confirmLabel: 'Clear', danger: true }, successTitle: 'Log cleared' })}>
      {busy ? 'Working…' : 'Clear log'}
    </button>
  );
}

/** A copy-to-clipboard affordance next to an endpoint URL or sample. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button type="button" className="btn sm ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Copied', undefined, 'ok'); } catch { /* clipboard unavailable */ } }}>
      {label}
    </button>
  );
}
