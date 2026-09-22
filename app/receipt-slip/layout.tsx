import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return <div style={{ padding: '24px 16px', background: '#fff', minHeight: '100vh' }}>{children}</div>;
}
