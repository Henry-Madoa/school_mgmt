import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAction, currentCanAction } from '@/lib/session';
import { getHostel, listRooms, listBeds, unallocatedBoarders } from '@/lib/hostel';
import { listActiveEmployees } from '@/lib/employees';
import { Page } from '@/components/layout/page';
import { Card, CardHead, DefinitionList, EmptyState, Pill, Stat, Toolbar, Spacer } from '@/components/ui/primitives';
import { EditableCard } from '@/components/ui/editable-card';
import { HostelEditForm, AddRoomPanel, RoomRow } from '../hostel-forms';

export default async function HostelCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAction('HOSTEL_READ');
  const { id: idParam } = await params;
  const id = Number(idParam);
  const hostel = await getHostel(id);
  if (!hostel) notFound();
  const [rooms, beds, boardersAll, canManage, wardens] = await Promise.all([listRooms(id), listBeds(id), unallocatedBoarders(), currentCanAction('HOSTEL_MANAGE'), listActiveEmployees()]);
  // A boys' house only offers boys, a girls' house girls; a mixed house anyone.
  const boarders = boardersAll.filter((s) => hostel.gender === 'MIXED' || !s.gender || s.gender === hostel.gender);
  const free = beds.filter((b) => !b.allocation_id && b.status === 'AVAILABLE').length;
  const oos = beds.filter((b) => b.status === 'OUT_OF_SERVICE').length;

  return (
    <Page title={`${hostel.code} — ${hostel.name}`} crumb={`${hostel.gender === 'MALE' ? 'Boys’' : hostel.gender === 'FEMALE' ? 'Girls’' : 'Mixed'} house · ${rooms.length} room${rooms.length === 1 ? '' : 's'}`} user={user}>
      <Toolbar><Link href="/hostel" className="btn ghost sm">← All houses</Link><Spacer /></Toolbar>
      <div className="grid g4">
        <Stat label="Beds" value={String(hostel.beds)} accent={false} foot={oos ? `${oos} out of service` : undefined} />
        <Stat label="Occupied" value={String(hostel.occupied)} accent={false} />
        <Stat label="Free" value={String(free)} accent={free === 0 && hostel.beds > 0} foot={free === 0 && hostel.beds ? 'House is full' : undefined} />
        <Stat label="Waiting" value={String(boarders.length)} accent={boarders.length > 0} foot="Boarders this house could take" />
      </div>
      <EditableCard title="House" sub="The code, who it takes and the warden the boarders answer to" canEdit={canManage} form={<HostelEditForm hostel={hostel} wardens={wardens} />}>
        <div className="grid g2 dl-groups">
          <section className="dl-group">
            <DefinitionList items={[['Code', <span className="mono" key="c">{hostel.code}</span>], ['Name', hostel.name], ['Takes', hostel.gender === 'MALE' ? 'Boys' : hostel.gender === 'FEMALE' ? 'Girls' : 'Mixed']]} />
          </section>
          <section className="dl-group">
            <DefinitionList items={[
              ['Warden', hostel.warden_name ? <Link href={`/employees/view/${hostel.warden_employee_id}`} key="w">{hostel.warden_name}</Link> : '—'],
              ['Status', <Pill key="s" status={hostel.status} />], ['Notes', hostel.notes ?? '—'],
            ]} />
          </section>
        </div>
      </EditableCard>
      <Card>
        <CardHead title="Rooms and beds" sub="Click a free bed to allocate a boarder; vacate from the bed. Allocations are history, not overwrites." />
        {rooms.length ? rooms.map((r) => <RoomRow key={r.id} room={r} beds={beds.filter((b) => b.room_id === r.id)} boarders={boarders} canManage={canManage} />) : <EmptyState icon="🚪" title="No rooms yet" sub="Add a room and say how many beds it has." />}
        {canManage ? <div style={{ marginTop: 8 }}><AddRoomPanel hostelId={id} /></div> : null}
      </Card>
    </Page>
  );
}
