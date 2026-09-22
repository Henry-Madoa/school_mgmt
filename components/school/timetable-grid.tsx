import type { ReactNode } from 'react';
import { DAY_NAMES } from '@/lib/constants';
import type { TimetableSlotView } from '@/lib/types';

/**
 * A week's timetable as a grid — periods down the side (every distinct start–end pair on file),
 * days across. Shown for a class (cells name the subject and teacher), a teacher (cells name the
 * class) and the portals. Pure rendering; the editable Timetable page wraps each cell with its
 * own controls through `cell`.
 */
export function TimetableGrid({ slots, focus, cell, emptyCell }: {
  slots: TimetableSlotView[];
  /** What the cell leads with: the subject (a class's timetable) or the class (a teacher's). */
  focus: 'stream' | 'teacher';
  /** Optional wrapper for a filled cell's content (e.g. the edit controls). */
  cell?: (slot: TimetableSlotView) => ReactNode;
  /** Optional content for an empty cell (e.g. an "add" button) — gets the day and period. */
  emptyCell?: (day: number, start: string, end: string) => ReactNode;
}) {
  const days = [1, 2, 3, 4, 5, ...(slots.some((s) => s.day_of_week >= 6) ? [6] : [])];
  const periods = [...new Map(slots.map((s) => [`${s.start_time}-${s.end_time}`, { start: s.start_time, end: s.end_time }])).values()]
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!periods.length && !emptyCell) return null;
  const at = (day: number, p: { start: string; end: string }) => slots.filter((s) => s.day_of_week === day && s.start_time === p.start && s.end_time === p.end);
  return (
    <div className="timetable" style={{ gridTemplateColumns: `70px repeat(${days.length}, 1fr)` }}>
      <div className="tt-head" />
      {days.map((d) => <div key={d} className="tt-head">{DAY_NAMES[d]}</div>)}
      {periods.map((p) => (
        <div key={`${p.start}-${p.end}`} style={{ display: 'contents' }}>
          <div className="tt-time">{p.start.slice(0, 5)}<br />{p.end.slice(0, 5)}</div>
          {days.map((d) => {
            const here = at(d, p);
            if (!here.length) return <div key={d} className="tt-slot empty">{emptyCell ? emptyCell(d, p.start, p.end) : null}</div>;
            return (
              <div key={d} className="tt-slot" style={{ display: 'grid', gap: 4 }}>
                {here.map((s) => (
                  <div key={s.id}>
                    {focus === 'stream' ? <><b>{s.subject_name}</b><span className="tiny">{s.teacher_name}{s.room ? ` · ${s.room}` : ''}</span></>
                      : <><b>{s.grade_level_name} {s.stream_name}</b><span className="tiny">{s.subject_name}{s.room ? ` · ${s.room}` : ''}</span></>}
                    {cell ? cell(s) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
