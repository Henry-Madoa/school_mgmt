'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field, MoneyInput } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useEditableCard } from '@/components/ui/editable-card';
import { useRunAction } from '@/components/ui/run-action';
import { useToast } from '@/components/ui/toast';
import { useRouter } from 'next/navigation';
import {
  saveDriverRequest, removeDriverRequest, saveBusRequest, saveRouteRequest, deleteRouteRequest, saveStopsRequest, openWorkTicketRequest, closeWorkTicketRequest, cancelWorkTicketRequest,
} from '@/app/actions/services';
import { today } from '@/lib/format';
import type { DriverView, SchoolBusView, TransportRouteView, TransportStop, WorkTicketView } from '@/lib/types';

type Emp = { id: number; employee_no: string; first_name: string; last_name: string; job_title?: string | null };
type Asset = { no: string; description: string; serial_no: string | null };
type RouteOpt = { id: number; code: string; name: string };

/* ------------------------------------------------------------------ drivers */

function DriverFields({ d }: { d?: DriverView | null }) {
  return (
    <>
      <div className="grid g3">
        <Field name="licence_no" label="Driving licence no." required uppercase defaultValue={d?.licence_no} />
        <Field name="licence_class" label="Licence class" defaultValue={d?.licence_class} placeholder="e.g. BCE / D1" />
        <Field name="licence_expiry" label="Licence expiry" type="date" defaultValue={d?.licence_expiry} />
      </div>
      <div className="grid g3">
        <Field name="psv_badge_no" label="PSV badge no." defaultValue={d?.psv_badge_no} uppercase />
        <Field name="psv_expiry" label="PSV badge expiry" type="date" defaultValue={d?.psv_expiry} />
        <Field name="notes" label="Notes" defaultValue={d?.notes} />
      </div>
    </>
  );
}

