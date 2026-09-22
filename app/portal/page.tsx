import { redirect } from 'next/navigation';

/** The portal overview is the Student / Parent Role Centre on the dashboard. */
export default function PortalPage() {
  redirect('/dashboard');
}
