'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Lets a `?preview=1` URL — opened by DocumentActionsMenu's Preview action — render the
 * same chrome-free layout the browser's print stylesheet produces, without opening the
 * OS print dialog. A genuine look-before-you-print step, Business-Central style.
 */
export function PrintPreviewMode() {
  const searchParams = useSearchParams();
  const isPreview = searchParams.get('preview') === '1';

  useEffect(() => {
    document.body.classList.toggle('print-preview', isPreview);
    return () => document.body.classList.remove('print-preview');
  }, [isPreview]);

  return null;
}
