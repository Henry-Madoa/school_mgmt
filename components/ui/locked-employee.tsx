'use client';

/**
 * An employee field that cannot be changed — shown read-only, submitted as `employeeId`.
 *
 * Two places need it: Employee Self Service, where a document is always the signed-in
 * employee's own (the server ignores the form for that anyway — lib/selfService.ts — but the
 * form should say so rather than offer a picker), and an edit form whose employee is fixed
 * once the document exists. A disabled control is left out of FormData, so the value travels
 * in an explicit hidden input.
 */
export function LockedEmployee({ employee, label = 'Employee', hint }: {
  employee: { id: number; employee_no: string; first_name: string; last_name: string };
  label?: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor="f_employeeId_locked">{label}</label>
      <input id="f_employeeId_locked" type="text" readOnly value={`${employee.employee_no} — ${employee.first_name} ${employee.last_name}`} />
      <input type="hidden" name="employeeId" value={employee.id} />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
