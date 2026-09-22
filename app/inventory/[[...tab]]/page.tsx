import { notFound } from 'next/navigation';
import { requireAction, currentCanAction, requireModuleTab } from '@/lib/session';
import {
  listItems, hasAnyItems, ITEM_FILTER_FIELDS,
  listItemQuantitiesByLocation, hasAnyItemQuantities, ITEM_QUANTITY_FILTER_FIELDS,
} from '@/lib/items';
import {
  listLocations, listActiveLocations, listUnitsOfMeasure, listInventoryPostingGroups, listProductPostingGroups,
} from '@/lib/inventorySetup';
import {
  listItemJournalLines, hasAnyItemJournalLines, listItemLedgerEntries, calculateReplenishment,
  ITEM_JOURNAL_FILTER_FIELDS,
} from '@/lib/itemJournal';
import { listPostableAccounts } from '@/lib/gl';
import { parseFilters } from '@/lib/listFilters';
import { parseSort } from '@/lib/listSort';
import { Page } from '@/components/layout/page';
import {
  Card, CardHead, EmptyState, Pill, TableWrap, Tabs, Toolbar, Spacer, type TabDefinition,
} from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/filters';
import { DynamicFilterBar } from '@/components/ui/dynamic-filter';
import { SortLink } from '@/components/ui/sort-link';
import { Money } from '@/components/ui/money';
import { ExportButton } from '@/components/ui/export-button';
import { formatDate } from '@/lib/format';
import { NewItemButton, EditItemButton, StockByLocationButton, ItemMovementsLink } from '../item-form';
import {
  NewAdjustmentButton, EditButton as EditJournalLineButton, SubmitButton, CancelApprovalButton, ApproveButton,
  RejectButton, ReopenButton, PostButton, DeleteButton,
} from '../item-journal-actions';
import { LocationFormButton } from '../location-form';
import { UnitOfMeasureFormButton } from '../unit-of-measure-form';
import { InventoryPostingGroupFormButton, ProductPostingGroupFormButton } from '../posting-group-form';

/** Each tab is a page of its own (lib/permissions.ts PAGES, parent INVENTORY), so a permission
 *  set can open this module and still be kept out of particular screens. */
const TAB_PAGE: Record<string, string> = {
  items: 'INVENTORY_ITEMS',
  'item-journal': 'INVENTORY_ITEM_JOURNAL',
  'item-quantities': 'INVENTORY_ITEM_QUANTITIES',
  'ledger-entries': 'INVENTORY_LEDGER',
  'reorder-suggestions': 'INVENTORY_REORDER',
  locations: 'INVENTORY_LOCATIONS',
  'units-of-measure': 'INVENTORY_UNITS',
  'posting-groups': 'INVENTORY_POSTING_GROUPS',
};

const TABS: TabDefinition[] = [
  { key: 'items', label: 'Items' },
  { key: 'item-journal', label: 'Item Journal' },
  { key: 'item-quantities', label: 'Qty per Location' },
  { key: 'ledger-entries', label: 'Ledger Entries' },
  { key: 'reorder-suggestions', label: 'Reorder Suggestions' },
  { key: 'locations', label: 'Locations' },
  { key: 'units-of-measure', label: 'Units of Measure' },
  { key: 'posting-groups', label: 'Posting Groups' },
];

