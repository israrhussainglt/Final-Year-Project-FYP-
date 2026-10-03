import Link from "next/link";
import { BookAppointmentForm } from "@/components/booking/BookAppointmentForm";
import { PulseMark } from "@/components/PulseMark";

// Public, unauthenticated by design — this is the entry point for someone who
// has no PulseID record yet. Deliberately NOT under /patient/* so the existing
// middleware (which redirects anything there without a patient session to
// /patient/login) doesn't intercept it.
export default function BookAppointmentPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-teal" />
      <div className="flex-1 px-6 md:px-10 py-10">
        <div className="max-w-3xl mx-auto">
          <Link href="/" aria-label="PulseID home" className="inline-block mb-8">
            <PulseMark className="w-28 h-6" />
          </Link>

          <span className="inline-flex items-center rounded-full bg-teal-light px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-teal-dark mb-3">
            Book a meeting
          </span>
          <div className="eyebrow text-teal mb-2">Request an appointment</div>
          <h1 className="font-display text-3xl md:text-4xl mb-4">See a doctor</h1>
          <p className="text-sm text-sage leading-relaxed max-w-xl mb-8">
            Send your details and any reports you already have, choose the doctor you'd like to see,
            and they'll confirm a date and time for you. Nothing is added to your medical record
            until a doctor reviews it.
          </p>

          <BookAppointmentForm />

          <p className="text-sm text-sage mt-8">
            Already registered?{" "}
            <Link href="/patient/login" className="text-teal-dark font-medium hover:underline">
              Sign in to My Reports →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}