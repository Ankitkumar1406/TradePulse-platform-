import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/legal-shell";
import { COMPANY } from "@/lib/company";

export const metadata: Metadata = {
  title: "Privacy Policy — TradePulse",
  description:
    "How TradePulse collects, uses, stores and protects your personal data — and how you can access or delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="25 September 2026">
      <LegalSection heading="1. Who we are">
        <p>
          {COMPANY.legalName} (&ldquo;TradePulse&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) operates an end-of-day
          stock research and scanning platform for NSE-listed equities. This policy explains what personal data we
          collect, why we collect it, how long we keep it and the choices you have. It applies to the TradePulse web
          application and all related communications. We handle personal data in accordance with the (Indian)
          Information Technology Act, 2000, its reasonable-security and SPDI Rules, and the Digital Personal Data
          Protection Act, 2023.
        </p>
      </LegalSection>

      <LegalSection heading="2. What we collect">
        <p>
          <strong>Account data you give us:</strong> your full name, email address, Indian mobile number and a
          salted, one-way-hashed password. The phone number and email are used only for account, security and billing
          communication — never for spam and never sold.
        </p>
        <p>
          <strong>Research data you create:</strong> watchlists, price alerts, trading-journal entries (which may
          include trade details, notes and reflections you type) and your onboarding preferences (experience level,
          interests). This content belongs to you; we store it solely to run the Service.
        </p>
        <p>
          <strong>Payment metadata:</strong> when you subscribe, our payment partner Cashfree Payments processes the
          UPI mandate or card details — your card or UPI credentials never reach our servers. We retain only the
          payment reference, plan, amount and status needed for receipts, renewals and refunds.
        </p>
        <p>
          <strong>Technical data:</strong> sign-in timestamps, device/browser type and minimal request logs used for
          security, abuse prevention and reliability.
        </p>
      </LegalSection>

      <LegalSection heading="3. Why we use it">
        <p>
          We process your data to create and secure your account; to deliver the Service you signed up for
          (scanners, charts, watchlists, alerts, journal, calendar); to send transactional messages such as
          trial-end reminders, receipts, renewal notices and critical service announcements; to process payments
          through our partner; and to meet legal, accounting and tax obligations. We do not sell your personal data,
          and we do not use journal contents for advertising or model training.
        </p>
      </LegalSection>

      <LegalSection heading="4. Who we share it with">
        <p>
          Only with processors acting on our instructions: our database and application hosting provider
          (Supabase/managed Postgres), our payment gateway (Cashfree Payments) and our transactional email provider.
          Each is bound by contractual confidentiality and security obligations. We may also disclose data where
          legally required — for example, in response to a valid order from an Indian court, regulator or law-enforcement
          authority, in which case we will notify you unless legally prohibited.
        </p>
      </LegalSection>

      <LegalSection heading="5. Security and retention">
        <p>
          Passwords are stored only as salted hashes; traffic is encrypted in transit (TLS); and access to production
          data is restricted to a small number of authorised engineers. We retain your account and research data for
          as long as your account is active. If you cancel a paid plan, your data stays intact so you can resume
          later — see the next section for what happens when you delete your account. Backups are purged on a rolling
          90-day cycle.
        </p>
      </LegalSection>

      <LegalSection heading="6. Your choices: cancel, export, delete">
        <p>
          <strong>Cancel auto-renewal</strong> any time from your account menu — you keep Pro access until the end of
          the period you paid for, and your data is untouched.
        </p>
        <p>
          <strong>If your account is deleted</strong> (by request to {COMPANY.grievanceEmail}): your profile, login
          credentials, watchlists, alerts and journal entries are permanently erased from production systems within
          30 days, and from backups within 90 days. Before deletion we will offer you a CSV export of your journal
          and watchlists so nothing is lost. Aggregate, fully anonymised records (e.g. totals used for billing audit)
          may be retained where law requires.
        </p>
        <p>
          You may also request a copy of your data, correction of inaccurate fields, or withdrawal of a payment
          mandate — write to {COMPANY.grievanceEmail} and we will act within 30 days.
        </p>
      </LegalSection>

      <LegalSection heading="7. Cookies">
        <p>
          We use only the strictly necessary cookies/local storage required to keep you signed in, remember your
          theme preference and secure authentication flows. We do not run advertising or third-party tracking
          cookies.
        </p>
      </LegalSection>

      <LegalSection heading="8. Grievance officer">
        <p>
          Under Indian law we designate a grievance officer for privacy questions, data requests and complaints:{" "}
          {COMPANY.grievanceOfficerName}, reachable at {COMPANY.grievanceEmail}. We acknowledge every complaint
          within 48 hours and aim to resolve it within 30 days. Postal address: {COMPANY.registeredAddress}.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
