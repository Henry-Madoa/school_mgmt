'use client';

import { GroupedBars } from '@/components/charts/grouped-bars';
import { Donut } from '@/components/charts/donut';
import { HBars } from '@/components/charts/hbars';
import { formatMonth } from '@/lib/format';
import type { AttendanceSummary, DashboardData } from '@/lib/types';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

export function MonthlyCollectionsChart({ monthly }: { monthly: DashboardData['monthlyCollections'] }) {
  return (
    <GroupedBars
      height={250}
      labels={monthly.map((m) => formatMonth(m.month))}
      series={[
        { name: 'Invoiced', color: SERIES[1], values: monthly.map((m) => m.invoiced) },
        { name: 'Collected', color: SERIES[0], values: monthly.map((m) => m.collected) },
      ]}
    />
  );
}

export function EnrolmentByGradeChart({ rows }: { rows: DashboardData['enrolmentByGrade'] }) {
  return <HBars money={false} rows={rows.map((r) => ({ label: r.grade, value: r.students }))} />;
}

export function AttendanceTodayChart({ summary }: { summary: AttendanceSummary }) {
  return (
    <Donut
      money={false}
      segments={[
        { label: 'Present', value: summary.present, color: 'var(--ok)' },
        { label: 'Late', value: summary.late, color: 'var(--warn)' },
        { label: 'Excused', value: summary.excused, color: 'var(--info)' },
        { label: 'Absent', value: summary.absent, color: 'var(--danger)' },
      ].filter((s) => s.value > 0)}
      centerValue={`${summary.rate}%`}
      centerLabel="present"
    />
  );
}
