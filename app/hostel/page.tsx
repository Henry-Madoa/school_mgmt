import Link from 'next/link';
import { requireAction, currentCanAction } from '@/lib/session';
import { listHostels, unallocatedBoarders } from '@/lib/hostel';
import { listActiveEmployees } from '@/lib/employees';
import { Page } from '@/components/layout/page';
import { Card, CardHead, EmptyState, Pill, Stat, TableWrap, Toolbar, Spacer } from '@/components/ui/primitives';
import { NewHostelButton } from './hostel-forms';

export default async function HostelPage() {
  const user = await requireAction('HOSTEL_READ');
  const [hostels, queue, canManage] = await Promise.all([listHostels(), unallocatedBoarders(), currentCanAction('HOSTEL_MANAGE')]);
  const beds = hostels.reduce((a, h) => a + h.beds, 0);
  const occupied = hostels.reduce((a, h) => a + h.occupied, 0);
  return (
    <Page title="Hostel" crumb="Boarding houses, their rooms and beds, and which boarder sleeps where" user={user}>
      <div className="grid g4">
        <Stat label="Houses" value={String(hostels.filter((h) => h.status === 'ACTIVE').length)} accent={false} />
        <Stat label="Beds in service" value={String(beds)} accent={false} foot={`${beds - occupied} free`} />
        <Stat label="Occupancy" value={beds ? `${Math.round((occupied / beds) * 100)}%` : '—'} accent={false} foot={`${occupied} boarders in beds`} />
        <Stat label="Boarders without a bed" value={String(queue.length)} accent={queue.length > 0} foot={queue.length ? 'Allocate from a house card' : 'Everyone is placed'} />
      </div>
      <Toolbar><Spacer />{canManage ? <NewHostelButton wardens={await listActiveEmployees()} /> : null}</Toolbar>
      <Card>
        {hostels.length ? (
          <TableWrap>
            <thead><tr><th>Code</th><th>House</th><th>Takes</th><th>Warden</th><th className="num">Rooms</th><th className="num">Beds</th><th className="num">Occupied</th><th className="num">Free</th><th>Status</th></tr></thead>
            <tbody>
              {hostels.map((h) => (
                <tr key={h.id} className={h.status === 'ACTIVE' ? undefined : 'muted'}>
                  <td className="mono"><Link href={`/hostel/${h.id}`}><b>{h.code}</b></Link></td>
                  <td><Link href={`/hostel/${h.id}`}>{h.name}</Link></td>
                  <td>{h.gender === 'MALE' ? 'Boys' : h.gender === 'FEMALE' ? 'Girls' : 'Mixed'}</td>
                  <td>{h.warden_name ?? <span className="muted-cell">—</span>}</td>
                  <td className="num">{h.rooms}</td>
                  <td className="num">{h.beds}</td>
                  <td className="num">{h.occupied}</td>
                  <td className="num">{h.beds - h.occupied}{h.beds && h.beds - h.occupied === 0 ? <Pill tone="warn">full</Pill> : null}</td>
                  <td><Pill status={h.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🛏" title="No hostels yet" sub="Create a house, add its rooms and beds, then allocate boarders." />}
      </Card>
      <Card>
        <CardHead title="Boarders without a bed" sub="Students marked Boarder on their card who have no active allocation" />
        {queue.length ? (
          <TableWrap>
            <thead><tr><th>Adm. No.</th><th>Student</th><th>Gender</th><th>Grade</th></tr></thead>
            <tbody>
              {queue.map((s) => (
                <tr key={s.id}>
                  <td className="mono"><Link href={`/students/view/${s.id}`}>{s.admission_no}</Link></td>
                  <td><b>{s.name}</b></td>
                  <td>{s.gender === 'MALE' ? 'Male' : s.gender === 'FEMALE' ? 'Female' : '—'}</td>
                  <td>{s.grade_level_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <div className="tiny muted-cell">Every boarder has a bed.</div>}
      </Card>
    </Page>
  );
}
