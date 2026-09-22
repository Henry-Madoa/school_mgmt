import Link from 'next/link';

/**
 * Business-Central-style record navigation — a floating chevron pinned to the far left/right
 * of the content area, vertically centered on the viewport, for stepping to the previous/next
 * record without going back to the list. Renders nothing on whichever side has no neighbour.
 */
export function CardNav({ prevHref, nextHref }: { prevHref: string | null; nextHref: string | null }) {
  return (
    <>
      {prevHref ? (
        <Link href={prevHref} className="card-nav-btn card-nav-prev" aria-label="Previous record">
          <ChevronIcon direction="left" />
        </Link>
      ) : null}
      {nextHref ? (
        <Link href={nextHref} className="card-nav-btn card-nav-next" aria-label="Next record">
          <ChevronIcon direction="right" />
        </Link>
      ) : null}
    </>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
