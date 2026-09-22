import { notFound } from 'next/navigation';
import { requireAction } from '@/lib/session';
import { buildWhtCertificateDocument, renderDocument } from '@/lib/whtCertificateSlip';
import { Printable } from '@/components/ui/printable';

export const dynamic = 'force-dynamic';

/** Print-friendly Withholding Tax Certificate — AL Rep52203485. Opened in a new tab from the
 *  payment voucher card's certificate list. */
export default async function WhtCertificatePage({ params }: { params: Promise<{ no: string }> }) {
  await requireAction('CASH_MGMT_READ');
  const { no } = await params;
  const cert = await buildWhtCertificateDocument(no);
  if (!cert) notFound();
  return <Printable html={renderDocument(cert)} />;
}
