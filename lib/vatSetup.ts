/*
 * VAT + WHT setup masters — VAT Business Posting Group (BC T89), VAT Product Posting Group (BC
 * T324, with the AL Type of VAT | WHT) and VAT Posting Setup (BC T325). Managed from the Admin
 * Centre → Setup Pool → Finance. Structured like lib/cashMgmtSetup.ts.
 */
import { one, all, run, audit, hasAnyRow } from './db.ts';
import { AppError } from './errors.ts';
import type {
  Actor, TaxType, VatBusinessPostingGroup, VatCalculationType, VatPostingSetup, VatPostingSetupView,
  VatProductPostingGroup,
} from './types.ts';

const norm = (v: unknown): string => String(v ?? '').trim();
const now = (): string => new Date().toISOString();
const TAX_TYPES: TaxType[] = ['VAT', 'WHT'];
const CALC_TYPES: VatCalculationType[] = ['Normal', 'Zero VAT', 'Exempt'];

/* ---------------------------------------------------- VAT Business Posting Group */

export const listVatBusinessPostingGroups = (): Promise<VatBusinessPostingGroup[]> =>
  all<VatBusinessPostingGroup>('SELECT * FROM vat_business_posting_group ORDER BY code');

export interface VatBusinessPostingGroupInput { code: string; description: string }

