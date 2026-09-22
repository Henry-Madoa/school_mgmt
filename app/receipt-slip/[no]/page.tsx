import { redirect } from 'next/navigation';

/** The receipt printout moved to the unified /print route — see app/print/[kind]/[no]/page.tsx. */
export default async function ReceiptSlipPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  redirect(`/print/receipt/${encodeURIComponent(no)}`);
}
