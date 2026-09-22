'use client';

import { useQueryWriter } from '@/components/ui/filters';
import { StudentSelect, type StudentSelectOption } from '@/components/ui/student-select';

/** A student picker bound to the `student` query param — the Fee Statement's "whose statement". */
export function StudentPicker({ students, value, paramName = 'student' }: { students: StudentSelectOption[]; value: string; paramName?: string }) {
  const { write } = useQueryWriter();
  return (
    <div style={{ minWidth: 320 }}>
      <StudentSelect id="f_statement_student" name="_student" label="" students={students} value={value} onChange={(v) => write(paramName, v)} />
    </div>
  );
}