export async function createVatBusinessPostingGroup(i: VatBusinessPostingGroupInput, user: Actor): Promise<{ id: number }> {
  if (!norm(i.code)) throw new AppError('A code is required', 'VALIDATION');
  if (await hasAnyRow('vat_business_posting_group', 'code = ?', norm(i.code).toUpperCase())) {
    throw new AppError('A VAT business posting group with this code already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO vat_business_posting_group (code, description, created_at, created_by) VALUES (?,?,?,?)',
    norm(i.code).toUpperCase(), norm(i.description), now(), user.username,
  );
  await audit(user, 'VAT_BUS_POSTING_GROUP_CREATE', 'vat_business_posting_group', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateVatBusinessPostingGroup(id: number, i: VatBusinessPostingGroupInput, user: Actor): Promise<void> {
  if (!(await hasAnyRow('vat_business_posting_group', 'id = ?', id))) throw new AppError('Not found', 'NOT_FOUND');
  await run('UPDATE vat_business_posting_group SET description = ? WHERE id = ?', norm(i.description), id);
  await audit(user, 'VAT_BUS_POSTING_GROUP_UPDATE', 'vat_business_posting_group', id, {});
}

/* ---------------------------------------------------- VAT Product Posting Group */

export const listVatProductPostingGroups = (taxType?: TaxType): Promise<VatProductPostingGroup[]> =>
  all<VatProductPostingGroup>(
    `SELECT * FROM vat_product_posting_group ${taxType ? 'WHERE tax_type = @taxType' : ''} ORDER BY tax_type, code`,
    { taxType },
  );

export interface VatProductPostingGroupInput { code: string; description: string; taxType: TaxType }

export async function createVatProductPostingGroup(i: VatProductPostingGroupInput, user: Actor): Promise<{ id: number }> {
  if (!norm(i.code)) throw new AppError('A code is required', 'VALIDATION');
  if (!TAX_TYPES.includes(i.taxType)) throw new AppError('Invalid tax type', 'VALIDATION');
  if (await hasAnyRow('vat_product_posting_group', 'code = ?', norm(i.code).toUpperCase())) {
    throw new AppError('A VAT product posting group with this code already exists', 'DUPLICATE');
  }
  const info = await run(
    'INSERT INTO vat_product_posting_group (code, description, tax_type, created_at, created_by) VALUES (?,?,?,?,?)',
    norm(i.code).toUpperCase(), norm(i.description), i.taxType, now(), user.username,
  );
  await audit(user, 'VAT_PROD_POSTING_GROUP_CREATE', 'vat_product_posting_group', info.lastInsertRowid, { code: i.code });
  return { id: Number(info.lastInsertRowid) };
}

export async function updateVatProductPostingGroup(id: number, i: VatProductPostingGroupInput, user: Actor): Promise<void> {
  const before = await one<{ code: string; tax_type: string }>('SELECT code, tax_type FROM vat_product_posting_group WHERE id = ?', id);
  if (!before) throw new AppError('Not found', 'NOT_FOUND');
  if (i.taxType !== before.tax_type && (await hasAnyRow('vat_posting_setup', 'vat_prod_posting_group_code = ?', before.code))) {
    throw new AppError('The Type cannot change once the group is used in a VAT Posting Setup', 'VALIDATION');
  }
  await run('UPDATE vat_product_posting_group SET description = ?, tax_type = ? WHERE id = ?', norm(i.description), i.taxType, id);
  await audit(user, 'VAT_PROD_POSTING_GROUP_UPDATE', 'vat_product_posting_group', id, {});
}

/* ---------------------------------------------------------- VAT Posting Setup */

const VPS_SELECT = `
  SELECT s.*, a.code AS tax_account_code, a.name AS tax_account_name,
         p.description AS vat_prod_description
  FROM vat_posting_setup s
  LEFT JOIN gl_account a ON a.id = s.tax_account_id
  LEFT JOIN vat_product_posting_group p ON p.code = s.vat_prod_posting_group_code`;

export const listVatPostingSetup = (): Promise<VatPostingSetupView[]> =>
  all<VatPostingSetupView>(`${VPS_SELECT} ORDER BY s.vat_bus_posting_group_code, s.vat_prod_posting_group_code`);

/**
 * Every live VAT rate, as `rates[busCode][prodCode] = pct` — the same pairs
 * lib/vatEngine.ts's resolveVatSetup() resolves one at a time, flattened so a document's line
 * editor can show Total Incl. VAT while it is still being typed. Withholding-tax rows and
 * blocked rows are left out: neither is charged on a purchase line.
 */
export async function vatRateMatrix(): Promise<Record<string, Record<string, number>>> {
  const rows = await all<{ vat_bus_posting_group_code: string; vat_prod_posting_group_code: string; vat_pct: number }>(
    `SELECT vat_bus_posting_group_code, vat_prod_posting_group_code, vat_pct
     FROM vat_posting_setup WHERE tax_type = 'VAT' AND blocked = 0`,
  );
  const rates: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    (rates[r.vat_bus_posting_group_code] ??= {})[r.vat_prod_posting_group_code] = r.vat_pct;
  }
  return rates;
}

export const getVatPostingSetup = (busCode: string, prodCode: string): Promise<VatPostingSetup | undefined> =>
  one<VatPostingSetup>(
    'SELECT * FROM vat_posting_setup WHERE vat_bus_posting_group_code = ? AND vat_prod_posting_group_code = ?',
    busCode, prodCode,
  );

export interface VatPostingSetupInput {
  vatBusPostingGroupCode: string;
  vatProdPostingGroupCode: string;
  vatPct: number;
  vatCalculationType: VatCalculationType;
  taxAccountId: number | null;
  whtBase: 'Net' | 'Gross';
  blocked: boolean;
}

export async function saveVatPostingSetup(i: VatPostingSetupInput, user: Actor): Promise<void> {
  const bus = norm(i.vatBusPostingGroupCode).toUpperCase();
  const prod = norm(i.vatProdPostingGroupCode).toUpperCase();
  if (!bus || !prod) throw new AppError('Both a business and a product posting group are required', 'VALIDATION');
  if (!CALC_TYPES.includes(i.vatCalculationType)) throw new AppError('Invalid VAT calculation type', 'VALIDATION');
  const prodGroup = await one<{ tax_type: TaxType }>('SELECT tax_type FROM vat_product_posting_group WHERE code = ?', prod);
  if (!prodGroup) throw new AppError(`VAT product posting group ${prod} not found`, 'NOT_FOUND');
  if (i.vatPct < 0 || i.vatPct > 100) throw new AppError('The rate must be between 0 and 100', 'VALIDATION');
  if (i.vatPct > 0 && !i.taxAccountId) throw new AppError('A tax G/L account is required when the rate is above zero', 'VALIDATION');
  await run(
    `INSERT INTO vat_posting_setup
       (vat_bus_posting_group_code, vat_prod_posting_group_code, tax_type, vat_pct, vat_calculation_type,
        tax_account_id, wht_base, blocked, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (vat_bus_posting_group_code, vat_prod_posting_group_code) DO UPDATE SET
       tax_type = EXCLUDED.tax_type, vat_pct = EXCLUDED.vat_pct,
       vat_calculation_type = EXCLUDED.vat_calculation_type, tax_account_id = EXCLUDED.tax_account_id,
       wht_base = EXCLUDED.wht_base, blocked = EXCLUDED.blocked`,
    bus, prod, prodGroup.tax_type, i.vatPct, i.vatCalculationType, i.taxAccountId ?? null,
    i.whtBase, i.blocked ? 1 : 0, now(), user.username,
  );
  await audit(user, 'VAT_POSTING_SETUP_SAVE', 'vat_posting_setup', `${bus}/${prod}`, { vatPct: i.vatPct });
}

export async function deleteVatPostingSetup(busCode: string, prodCode: string, user: Actor): Promise<void> {
  await run(
    'DELETE FROM vat_posting_setup WHERE vat_bus_posting_group_code = ? AND vat_prod_posting_group_code = ?',
    norm(busCode).toUpperCase(), norm(prodCode).toUpperCase(),
  );
  await audit(user, 'VAT_POSTING_SETUP_DELETE', 'vat_posting_setup', `${busCode}/${prodCode}`, {});
}
