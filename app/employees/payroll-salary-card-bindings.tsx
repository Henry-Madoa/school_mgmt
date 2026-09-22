'use client';

import { PayrollSalaryCard, type PayrollCumulatives, type PayrollSalaryLookups, type PayrollSalaryValues } from './payroll-salary-card';
import { updateEmployeeRequest } from '@/app/actions/employees';
import { updateEmployeeEditRequestAction } from '@/app/actions/employeeEdits';
import type { Cents } from '@/lib/types';

/** Payroll Salary Card on the Employee Card — saved straight onto the (New) employee. */
export function EmployeePayrollCard({ employeeId, values, basicPay, cumulative, lookups, canEdit }: {
  employeeId: number; values: PayrollSalaryValues; basicPay: Cents | null; cumulative: PayrollCumulatives | null;
  lookups: PayrollSalaryLookups; canEdit: boolean;
}) {
  return (
    <PayrollSalaryCard values={values} basicPay={basicPay} cumulative={cumulative} lookups={lookups} canEdit={canEdit}
      onSave={(v) => updateEmployeeRequest(employeeId, v)} />
  );
}

/** Proposed Payroll Salary Card on an Employee Editing request — HR only. */
export function EditRequestPayrollCard({ no, values, basicPay, lookups, canEdit }: {
  no: string; values: PayrollSalaryValues; basicPay: Cents | null; lookups: PayrollSalaryLookups; canEdit: boolean;
}) {
  return (
    <PayrollSalaryCard values={values} basicPay={basicPay} lookups={lookups} canEdit={canEdit}
      title="Proposed payroll details"
      sub={canEdit ? 'Payroll Salary Card — applied to the employee with the rest of the request' : 'Payroll Salary Card — maintained by HR; shown here as it will be applied'}
      onSave={(v) => updateEmployeeEditRequestAction(no, v)} />
  );
}
