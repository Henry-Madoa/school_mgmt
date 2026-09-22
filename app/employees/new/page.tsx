import { requireAction } from '@/lib/session';
import { listDimensionValues } from '@/lib/pool';
import { getDimensionCaptions } from '@/lib/org';
import { Page } from '@/components/layout/page';
import { NewEmployeeForm } from './new-employee-form';

export default async function NewEmployeePage() {
  const user = await requireAction('EMPLOYEES_CREATE');
  const [gd1Values, gd2Values, { caption1, caption2 }] = await Promise.all([
    listDimensionValues(1), listDimensionValues(2), getDimensionCaptions(),
  ]);

  return (
    <Page title="New employee" crumb="Capture the essentials, fill in the rest afterwards" user={user}>
      <NewEmployeeForm
        globalDimension1Values={gd1Values} globalDimension2Values={gd2Values}
        caption1={caption1} caption2={caption2}
      />
    </Page>
  );
}
