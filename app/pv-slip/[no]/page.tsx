import { redirect } from 'next/navigation';

/** The voucher printout moved to the unified /print route — see app/print/[kind]/[no]/page.tsx. */
export default async function PvSlipPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  redirect(`/print/payment-voucher/${encodeURIComponent(no)}`);
}
