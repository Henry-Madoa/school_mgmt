import { Money } from './money';
import type { DocumentTotals } from '@/lib/documentTotals';

/*
 * Business Central's totals block, the one that sits under the Lines FastTab on a sales or
 * purchase document and adds itself up as you type. BC stacks the figures at the bottom right of
 * the lines, each on its own row, with the payable figure emphasised — this is that, and it takes
 * the same numbers whether they were just typed into the editor or read back off a saved
 * document, so the preview and the card cannot disagree.
 */
export function DocumentTotalsPanel({
  totals, showVat = false, currencyCode, note,
}: {
  totals: DocumentTotals;
  /** Sales documents carry no VAT in this system; purchase documents do. */
  showVat?: boolean;
  /** Shown beside the total when the document is not in the base currency. */
  currencyCode?: string | null;
  note?: string;
}) {
  const foreign = currencyCode && currencyCode !== 'KES' ? currencyCode : null;

  return (
    <div className="doc-totals">
      <table>
        <tbody>
          <tr>
            <th>Subtotal</th>
            <td className="num"><Money cents={totals.subtotal} /></td>
          </tr>
          {totals.discountTotal ? (
            <tr>
              <th>Line discounts</th>
              <td className="num">−<Money cents={totals.discountTotal} /></td>
            </tr>
          ) : null}
          <tr className={showVat ? undefined : 'doc-totals-grand'}>
            <th>{showVat ? 'Total Excl. VAT' : 'Total'}</th>
            <td className="num"><Money cents={totals.totalExclVat} /></td>
          </tr>
          {showVat ? (
            <>
              <tr>
                <th>VAT</th>
                <td className="num"><Money cents={totals.vatAmount} /></td>
              </tr>
              <tr className="doc-totals-grand">
                <th>Total Incl. VAT{foreign ? ` (${foreign})` : ''}</th>
                <td className="num"><Money cents={totals.totalInclVat} /></td>
              </tr>
            </>
          ) : null}
        </tbody>
      </table>
      <div className="tiny muted-cell">
        {totals.lineCount} line{totals.lineCount === 1 ? '' : 's'}{note ? ` · ${note}` : ''}
      </div>
    </div>
  );
}
