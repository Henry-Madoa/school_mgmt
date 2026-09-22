'use client';

import { useState } from 'react';
import { FormModal } from '@/components/ui/form-modal';
import { Field } from '@/components/ui/field';
import { updatePayrollSetupRequest } from '@/app/actions/payrollSetup';
import type { HrPayrollSetup } from '@/lib/types';

const BASE_OPTIONS = [{ value: 'GROSS', label: 'Gross Pay' }, { value: 'BASIC', label: 'Basic Pay' }, { value: 'TAXABLE', label: 'Taxable Pay' }];

export function PayrollSetupFormButton({ setup, className = 'btn' }: { setup: HrPayrollSetup; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>Edit rates</button>
      {open ? (
        <FormModal
          title="Payroll setup" wide
          onClose={() => setOpen(false)}
          onSubmit={updatePayrollSetupRequest}
          submitLabel="Save changes"
          successTitle="Payroll setup updated"
        >
          <div className="grid g3">
            <Field name="personalReliefCents" label="Personal relief" type="currency" defaultValue={setup.personal_relief_cents / 100} />
            <Field name="insuranceReliefPct" label="Insurance relief %" type="number" defaultValue={setup.insurance_relief_pct} />
            <Field name="maxReliefCents" label="Max combined relief" type="currency" defaultValue={setup.max_relief_cents / 100} />
          </div>
          <div className="grid g3">
            <Field name="mortgageReliefCents" label="Owner-occupier interest cap (P9 col. F, per month)" type="currency" defaultValue={setup.mortgage_relief_cents / 100} />
            <Field name="pensionDeductionCapCents" label="Pension / NSSF deduction cap (P9 col. E3, per month)" type="currency" defaultValue={setup.pension_deduction_cap_cents / 100} />
            <Field name="prmfCapCents" label="Post-retirement medical fund cap (P9 col. J, per month)" type="currency" defaultValue={setup.prmf_cap_cents / 100} />
            <Field name="shifDeductible" label="SHIF is an allowable deduction (P9 col. I)" type="checkbox" defaultValue={setup.shif_deductible ? '1' : ''} />
            <Field name="housingLevyDeductible" label="Housing Levy is an allowable deduction (P9 col. H)" type="checkbox" defaultValue={setup.housing_levy_deductible ? '1' : ''} />
            <Field name="minimumReliefThresholdCents" label="Minimum relief exemption threshold" type="currency" defaultValue={setup.minimum_relief_threshold_cents / 100} />
            <Field name="secondaryTaxPct" label="Secondary employee flat tax %" type="number" defaultValue={setup.secondary_tax_pct} />
          </div>
          <div className="grid g3">
            <Field name="shifPct" label="SHIF %" type="number" step="0.01" defaultValue={setup.shif_pct} />
            <Field name="shifBasedOn" label="SHIF based on" type="select" options={BASE_OPTIONS} defaultValue={setup.shif_based_on} />
            <Field name="nssfEmployerFactor" label="NSSF employer factor" type="number" step="0.01" defaultValue={setup.nssf_employer_factor} />
          </div>
          <div className="grid g3">
            <Field name="housingLevyEnabled" label="Housing Levy enabled" type="checkbox" defaultValue={setup.housing_levy_enabled ? '1' : ''} />
            <Field name="housingLevyPct" label="Housing Levy %" type="number" step="0.01" defaultValue={setup.housing_levy_pct} />
            <Field name="housingLevyBasedOn" label="Housing Levy based on" type="select" options={BASE_OPTIONS} defaultValue={setup.housing_levy_based_on} />
          </div>
          <Field name="monthlyWorkingDays" label="Monthly working days (proration denominator)" type="number" defaultValue={setup.monthly_working_days} />
        </FormModal>
      ) : null}
    </>
  );
}
