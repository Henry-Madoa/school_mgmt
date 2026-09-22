import { listItemQuantitiesByLocation } from '@/lib/items';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { buildWorkbookBuffer, excelExportResponse, type ExcelColumn } from '@/lib/excel';
import type { ItemQuantityByLocationRow } from '@/lib/types';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const filters = parseFilters(searchParams.get('filters'));
  const sort = parseSort(searchParams.get('sort'));

  return excelExportResponse('INVENTORY_READ', async () => {
    const rows = await listItemQuantitiesByLocation({ search: q, filters, sort });
    const columns: ExcelColumn<ItemQuantityByLocationRow>[] = [
      { header: 'Item No.', key: 'item_no', value: (r) => r.item_no },
      { header: 'Description', key: 'item_description', width: 32, value: (r) => r.item_description },
      { header: 'Location', key: 'location_code', value: (r) => r.location_code },
      { header: 'Location Name', key: 'location_name', width: 24, value: (r) => r.location_name },
      { header: 'Unit', key: 'uom', value: (r) => r.base_unit_of_measure_code },
      { header: 'Quantity', key: 'inventory', value: (r) => r.inventory },
      { header: 'Unit Cost', key: 'unit_cost', value: (r) => r.unit_cost / 100 },
      { header: 'Value', key: 'value', value: (r) => r.value / 100 },
      { header: 'Below Reorder Point', key: 'below_reorder_point', value: (r) => (r.below_reorder_point ? 'Yes' : 'No') },
    ];
    return { filename: 'item-quantities-by-location.xlsx', buffer: await buildWorkbookBuffer('Item Quantities', columns, rows) };
  });
}
