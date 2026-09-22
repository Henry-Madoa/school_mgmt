'use client';

import { LineRowsPanel, type LineColumn } from '@/components/ui/line-rows-editor';
import { RELATIONSHIPS, GENDERS } from '@/lib/constants';
import {
  saveEditNextOfKin, saveEditBeneficiaries, saveEditDependants, saveEditEmergencyContacts,
  saveEditProfessionalBodies, saveEditWorkHistory, saveEditBankAccounts,
} from '@/app/actions/employeeEdits';
import type {
  EmployeeEditNextOfKin, EmployeeEditBeneficiary, EmployeeEditDependant, EmployeeEditEmergencyContact,
  EmployeeEditProfessionalBody, EmployeeEditWorkHistory, EmployeeEditBankAccount,
} from '@/lib/types';

type Row<T> = Omit<T, 'id'>;
const strip = <T extends { id: number }>(rows: T[]): Row<T>[] => rows.map(({ id: _id, ...r }) => r as Row<T>);

const NOK_COLUMNS: LineColumn<Row<EmployeeEditNextOfKin>>[] = [
  { key: 'full_name', label: 'Name' },
  { key: 'relationship', label: 'Relationship', type: 'select', options: RELATIONSHIPS },
  { key: 'phone', label: 'Phone', type: 'phone' },
  { key: 'id_no', label: 'ID No.' },
  { key: 'email', label: 'Email', type: 'email' },
];
const emptyNok = (): Row<EmployeeEditNextOfKin> => ({ edit_no: '', full_name: '', relationship: null, id_no: null, phone: null, email: null });

export function EditNextOfKinPanel({ editNo, rows, canManage }: { editNo: string; rows: EmployeeEditNextOfKin[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Next of Kin" rows={strip(rows)} columns={NOK_COLUMNS} icon="👪"
      edit={{ can: canManage, emptyRow: emptyNok, onSave: (r) => saveEditNextOfKin(editNo, r), successTitle: 'Next of kin saved' }} />
  );
}

const BEN_COLUMNS: LineColumn<Row<EmployeeEditBeneficiary>>[] = [
  { key: 'full_name', label: 'Name' },
  { key: 'relationship', label: 'Relationship', type: 'select', options: RELATIONSHIPS },
  { key: 'gender', label: 'Gender', type: 'select', options: GENDERS },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'percentage', label: 'Share %', type: 'number', width: 100 },
  { key: 'is_minor', label: 'Minor', type: 'checkbox', width: 60, render: (r) => (r.is_minor ? 'Yes' : 'No') },
];
const emptyBen = (): Row<EmployeeEditBeneficiary> => ({
  edit_no: '', full_name: '', id_no: null, date_of_birth: null, relationship: null,
  gender: null, phone: null, email: null, percentage: 0, is_minor: false,
});

export function EditBeneficiariesPanel({ editNo, rows, canManage }: { editNo: string; rows: EmployeeEditBeneficiary[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Beneficiaries" rows={strip(rows)} columns={BEN_COLUMNS} icon="🎗" sub="Shares must not exceed 100%"
      edit={{ can: canManage, emptyRow: emptyBen, onSave: (r) => saveEditBeneficiaries(editNo, r), successTitle: 'Beneficiaries saved' }} />
  );
}

const DEP_COLUMNS: LineColumn<Row<EmployeeEditDependant>>[] = [
  { key: 'full_name', label: 'Name' },
  { key: 'relationship', label: 'Relationship', type: 'select', options: RELATIONSHIPS },
  { key: 'gender', label: 'Gender', type: 'select', options: GENDERS },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'id_or_birth_cert_no', label: 'ID / Birth Cert No.' },
  { key: 'is_student', label: 'Student', type: 'checkbox', width: 60, render: (r) => (r.is_student ? 'Yes' : 'No') },
];
const emptyDep = (): Row<EmployeeEditDependant> => ({
  edit_no: '', full_name: '', id_or_birth_cert_no: null, date_of_birth: null, relationship: null, gender: null, is_student: false,
});

