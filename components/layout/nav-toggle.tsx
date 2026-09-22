'use client';

import { useNav } from './nav-context';

/** Hamburger in the top bar. On phones/tablets it opens the sidebar drawer; on
 *  desktop it is shown only while the sidebar is hidden, and brings it back. */
export function NavToggle() {
  const { open, toggle, showDesktop } = useNav();

  const onClick = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches) {
      showDesktop();
    } else {
      toggle();
    }
  };

  return (
    <button
      type="button"
      className="nav-toggle"
      onClick={onClick}
      aria-label={open ? 'Close navigation' : 'Open navigation'}
      aria-expanded={open}
      aria-controls="app-sidebar"
    >
      {/* Three bars that fold into a cross when the drawer is open. */}
      <span className={`bars ${open ? 'x' : ''}`} aria-hidden="true">
        <i /><i /><i />
      </span>
    </button>
  );
}