/** "Add a driver" — picks an employee (HR owns the record) and captures the licence. */
export function NewDriverButton({ employees, className = 'btn' }: { employees: Emp[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Add a driver</button>
      {open ? (
        <FormModal title="Add a driver" onClose={() => setOpen(false)} onSubmit={saveDriverRequest} successTitle="Driver added" redirectTo={() => `/transport/drivers/${employeeId}`}>
          <SearchableSelect id="f_driver_emp" name="employee_id" label="Employee" required items={employees} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}${e.job_title ? ` (${e.job_title})` : ''}`}
            value={employeeId} onChange={setEmployeeId} placeholder="Search staff…" emptyText="Every active employee already has a driver profile" hint="Drivers are onboarded under HR › Employees first; this adds their road credentials." />
          <DriverFields />
        </FormModal>
      ) : null}
    </>
  );
}

export function DriverEditForm({ driver }: { driver: DriverView }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title="" onClose={close} onSubmit={saveDriverRequest} submitLabel="Save changes" successTitle="Driver updated">
      <input type="hidden" name="employee_id" value={driver.employee_id} />
      <DriverFields d={driver} />
    </FormModal>
  );
}

export function RemoveDriverButton({ employeeId }: { employeeId: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn ghost" disabled={busy} onClick={() => run(() => removeDriverRequest(employeeId), { confirm: { title: 'Remove the driver profile?', message: 'The HR record stays. Refused while the driver is assigned to a bus or has an open work ticket.', confirmLabel: 'Remove', danger: true }, successTitle: 'Driver profile removed', redirectTo: '/transport/drivers' })}>{busy ? 'Removing…' : 'Remove driver profile'}</button>;
}

/* -------------------------------------------------------------------- buses */

function BusFields({ b, assets, drivers, routes }: { b?: SchoolBusView | null; assets: Asset[]; drivers: DriverView[]; routes: RouteOpt[] }) {
  const [assetNo, setAssetNo] = useState(b?.fixed_asset_no ?? '');
  const [driverId, setDriverId] = useState(String(b?.driver_employee_id ?? ''));
  const assetItems = b ? [{ no: b.fixed_asset_no, description: b.asset_description, serial_no: null }, ...assets] : assets;
  return (
    <>
      <div className="grid g2">
        <SearchableSelect id="f_bus_asset" name="fixed_asset_no" label="Fixed asset (vehicle)" required items={assetItems} getValue={(a) => a.no} getLabel={(a) => `${a.no} — ${a.description}`}
          value={assetNo} onChange={setAssetNo} placeholder="Search the VEHICLES class of the FA register…" emptyText="No unassigned vehicles in the Fixed Asset register" hint="The bus is a fixed asset first — cost and depreciation live there" />
        <SearchableSelect id="f_bus_driver" name="driver_employee_id" label="Assigned driver" items={drivers} getValue={(d) => String(d.employee_id)} getLabel={(d) => `${d.employee_no} — ${d.first_name} ${d.last_name}`}
          value={driverId} onChange={setDriverId} placeholder="Search drivers…" emptyText="No drivers — add one under Drivers" />
      </div>
      <div className="grid g4">
        <Field name="registration_no" label="Registration" required uppercase defaultValue={b?.registration_no} placeholder="KDA 123A" />
        <Field name="make_model" label="Make / model" defaultValue={b?.make_model} placeholder="Toyota Coaster" />
        <Field name="capacity" label="Seats" type="number" min={1} required defaultValue={b?.capacity ?? ''} />
        <Field name="route_id" label="Route" type="select" defaultValue={b?.route_id ?? ''} options={[{ value: '', label: '— none —' }, ...routes.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))]} />
      </div>
      <div className="grid g4">
        <Field name="status" label="Status" type="select" defaultValue={b?.status ?? 'ACTIVE'} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'WORKSHOP', label: 'In the workshop' }, { value: 'RETIRED', label: 'Retired' }]} />
        <Field name="insurance_expiry" label="Insurance expiry" type="date" defaultValue={b?.insurance_expiry} />
        <Field name="inspection_expiry" label="Inspection expiry" type="date" defaultValue={b?.inspection_expiry} />
        <Field name="odometer" label="Odometer (km)" type="number" min={0} defaultValue={b?.odometer ?? 0} />
      </div>
      <Field name="notes" label="Notes" defaultValue={b?.notes} />
    </>
  );
}

export function NewBusButton({ assets, drivers, routes, className = 'btn' }: { assets: Asset[]; drivers: DriverView[]; routes: RouteOpt[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Add a bus</button>
      {open ? (
        <FormModal title="Add a bus" wide onClose={() => setOpen(false)} onSubmit={saveBusRequest} successTitle="Bus added" redirectTo={(d) => `/transport/buses/${d.id}`}>
          <BusFields assets={assets} drivers={drivers} routes={routes} />
        </FormModal>
      ) : null}
    </>
  );
}

export function BusEditForm({ bus, assets, drivers, routes }: { bus: SchoolBusView; assets: Asset[]; drivers: DriverView[]; routes: RouteOpt[] }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title="" onClose={close} onSubmit={(v) => saveBusRequest({ ...v, id: bus.id })} submitLabel="Save changes" successTitle="Bus updated">
      <BusFields b={bus} assets={assets} drivers={drivers} routes={routes} />
    </FormModal>
  );
}

/* ------------------------------------------------------------------- routes */

function RouteFields({ r }: { r?: TransportRouteView | null }) {
  const [fare, setFare] = useState(r?.term_fare ? String(Number(r.term_fare) / 100) : '');
  return (
    <>
      <div className="grid g4">
        <Field name="code" label="Code" required uppercase defaultValue={r?.code} placeholder="R1" />
        <Field name="name" label="Name" required defaultValue={r?.name} placeholder="Kiambu Road" />
        <div className="field">
          <label htmlFor="f_route_fare">Termly fare override</label>
          <MoneyInput id="f_route_fare" name="term_fare" value={fare} onChange={setFare} placeholder="0.00" />
          <div className="hint">Blank / 0 = the fee structure's TRANSPORT amount for the student's grade</div>
        </div>
        <Field name="status" label="Status" type="select" defaultValue={r?.status ?? 'ACTIVE'} options={['ACTIVE', 'INACTIVE']} />
      </div>
      <Field name="description" label="Description" defaultValue={r?.description} placeholder="Areas served, notes for the driver" />
    </>
  );
}

export function NewRouteButton({ className = 'btn' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>New route</button>
      {open ? (
        <FormModal title="New route" wide onClose={() => setOpen(false)} onSubmit={saveRouteRequest} successTitle="Route created" redirectTo={(d) => `/transport/routes/${d.id}`}>
          <RouteFields />
        </FormModal>
      ) : null}
    </>
  );
}

export function RouteEditForm({ route }: { route: TransportRouteView }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title="" onClose={close} onSubmit={(v) => saveRouteRequest({ ...v, id: route.id })} submitLabel="Save changes" successTitle="Route updated">
      <RouteFields r={route} />
    </FormModal>
  );
}

export function DeleteRouteButton({ id }: { id: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn ghost" disabled={busy} onClick={() => run(() => deleteRouteRequest(id), { confirm: { title: 'Delete this route?', message: 'Refused while students ride it. Buses on it are unassigned.', confirmLabel: 'Delete', danger: true }, successTitle: 'Route deleted', redirectTo: '/transport/routes' })}>{busy ? 'Deleting…' : 'Delete route'}</button>;
}

/** The stops along a route — edited in place as a small table. */
export function StopsEditor({ routeId, stops, canEdit }: { routeId: number; stops: TransportStop[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(stops.map((s) => ({ id: s.id, name: s.name, pickupTime: s.pickup_time ?? '', dropoffTime: s.dropoff_time ?? '' })));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (i: number, k: 'name' | 'pickupTime' | 'dropoffTime', v: string) => setRows(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    setBusy(true);
    try {
      const res = await saveStopsRequest(routeId, rows);
      if (!res.ok) { toast('Could not save the stops', res.error, 'err'); return; }
      toast('Stops saved', `${res.data.saved} stop${res.data.saved === 1 ? '' : 's'}`, 'ok');
      setEditing(false); router.refresh();
    } finally { setBusy(false); }
  };
  if (!editing) {
    return (
      <>
        {stops.length ? (
          <table><thead><tr><th>#</th><th>Stop</th><th>Pick-up</th><th>Drop-off</th></tr></thead>
            <tbody>{stops.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td><b>{s.name}</b></td><td className="mono">{s.pickup_time ?? '—'}</td><td className="mono">{s.dropoff_time ?? '—'}</td></tr>)}</tbody></table>
        ) : <div className="tiny muted-cell">No stops yet.</div>}
        {canEdit ? <button type="button" className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>Edit stops</button> : null}
      </>
    );
  }
  return (
    <>
      <table>
        <thead><tr><th>#</th><th>Stop</th><th style={{ width: 120 }}>Pick-up</th><th style={{ width: 120 }}>Drop-off</th><th style={{ width: 80 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td><input type="text" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} aria-label="Stop" style={{ width: '100%' }} /></td>
              <td><input type="time" value={r.pickupTime} onChange={(e) => set(i, 'pickupTime', e.target.value)} aria-label="Pick-up" /></td>
              <td><input type="time" value={r.dropoffTime} onChange={(e) => set(i, 'dropoffTime', e.target.value)} aria-label="Drop-off" /></td>
              <td>
                <button type="button" className="btn sm ghost" aria-label="Move up" disabled={i === 0} onClick={() => { const n = [...rows]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setRows(n); }}>↑</button>
                <button type="button" className="btn sm ghost" aria-label="Remove" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline" style={{ gap: 6, marginTop: 8 }}>
        <button type="button" className="btn sm ghost" onClick={() => setRows([...rows, { id: null as unknown as number, name: '', pickupTime: '', dropoffTime: '' }])}>Add stop</button>
        <span className="spacer" />
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => { setRows(stops.map((s) => ({ id: s.id, name: s.name, pickupTime: s.pickup_time ?? '', dropoffTime: s.dropoff_time ?? '' }))); setEditing(false); }}>Cancel</button>
        <button type="button" className="btn sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save stops'}</button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ work tickets */

export function OpenWorkTicketButton({ buses, drivers, routes, defaultBusId, className = 'btn' }: { buses: SchoolBusView[]; drivers: DriverView[]; routes: RouteOpt[]; defaultBusId?: number | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const [busId, setBusId] = useState(String(defaultBusId ?? ''));
  const [purpose, setPurpose] = useState('ROUTE_RUN');
  const bus = buses.find((b) => String(b.id) === busId);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Open a work ticket</button>
      {open ? (
        <FormModal title="Open a work ticket" wide onClose={() => setOpen(false)} onSubmit={openWorkTicketRequest} submitLabel="Issue ticket" successTitle="Work ticket issued" successDetail={(d) => d.no} redirectTo={(d) => `/transport/work-tickets/${encodeURIComponent(d.no)}`}>
          <div className="grid g3">
            <Field name="bus_id" label="Bus" type="select" required defaultValue={busId} options={[{ value: '', label: 'Pick a bus…' }, ...buses.filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.id, label: `${b.registration_no}${b.driver_name ? ` · ${b.driver_name}` : ''}${b.open_tickets ? ' (ticket open)' : ''}` }))]} onChange={(e) => setBusId(e.target.value)} />
            <Field name="driver_employee_id" label="Driver" type="select" defaultValue={bus?.driver_employee_id ?? ''} options={[{ value: '', label: bus?.driver_name ? `Assigned driver — ${bus.driver_name}` : 'Pick a driver…' }, ...drivers.map((d) => ({ value: d.employee_id, label: `${d.first_name} ${d.last_name}` }))]} />
            <Field name="date" label="Date" type="date" required defaultValue={today()} />
          </div>
          <div className="grid g3">
            <Field name="purpose" label="Purpose" type="select" defaultValue={purpose} options={[{ value: 'ROUTE_RUN', label: 'Route run (pick-up / drop-off)' }, { value: 'TRIP', label: 'Trip / outing' }, { value: 'MAINTENANCE', label: 'Workshop / maintenance' }]} onChange={(e) => setPurpose(e.target.value)} />
            {purpose === 'ROUTE_RUN' ? <Field name="route_id" label="Route" type="select" defaultValue={bus?.route_id ?? ''} options={[{ value: '', label: bus?.route_name ? `Bus's route — ${bus.route_name}` : '— none —' }, ...routes.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))]} />
              : <Field name="destination" label="Destination" required={purpose === 'TRIP'} placeholder={purpose === 'TRIP' ? 'e.g. National Museum, Nairobi' : 'e.g. Toyota Kenya service centre'} />}
            <Field name="odometer_start" label="Odometer out (km)" type="number" min={0} defaultValue={bus?.odometer ?? ''} hint={bus ? `Last reading ${bus.odometer} km` : undefined} />
          </div>
          <Field name="remarks" label="Remarks" defaultValue="" />
        </FormModal>
      ) : null}
    </>
  );
}