export default async function InventoryPage({ params, searchParams }: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<{ q?: string; filters?: string; sort?: string }>;
}) {
  const user = await requireAction('INVENTORY_READ');
  const { tab: segments } = await params;
  const { q = '', filters: filtersRaw, sort: sortRaw } = await searchParams;
  const tab = segments?.[0] ?? 'items';
  if (!TABS.some((t) => t.key === tab)) notFound();
  const hrefFor = (k: string) => `/inventory/${k}`;
  const tabs = requireModuleTab(user, TABS, TAB_PAGE, tab, !segments?.[0], hrefFor);

  return (
    <Page title="Inventory" crumb="Items, stock levels and Item Journal adjustments" user={user}>
      <Tabs tabs={tabs} active={tab} hrefFor={hrefFor} />
      {tab === 'items' ? <ItemsTab search={q} filtersRaw={filtersRaw} sortRaw={sortRaw} /> : null}
      {tab === 'item-journal' ? <ItemJournalTab search={q} filtersRaw={filtersRaw} sortRaw={sortRaw} username={user.username} /> : null}
      {tab === 'item-quantities' ? <ItemQuantitiesTab search={q} filtersRaw={filtersRaw} sortRaw={sortRaw} /> : null}
      {tab === 'ledger-entries' ? <LedgerEntriesTab /> : null}
      {tab === 'reorder-suggestions' ? <ReorderSuggestionsTab /> : null}
      {tab === 'locations' ? <LocationsTab /> : null}
      {tab === 'units-of-measure' ? <UnitsOfMeasureTab /> : null}
      {tab === 'posting-groups' ? <PostingGroupsTab /> : null}
    </Page>
  );
}

async function ItemsTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canManage, unitsOfMeasure, inventoryPostingGroups, productPostingGroups] = await Promise.all([
    listItems({ search, filters, sort }),
    hasAnyItems().then((any) => !any),
    currentCanAction('INVENTORY_ITEM_MANAGE'),
    listUnitsOfMeasure(),
    listInventoryPostingGroups(),
    listProductPostingGroups(),
  ]);
  const fields = ITEM_FILTER_FIELDS.map((f) => {
    if (f.key === 'inventory_posting_group_id') return { ...f, options: inventoryPostingGroups.map((g) => ({ value: g.id, label: g.code })) };
    if (f.key === 'product_posting_group_id') return { ...f, options: productPostingGroups.map((g) => ({ value: g.id, label: g.code })) };
    return f;
  });

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search item no. or description…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        {canManage ? (
          <NewItemButton unitsOfMeasure={unitsOfMeasure} inventoryPostingGroups={inventoryPostingGroups} productPostingGroups={productPostingGroups} />
        ) : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="no">No.</SortLink></th>
                <th><SortLink sortKey="description">Description</SortLink></th>
                <th>Base UoM</th>
                <th>Costing method</th>
                <th className="num"><SortLink sortKey="inventory">On hand</SortLink></th>
                <th className="num"><SortLink sortKey="unit_cost">Unit cost</SortLink></th>
                <th><SortLink sortKey="status">Status</SortLink></th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.id}>
                  <td className="mono">{it.no}</td>
                  <td>{it.description}</td>
                  <td className="mono muted-cell">{it.base_unit_of_measure_code}</td>
                  <td className="tiny">{it.costing_method}</td>
                  <td className="num">
                    <ItemMovementsLink item={it}>{it.inventory}</ItemMovementsLink>
                    {it.below_reorder_point ? <Pill tone="warn">LOW</Pill> : null}
                  </td>
                  <td className="num"><Money cents={it.unit_cost} /></td>
                  <td><Pill status={it.status} /></td>
                  <td className="num">
                    <div className="inline" style={{ justifyContent: 'flex-end' }}>
                      <StockByLocationButton item={it} />
                      {canManage ? (
                        <EditItemButton
                          item={it} unitsOfMeasure={unitsOfMeasure} inventoryPostingGroups={inventoryPostingGroups}
                          productPostingGroups={productPostingGroups}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📦" title={empty ? 'No items yet' : 'No items match'} />}
      </Card>
    </>
  );
}

