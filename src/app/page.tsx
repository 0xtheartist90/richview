import { redirect } from 'next/navigation';

/** The review queue is home for now. */
export default function Page() {
    redirect('/review');
}
