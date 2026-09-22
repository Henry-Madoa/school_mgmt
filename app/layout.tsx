import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ensureSeeded } from '@/lib/bootstrap';
import { getOrgBrand, getTheme, themeCss } from '@/lib/org';
import { FormatProvider } from '@/components/ui/format-provider';
import { ToastProvider } from '@/components/ui/toast';
import { ResultDialogProvider } from '@/components/ui/result-dialog';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';

export const dynamic = 'force-dynamic';

/**
 * `maximumScale` is deliberately left alone — a bursar checking a figure on a
 * phone must be able to pinch-zoom the ledger.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  await ensureSeeded();
  const org = await getOrgBrand();
  return {
    title: `${org?.short_name || org?.name || 'School'} — School Management System`,
    description: 'School Management Information System',
    icons: {
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎓</text></svg>",
    },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  await ensureSeeded();
  const [org, theme] = await Promise.all([getOrgBrand(), getTheme()]);

  return (
    // The theme-mode script (below) sets data-mode on this element before
    // React hydrates; suppressHydrationWarning stops React flagging that
    // expected, script-driven mismatch as an error.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Theme tokens are rendered into the first byte of the document rather
          than fetched as a stylesheet, so there is no unstyled flash and the
          sign-in screen already wears the school's colours.
        */}
        <style id="theme-tokens" dangerouslySetInnerHTML={{ __html: themeCss(theme.tokens) }} />
        {/*
          Light/dark mode is a per-user browser preference (see ThemeToggle),
          separate from the org's brand preset above. Applied synchronously,
          before first paint, so there is no flash of the wrong mode.
        */}
        <script
          id="theme-mode-init"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('theme-mode');` +
              `if(m!=='light'&&m!=='dark'){m=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}` +
              `document.documentElement.dataset.mode=m;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <FormatProvider org={org}>
          <ToastProvider>
            <ResultDialogProvider>
              <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
            </ResultDialogProvider>
          </ToastProvider>
        </FormatProvider>
      </body>
    </html>
  );
}
