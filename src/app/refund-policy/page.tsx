import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/legal-shell";
import { COMPANY } from "@/lib/company";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy — TradePulse",
  description:
    "How to cancel your TradePulse subscription, what happens to your access, and when refunds are issued.",
};

export default function RefundPage() {
  return (
    <LegalShell title="Refund & Cancellation Policy" updated="25 September 2026">
      <LegalSection heading="1. The 15-day trial — nothing charged, nothing to refund">
        <p>
          Every new account starts with a 15-day free trial of the Pro plan. The trial requires{" "}
          <strong>no card, no UPI credentials and no autopay mandate</strong> — you do not enter any payment details
          to start it, and <strong>nothing is auto-charged when the trial ends</strong>. On day 15 you simply choose:
          subscribe to Pro from your account menu, or continue on the free Basic plan. Because the trial never takes
          payment details, there is no possibility of an unwanted charge at trial end — no &ldquo;forgetting to
          cancel&rdquo;, no surprise debits.
        </p>
      </LegalSection>

      <LegalSection heading="2. Cancelling a paid subscription">
        <p>
          Paid Pro plans renew automatically at the start of each new cycle (monthly / 3-month / 6-month / annual)
          via the UPI Autopay or card e-mandate you authorised when subscribing. You can cancel auto-renewal at any
          time, without calling anyone or giving a reason:
        </p>
        <p>
          Open the <strong>account menu → Cancel auto-renewal</strong>, confirm once, and you are done. The
          underlying UPI/card mandate is paused immediately, so no future charge can occur. Your Pro access continues
          until the last day of the period you have already paid for; when it ends, your account moves to the free
          Basic plan automatically. You can re-subscribe whenever you like — a new cycle simply extends your validity.
        </p>
      </LegalSection>

      <LegalSection heading="3. Refunds">
        <p>
          Because nothing is charged without your explicit action and any subscription can be stopped at any time,
          subscription fees are generally <strong>non-refundable once a cycle has started</strong> — you keep full
          Pro access for the period you paid for. That said, we will issue a full refund in these situations:
        </p>
        <p>
          (a) <strong>Duplicate or incorrect charge</strong> — you were charged twice for the same cycle, or charged
          the wrong amount; (b) <strong>Technical failure</strong> — a verified defect on our side deprived you of
          the Service for a substantial part of the paid period; (c) <strong>Accidental first renewal</strong> — you
          forgot to cancel and we receive your refund request within 7 days of the renewal debit, provided you have
          not materially used the Service in that cycle; or (d) as required by applicable law or regulation.
        </p>
        <p>
          Refund requests go to {COMPANY.supportEmail} ({COMPANY.supportHours}) with your registered email and the
          payment reference. Approved refunds are returned to the original payment instrument through our payment
          partner within <strong>5–7 business days</strong>; bank posting times may add 2–3 days.
        </p>
      </LegalSection>

      <LegalSection heading="4. UPI Autopay and card mandates">
        <p>
          Cancelling auto-renewal with us pauses the mandate on our side immediately. If you additionally want the
          mandate removed from your UPI app or bank card-management page, you can revoke it there directly (Look up
          &ldquo;TradePulse Analytics&rdquo; under UPI Autopay / mandates); revoking the mandate stops future
          renewals exactly the same way.
        </p>
      </LegalSection>

      <LegalSection heading="5. Questions or disputes">
        <p>
          If you believe a charge was made in error, write to {COMPANY.supportEmail} first — most issues are resolved
          within two business days. Unresolved complaints can be escalated to our grievance officer at{" "}
          {COMPANY.grievanceEmail}, who will acknowledge within 48 hours and respond within 30 days, in line with our
          Privacy Policy.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
