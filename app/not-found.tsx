import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="content">
      <div className="card">
        <div className="empty">
          <div className="big">🧭</div>
          <div className="title">Page not found</div>
          <div className="sub"><Link href="/dashboard">Back to the dashboard</Link></div>
        </div>
      </div>
    </main>
  );
}