export function EditDependantsPanel({ editNo, rows, canManage }: { editNo: string; rows: EmployeeEditDependant[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Medical Dependants" rows={strip(rows)} columns={DEP_COLUMNS} icon="🩺"
      edit={{ can: canManage, emptyRow: emptyDep, onSave: (r) => saveEditDependants(editNo, r), successTitle: 'Dependants saved' }} />
  );
}

const EC_COLUMNS: LineColumn<Row<EmployeeEditEmergencyContact>>[] = [
  { key: 'full_name', label: 'Name' },
  { key: 'relationship', label: 'Relationship', type: 'select', options: RELATIONSHIPS },
  { key: 'phone', label: 'Phone', type: 'phone' },
  { key: 'alt_phone', label: 'Alt. Phone', type: 'phone' },
  { key: 'email', label: 'Email', type: 'email' },
];
const emptyEc = (): Row<EmployeeEditEmergencyContact> => ({ edit_no: '', full_name: '', relationship: null, phone: null, alt_phone: null, email: null });

export function EditEmergencyContactsPanel({ editNo, rows, canManage }: { editNo: string; rows: EmployeeEditEmergencyContact[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Emergency Contacts" rows={strip(rows)} columns={EC_COLUMNS} icon="🚑"
      edit={{ can: canManage, emptyRow: emptyEc, onSave: (r) => saveEditEmergencyContacts(editNo, r), successTitle: 'Emergency contacts saved' }} />
  );
}

const PB_COLUMNS: LineColumn<Row<EmployeeEditProfessionalBody>>[] = [
  { key: 'body_name', label: 'Professional Body' },
  { key: 'membership_no', label: 'Membership No.' },
  { key: 'from_date', label: 'From', type: 'date' },
  { key: 'to_date', label: 'To', type: 'date' },
];
const emptyPb = (): Row<EmployeeEditProfessionalBody> => ({ edit_no: '', body_name: '', membership_no: null, from_date: null, to_date: null });

export function EditProfessionalBodiesPanel({ editNo, rows, canManage }: { editNo: string; rows: EmployeeEditProfessionalBody[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Professional Bodies" rows={strip(rows)} columns={PB_COLUMNS} icon="🎓"
      edit={{ can: canManage, emptyRow: emptyPb, onSave: (r) => saveEditProfessionalBodies(editNo, r), successTitle: 'Professional bodies saved' }} />
  );
}

const WH_COLUMNS: LineColumn<Row<EmployeeEditWorkHistory>>[] = [
  { key: 'institution', label: 'Institution' },
  { key: 'position_held', label: 'Position Held' },
  { key: 'from_date', label: 'From', type: 'date' },
  { key: 'to_date', label: 'To', type: 'date' },
  { key: 'reason_for_leaving', label: 'Reason for Leaving' },
];
const emptyWh = (): Row<EmployeeEditWorkHistory> => ({ edit_no: '', institution: '', position_held: null, from_date: null, to_date: null, reason_for_leaving: null });

export function EditWorkHistoryPanel({ editNo, rows, canManage }: { editNo: string; rows: EmployeeEditWorkHistory[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Work History" rows={strip(rows)} columns={WH_COLUMNS} icon="🏢"
      edit={{ can: canManage, emptyRow: emptyWh, onSave: (r) => saveEditWorkHistory(editNo, r), successTitle: 'Work history saved' }} />
  );
}

const BANK_COLUMNS: LineColumn<Row<EmployeeEditBankAccount>>[] = [
  { key: 'bank_code', label: 'Bank' },
  { key: 'branch', label: 'Branch' },
  { key: 'account_no', label: 'Account No.' },
  { key: 'percentage', label: 'Split %', type: 'number', width: 100 },
];
const emptyBank = (): Row<EmployeeEditBankAccount> => ({ edit_no: '', bank_code: null, branch: null, account_no: '', percentage: 100 });

export function EditBankAccountsPanel({ editNo, rows, canManage }: { editNo: string; rows: EmployeeEditBankAccount[]; canManage: boolean }) {
  return (
    <LineRowsPanel title="Bank Accounts" rows={strip(rows)} columns={BANK_COLUMNS} icon="🏦" sub="Split percentages must add up to 100%"
      edit={{ can: canManage, emptyRow: emptyBank, onSave: (r) => saveEditBankAccounts(editNo, r), successTitle: 'Bank accounts saved' }} />
  );
}