/** Close on return — inline on the ticket card. */
export function CloseWorkTicketPanel({ ticket }: { ticket: WorkTicketView }) {
  const [open, setOpen] = useState(false);
  const [fuel, setFuel] = useState('');
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>Close on return…</button>;
  return (
    <div style={{ width: '100%' }}>
      <FormModal inline title="" onClose={() => setOpen(false)} onSubmit={(v) => closeWorkTicketRequest(ticket.no, v)} submitLabel="Close ticket" resultStyle="popup" successTitle="Work ticket closed" successDetail={(d) => `${d.distance} km on this ticket`}>
        <div className="grid g4">
          <Field name="odometer_end" label="Odometer in (km)" type="number" min={ticket.odometer_start ?? 0} required defaultValue={ticket.odometer_start ?? ''} hint={`Out at ${ticket.odometer_start ?? 0} km`} />
          <Field name="fuel_litres" label="Fuel taken (litres)" type="number" step="0.1" min={0} defaultValue="" />
          <div className="field"><label htmlFor="f_fuel_cost">Fuel cost</label><MoneyInput id="f_fuel_cost" name="fuel_cost" value={fuel} onChange={setFuel} placeholder="0.00" /><div className="hint">Paid through petty cash / a voucher as usual; recorded here for the fleet report</div></div>
          <Field name="remarks" label="Remarks" defaultValue="" />
        </div>
      </FormModal>
    </div>
  );
}

export function CancelWorkTicketButton({ no }: { no: string }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn ghost" disabled={busy} onClick={() => run(() => cancelWorkTicketRequest(no, 'Cancelled'), { confirm: { title: `Cancel ${no}?`, message: 'The bus did not go out on this ticket.', confirmLabel: 'Cancel ticket', danger: true }, successTitle: 'Work ticket cancelled' })}>{busy ? '…' : 'Cancel ticket'}</button>;
}
