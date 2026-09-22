'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useEditableCard } from '@/components/ui/editable-card';
import { useRunAction } from '@/components/ui/run-action';
import { saveHostelRequest, saveRoomRequest, deleteRoomRequest, setBedStatusRequest, allocateBedRequest, vacateBedRequest } from '@/app/actions/services';
import { today } from '@/lib/format';
import type { HostelView, HostelRoom, BedView } from '@/lib/types';

type Emp = { id: number; employee_no: string; first_name: string; last_name: string };
type Boarder = { id: number; admission_no: string; name: string; gender: string | null; grade_level_name: string | null };

const GENDERS = [{ value: 'MALE', label: 'Boys' }, { value: 'FEMALE', label: 'Girls' }, { value: 'MIXED', label: 'Mixed' }];

function HostelFields({ h, wardens }: { h?: HostelView | null; wardens: Emp[] }) {
  const [warden, setWarden] = useState(String(h?.warden_employee_id ?? ''));
  return (
    <>
      <div className="grid g3">
        <Field name="code" label="Code" required uppercase defaultValue={h?.code} placeholder="e.g. KIL" />
        <Field name="name" label="Name" required defaultValue={h?.name} placeholder="e.g. Kilimanjaro House" />
        <Field name="gender" label="Takes" type="select" defaultValue={h?.gender ?? 'MIXED'} options={GENDERS} />
      </div>
      <div className="grid g3">
        <SearchableSelect id={`f_warden_${h?.id ?? 'new'}`} name="warden_employee_id" label="Warden / house parent" items={wardens} getValue={(e) => String(e.id)} getLabel={(e) => `${e.employee_no} — ${e.first_name} ${e.last_name}`} value={warden} onChange={setWarden} placeholder="Search staff…" />
        <Field name="status" label="Status" type="select" defaultValue={h?.status ?? 'ACTIVE'} options={['ACTIVE', 'INACTIVE']} />
        <Field name="notes" label="Notes" defaultValue={h?.notes} />
      </div>
    </>
  );
}

export function NewHostelButton({ wardens, className = 'btn' }: { wardens: Emp[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>New hostel</button>
      {open ? (
        <FormModal title="New hostel" wide onClose={() => setOpen(false)} onSubmit={saveHostelRequest} successTitle="Hostel created" redirectTo={(d) => `/hostel/${d.id}`}>
          <HostelFields wardens={wardens} />
        </FormModal>
      ) : null}
    </>
  );
}

export function HostelEditForm({ hostel, wardens }: { hostel: HostelView; wardens: Emp[] }) {
  const { close } = useEditableCard();
  return (
    <FormModal inline title="" onClose={close} onSubmit={(v) => saveHostelRequest({ ...v, id: hostel.id })} submitLabel="Save changes" successTitle="Hostel updated">
      <HostelFields h={hostel} wardens={wardens} />
    </FormModal>
  );
}

/* -------------------------------------------------------------------- rooms */

/** Adds a room with N beds, inline under the rooms table. */
export function AddRoomPanel({ hostelId }: { hostelId: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)}>Add a room</button>;
  return (
    <div style={{ width: '100%' }}>
      <FormModal inline title="" onClose={() => setOpen(false)} onSubmit={(v) => saveRoomRequest(hostelId, v)} submitLabel="Add room" resultStyle="popup" successTitle="Room added">
        <div className="grid g3">
          <Field name="name" label="Room" required placeholder="e.g. Room 1 / Dorm A" />
          <Field name="floor" label="Floor / wing" placeholder="e.g. Ground" />
          <Field name="beds" label="Beds" type="number" min={0} required defaultValue={8} hint="Beds are numbered 1…N" />
        </div>
      </FormModal>
    </div>
  );
}

/** Rename a room or grow it — inline on the room's row. */
export function RoomEditForm({ room, beds, onDone }: { room: HostelRoom; beds: number; onDone: () => void }) {
  return (
    <FormModal inline title="" onClose={onDone} onSubmit={(v) => saveRoomRequest(room.hostel_id, { ...v, id: room.id })} submitLabel="Save" resultStyle="popup" successTitle="Room updated">
      <div className="grid g3">
        <Field name="name" label="Room" required defaultValue={room.name} />
        <Field name="floor" label="Floor / wing" defaultValue={room.floor} />
        <Field name="beds" label="Beds" type="number" min={beds} defaultValue={beds} hint="Can only grow — take a bed out of service instead" />
      </div>
    </FormModal>
  );
}

export function DeleteRoomButton({ roomId }: { roomId: number }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => deleteRoomRequest(roomId), { confirm: { title: 'Delete this room?', message: 'Its beds and their history go with it. Refused while anyone is allocated a bed in it.', confirmLabel: 'Delete', danger: true }, successTitle: 'Room deleted' })}>{busy ? '…' : 'Delete'}</button>;
}

/* --------------------------------------------------------------------- beds */

