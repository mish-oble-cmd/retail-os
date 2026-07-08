import { redirect } from 'next/navigation';

export default function Home() {
  // Session check happens client-side on /dashboard (Phase 0 shell).
  redirect('/login');
}
