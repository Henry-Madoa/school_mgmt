'use client';

import { useQueryWriter } from '@/components/ui/filters';
import type { StudentListRow } from '@/lib/types';

/** A parent with more than one child on the roll switches between them here. */
export function ChildPicker({ students, value }: { students: StudentListRow[]; value: string }) {
  const { write } = useQueryWriter();
  return (
    <select aria-label="Student" value={value} onChange={(e) => write('student', e.target.value)}>
      {students.map((s) => <option key={s.id} value={String(s.id)}>{s.first_name} {s.last_name} — {s.grade_level_name} {s.stream_name}</option>)}
    </select>
  );
}