/** One bed tile: occupant or "free", with allocate / vacate / out-of-service done in place. */
export function BedTile({ bed, boarders, canManage }: { bed: BedView; boarders: Boarder[]; canManage: boolean }) {
  const [allocating, setAllocating] = useState(false);
  const [studentId, setStudentId] = useState('');
  const { run, busy } = useRunAction();
  const occupied = !!bed.allocation_id;
  const oos = bed.status === 'OUT_OF_SERVICE';
  return (
    <div className={`card ${occupied ? '' : oos ? 'muted' : ''}`} style={{ padding: 10, margin: 0, borderLeft: `4px solid ${occupied ? 'var(--accent)' : oos ? 'var(--danger)' : 'var(--ok, #2a9d5c)'}` }}>
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <b>Bed {bed.label}</b>
        <span className="tiny">{occupied ? 'Occupied' : oos ? 'Out of service' : 'Free'}</span>
      </div>
      {occupied ? (
        <div style={{ marginTop: 4 }}>
          <a href={`/students/view/${bed.student_id}`}>{bed.student_name}</a>
          <div className="tiny mono">{bed.admission_no} · {bed.grade_level_name ?? ''}{bed.since ? ` · since ${bed.since}` : ''}</div>
          {canManage ? <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} disabled={busy} onClick={() => run(() => vacateBedRequest(bed.allocation_id!, today()), { confirm: { title: `Vacate bed ${bed.label}?`, message: `${bed.student_name} leaves the bed today.`, confirmLabel: 'Vacate' }, successTitle: 'Bed vacated' })}>{busy ? '…' : 'Vacate'}</button> : null}
        </div>
      ) : allocating ? (
        <div style={{ marginTop: 6 }}>
          <FormModal inline title="" onClose={() => setAllocating(false)} onSubmit={(v) => allocateBedRequest(bed.id, v)} submitLabel="Allocate" resultStyle="popup" successTitle="Bed allocated">
            <SearchableSelect id={`f_bed_${bed.id}`} name="student_id" label="Boarder" required items={boarders} getValue={(s) => String(s.id)} getLabel={(s) => `${s.admission_no} — ${s.name}${s.grade_level_name ? ` (${s.grade_level_name})` : ''}`} value={studentId} onChange={setStudentId} placeholder="Search boarders without a bed…" emptyText="Every boarder has a bed" />
            <Field name="from_date" label="From" type="date" required defaultValue={today()} />
          </FormModal>
        </div>
      ) : canManage ? (
        <div className="inline" style={{ gap: 4, marginTop: 6 }}>
          {!oos ? <button type="button" className="btn sm" onClick={() => setAllocating(true)}>Allocate</button> : null}
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => setBedStatusRequest(bed.id, oos ? 'AVAILABLE' : 'OUT_OF_SERVICE'), { successTitle: oos ? 'Bed back in service' : 'Bed taken out of service' })}>{oos ? 'Back in service' : 'Out of service'}</button>
        </div>
      ) : null}
    </div>
  );
}

export function RoomRow({ room, beds, boarders, canManage }: { room: HostelRoom; beds: BedView[]; boarders: Boarder[]; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const occupied = beds.filter((b) => b.allocation_id).length;
  return (
    <section style={{ marginBottom: 16 }}>
      <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div><b>{room.name}</b>{room.floor ? <span className="tiny"> · {room.floor}</span> : null} <span className="tiny">· {occupied}/{beds.length} beds taken</span></div>
        {canManage && !editing ? <div className="inline" style={{ gap: 4 }}><button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>Edit</button><DeleteRoomButton roomId={room.id} /></div> : null}
      </div>
      {editing ? <RoomEditForm room={room} beds={beds.length} onDone={() => setEditing(false)} /> : null}
      <div className="grid g4">
        {beds.map((b) => <BedTile key={b.id} bed={b} boarders={boarders} canManage={canManage} />)}
      </div>
    </section>
  );
}

/** On the student card: allocate a bed from the boarder's side. */
export function StudentBedForm({ studentId, freeBeds, onDone }: { studentId: number; freeBeds: BedView[]; onDone: () => void }) {
  const [bedId, setBedId] = useState('');
  return (
    <FormModal inline title="" onClose={onDone} onSubmit={(v) => allocateBedRequest(Number(bedId), { ...v, student_id: studentId })} submitLabel="Allocate bed" resultStyle="popup" successTitle="Bed allocated">
      <div className="grid g2">
        <SearchableSelect id={`f_stubed_${studentId}`} name="bed_id" label="Bed" required items={freeBeds} getValue={(b) => String(b.id)} getLabel={(b) => `${b.hostel_name} · ${b.room_name} · Bed ${b.label}`} value={bedId} onChange={setBedId} placeholder="Search free beds…" emptyText="No free bed — add rooms under Hostel" />
        <Field name="from_date" label="From" type="date" required defaultValue={today()} />
      </div>
    </FormModal>
  );
}

export function VacateBedButton({ allocationId, label }: { allocationId: number; label: string }) {
  const { run, busy } = useRunAction();
  return <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => vacateBedRequest(allocationId, today()), { confirm: { title: `Vacate ${label}?`, message: 'The bed is freed from today; the allocation stays in the history.', confirmLabel: 'Vacate' }, successTitle: 'Bed vacated' })}>{busy ? '…' : 'Vacate'}</button>;
}