async function ItemJournalTab({ search, filtersRaw, sortRaw, username }: {
  search: string; filtersRaw?: string; sortRaw?: string; username: string;
}) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, canCreate, canApprove, canPost, items, locations] = await Promise.all([
    listItemJournalLines({ search, filters, sort }),
    hasAnyItemJournalLines().then((any) => !any),
    currentCanAction('INVENTORY_JOURNAL_CREATE'),
    currentCanAction('INVENTORY_JOURNAL_APPROVE'),
    currentCanAction('INVENTORY_JOURNAL_POST'),
    listItems({ filters: [{ field: 'status', operator: '=', value: 'ACTIVE' }] }),
    listActiveLocations(),
  ]);
  const eligibleItems = items.map((i) => ({ id: i.id, no: i.no, description: i.description, costing_method: i.costing_method, unit_cost: i.unit_cost }));

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search line no., item no. or description…" disabled={empty} />
        <DynamicFilterBar fields={ITEM_JOURNAL_FILTER_FIELDS} disabled={empty} />
        <Spacer />
        {canCreate ? <NewAdjustmentButton items={eligibleItems} locations={locations} /> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="no">No.</SortLink></th>
                <th>Entry type</th>
                <th><SortLink sortKey="item">Item</SortLink></th>
                <th>Location</th>
                <th className="num"><SortLink sortKey="quantity">Quantity</SortLink></th>
                <th className="num"><SortLink sortKey="amount">Amount</SortLink></th>
                <th><SortLink sortKey="posting_date">Posting date</SortLink></th>
                <th><SortLink sortKey="status">Status</SortLink></th>
                <th className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const isOwn = l.created_by === username;
                return (
                  <tr key={l.no} className={l.status === 'Processed' ? 'muted' : undefined}>
                    <td className="mono">{l.no}</td>
                    <td><Pill status={l.entry_type === 'Positive Adjmt.' ? 'ok' : 'warn'}>{l.entry_type}</Pill></td>
                    <td>{l.item_no} <span className="tiny muted-cell">{l.item_description}</span></td>
                    <td className="mono muted-cell">{l.location_code}</td>
                    <td className="num">{l.base_quantity} {l.unit_of_measure_code}</td>
                    <td className="num"><Money cents={l.amount} /></td>
                    <td>{formatDate(l.posting_date)}</td>
                    <td><Pill status={l.status} /></td>
                    <td className="num">
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        {l.status === 'Open' && canCreate && isOwn ? (
                          <>
                            <EditJournalLineButton line={l} items={eligibleItems} locations={locations} />
                            <SubmitButton no={l.no} />
                            <DeleteButton no={l.no} />
                          </>
                        ) : null}
                        {l.status === 'Pending Approval' && canCreate && isOwn ? <CancelApprovalButton no={l.no} /> : null}
                        {l.status === 'Pending Approval' && canApprove ? (
                          <>
                            <ApproveButton no={l.no} />
                            <RejectButton no={l.no} />
                          </>
                        ) : null}
                        {l.status === 'Approved' && !l.posted && canApprove ? <ReopenButton no={l.no} /> : null}
                        {l.status === 'Approved' && canPost ? <PostButton no={l.no} /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📓" title={empty ? 'No item journal lines yet' : 'No lines match'} sub="Post a Positive or Negative Adjmt. to move stock." />}
      </Card>
    </>
  );
}

async function ItemQuantitiesTab({ search, filtersRaw, sortRaw }: { search: string; filtersRaw?: string; sortRaw?: string }) {
  const filters = parseFilters(filtersRaw);
  const sort = parseSort(sortRaw);
  const [rows, empty, items, locations] = await Promise.all([
    listItemQuantitiesByLocation({ search, filters, sort }),
    hasAnyItemQuantities().then((any) => !any),
    listItems(),
    listActiveLocations(),
  ]);
  const fields = ITEM_QUANTITY_FILTER_FIELDS.map((f) => {
    if (f.key === 'item_id') return { ...f, options: items.map((i) => ({ value: i.id, label: `${i.no} — ${i.description}` })) };
    if (f.key === 'location_id') return { ...f, options: locations.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })) };
    return f;
  });
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <>
      <Toolbar>
        <SearchInput placeholder="Search item, description or location…" disabled={empty} />
        <DynamicFilterBar fields={fields} disabled={empty} />
        <Spacer />
        <ExportButton href="/api/export/item-quantities" params={{ q: search, filters: filtersRaw, sort: sortRaw }} disabled={!rows.length} />
      </Toolbar>
      <Card>
        <CardHead
          title="Item Quantities per Location"
          sub="Current qty-on-hand for every item at every location it has ever moved at, valued at each item's current unit cost"
        />
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th><SortLink sortKey="item">Item</SortLink></th>
                <th><SortLink sortKey="location">Location</SortLink></th>
                <th className="num"><SortLink sortKey="inventory">Quantity</SortLink></th>
                <th className="num">Unit cost</th>
                <th className="num"><SortLink sortKey="value">Value</SortLink></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.item_id}-${r.location_id}`}>
                  <td>{r.item_no} <span className="tiny muted-cell">{r.item_description}</span></td>
                  <td className="mono muted-cell">{r.location_code} — {r.location_name}</td>
                  <td className="num">
                    {r.inventory} {r.base_unit_of_measure_code}
                    {r.below_reorder_point ? <Pill tone="warn">LOW</Pill> : null}
                  </td>
                  <td className="num"><Money cents={r.unit_cost} /></td>
                  <td className="num"><Money cents={r.value} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total value</td>
                <td className="num"><Money cents={totalValue} /></td>
              </tr>
            </tfoot>
          </TableWrap>
        ) : <EmptyState icon="📊" title={empty ? 'No stock movements posted yet' : 'No quantities match'} />}
      </Card>
    </>
  );
}

async function LedgerEntriesTab() {
  const rows = await listItemLedgerEntries();
  return (
    <Card>
      <CardHead title="Item Ledger Entries" sub="The posted, immutable stock movement history behind every item's quantity on hand" />
      {rows.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>Document</th><th>Date</th><th>Type</th><th>Item</th><th>Location</th>
              <th className="num">Quantity</th><th className="num">Unit cost</th><th className="num">Amount</th><th className="num">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.document_no}</td>
                <td>{formatDate(e.posting_date)}</td>
                <td><Pill status={e.entry_type === 'Positive Adjmt.' ? 'ok' : 'warn'}>{e.entry_type}</Pill></td>
                <td>{e.item_no} <span className="tiny muted-cell">{e.item_description}</span></td>
                <td className="mono muted-cell">{e.location_code}</td>
                <td className="num">{e.quantity}</td>
                <td className="num"><Money cents={e.unit_cost} /></td>
                <td className="num"><Money cents={e.amount} /></td>
                <td className="num">{e.open ? e.remaining_quantity : '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="📄" title="No posted movements yet" />}
    </Card>
  );
}

async function ReorderSuggestionsTab() {
  const suggestions = await calculateReplenishment();
  return (
    <Card>
      <CardHead
        title="Reorder Suggestions"
        sub="Items at or below their Reorder Point — pick up the suggested quantity from Item Journal to raise a Positive Adjmt."
      />
      {suggestions.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>Item</th><th>Location</th><th>Policy</th>
              <th className="num">On hand</th><th className="num">Reorder point</th><th className="num">Suggested qty</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s) => (
              <tr key={`${s.item_id}-${s.location_id}`}>
                <td>{s.item_no} <span className="tiny muted-cell">{s.item_description}</span></td>
                <td className="mono muted-cell">{s.location_code}</td>
                <td className="tiny">{s.reordering_policy}</td>
                <td className="num">{s.inventory}</td>
                <td className="num">{s.reorder_point}</td>
                <td className="num"><b>{s.suggested_quantity}</b></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState icon="✅" title="Nothing is below its reorder point" />}
    </Card>
  );
}

async function LocationsTab() {
  const [rows, canManage] = await Promise.all([listLocations(), currentCanAction('INVENTORY_SETUP_MANAGE')]);
  return (
    <>
      <Toolbar>
        <Spacer />
        {canManage ? <LocationFormButton>Add location</LocationFormButton> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>Code</th><th>Name</th><th>Address</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.code}</td>
                  <td>{l.name}</td>
                  <td className="tiny muted-cell">{l.address || '—'}</td>
                  <td><Pill status={l.status} /></td>
                  <td>{canManage ? <LocationFormButton location={l} className="btn sm ghost">Edit</LocationFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="🏬" title="No locations yet" />}
      </Card>
    </>
  );
}

async function UnitsOfMeasureTab() {
  const [rows, canManage] = await Promise.all([listUnitsOfMeasure(), currentCanAction('INVENTORY_SETUP_MANAGE')]);
  return (
    <>
      <Toolbar>
        <Spacer />
        {canManage ? <UnitOfMeasureFormButton>Add unit of measure</UnitOfMeasureFormButton> : null}
      </Toolbar>
      <Card>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr><th>Code</th><th>Description</th><th>Symbol</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.code}</td>
                  <td>{u.description}</td>
                  <td className="muted-cell">{u.symbol || '—'}</td>
                  <td>{canManage ? <UnitOfMeasureFormButton unitOfMeasure={u} className="btn sm ghost">Edit</UnitOfMeasureFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="📏" title="No units of measure yet" />}
      </Card>
    </>
  );
}

async function PostingGroupsTab() {
  const [inventoryGroups, productGroups, canManage, accounts] = await Promise.all([
    listInventoryPostingGroups(),
    listProductPostingGroups(),
    currentCanAction('INVENTORY_SETUP_MANAGE'),
    listPostableAccounts(),
  ]);

  return (
    <>
      <Card>
        <CardHead title="Inventory Posting Groups" sub="The ledger side of the mapping — which G/L account carries an item family's stock value">
          {canManage ? <InventoryPostingGroupFormButton accounts={accounts}>Add group</InventoryPostingGroupFormButton> : null}
        </CardHead>
        {inventoryGroups.length ? (
          <TableWrap>
            <thead>
              <tr><th>Code</th><th>Description</th><th>Inventory G/L account</th><th className="num">Items</th><th /></tr>
            </thead>
            <tbody>
              {inventoryGroups.map((g) => (
                <tr key={g.id}>
                  <td className="mono">{g.code}</td>
                  <td>{g.description}</td>
                  <td className="mono muted-cell">{g.inventory_gl_account_code} — {g.inventory_gl_account_name}</td>
                  <td className="num">{g.items_using}</td>
                  <td>{canManage ? <InventoryPostingGroupFormButton group={g} accounts={accounts} className="btn sm ghost">Edit</InventoryPostingGroupFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="⚖" title="No inventory posting groups yet" />}
      </Card>

      <Card>
        <CardHead title="Product Posting Groups" sub="The subledger side of the mapping — which P&L account a Positive/Negative Adjmt. offsets against">
          {canManage ? <ProductPostingGroupFormButton accounts={accounts}>Add group</ProductPostingGroupFormButton> : null}
        </CardHead>
        {productGroups.length ? (
          <TableWrap>
            <thead>
              <tr><th>Code</th><th>Description</th><th>Adjustment G/L account</th><th className="num">Items</th><th /></tr>
            </thead>
            <tbody>
              {productGroups.map((g) => (
                <tr key={g.id}>
                  <td className="mono">{g.code}</td>
                  <td>{g.description}</td>
                  <td className="mono muted-cell">{g.adjustment_gl_account_code} — {g.adjustment_gl_account_name}</td>
                  <td className="num">{g.items_using}</td>
                  <td>{canManage ? <ProductPostingGroupFormButton group={g} accounts={accounts} className="btn sm ghost">Edit</ProductPostingGroupFormButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <EmptyState icon="⚖" title="No product posting groups yet" />}
      </Card>
    </>
  );
}
