import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/legal-shell";
import { COMPANY } from "@/lib/company";

export const metadata: Metadata = {
  title: "Terms of Service — TradePulse",
  description:
    "The terms governing your use of TradePulse, the end-of-day stock research and scanning platform for NSE-listed equities.",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="25 September 2026">
      <LegalSection heading="1. About these terms">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and {COMPANY.legalName}
          {" "}(&ldquo;TradePulse&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), the operator of the TradePulse web
          application (the &ldquo;Service&rdquo;). By creating an account, subscribing to a plan or otherwise using
          the Service, you agree to these Terms. If you do not agree with any part of them, please do not use the
          Service.
        </p>
        <p>
          The Service is a market-research and analytics tool. It processes publicly available end-of-day data for
          stocks listed on the National Stock Exchange of India (NSE) and presents scans, charts, ratings and other
          research aids. It is intended for personal, non-commercial use by individual investors and traders.
        </p>
      </LegalSection>

      <LegalSection heading="2. Not investment advice">
        <p>
          TradePulse is not a SEBI-registered investment adviser, research analyst or portfolio manager, and nothing
          provided through the Service — including scan results, relative-strength scores, base-formation annotations,
          sector views, watchlists, alerts, journal insights or any written content — constitutes investment advice, a
          research report, a recommendation or a solicitation to buy or sell any security. Outputs are mechanical
          computations on historical data and can be wrong, incomplete or stale.
        </p>
        <p>
          You alone are responsible for every trading or investment decision you take. Before acting on anything you
          see in the Service, do your own research and, where appropriate, consult a SEBI-registered investment
          adviser. Trading in equities involves substantial risk of loss.
        </p>
      </LegalSection>

      <LegalSection heading="3. Accounts and eligibility">
        <p>
          You must be at least 18 years old and legally able to enter into contracts under Indian law to create an
          account. You agree to give accurate, current and complete information when signing up — including your name,
          email address and Indian mobile number — and to keep it up to date. You are responsible for maintaining the
          confidentiality of your password and for all activity that happens under your account. Notify us
          immediately at {COMPANY.supportEmail} if you suspect unauthorised use.
        </p>
        <p>
          One person, one account. Sharing logins, scraping the Service or reselling access to its data or outputs is
          strictly prohibited and may result in immediate termination without a refund.
        </p>
      </LegalSection>

      <LegalSection heading="4. Plans, the 15-day trial and billing">
        <p>
          Every new account begins with a <strong>15-day free trial of the Pro plan</strong>. The trial is genuinely
          card-free: we do not ask for card details, UPI credentials or any autopay mandate at sign-up, and{" "}
          <strong>nothing is charged — automatically or otherwise — when the trial ends</strong>. On or after day 15
          you may explicitly choose to subscribe to Pro; if you do not, your account simply continues on the free
          Basic plan.
        </p>
        <p>
          A paid Pro subscription renews automatically each cycle (monthly, 3-month, 6-month or annual, as selected)
          through a UPI Autopay mandate or card e-mandate that you authorise yourself at the time of subscribing, via
          our payment partner Cashfree Payments. You can cancel auto-renewal at any time from your account menu;
          cancellation stops all future charges and your Pro access continues until the end of the period you have
          already paid for. Our refund and cancellation policy is set out on the{" "}
          <a href="/refund-policy" className="text-brand-text underline underline-offset-2">Refund &amp; Cancellation</a> page.
        </p>
        <p>
          Prices are shown in Indian Rupees and are inclusive of applicable taxes. We may change prices or plan
          features from time to time; changes never apply retroactively to a period you have already paid for.
          Introductory pricing may be withdrawn at any time.
        </p>
      </LegalSection>

      <LegalSection heading="5. Data, availability and delays">
        <p>
          The Service runs on end-of-day (EOD) market data that is refreshed once per trading day, normally by around
          4:00 pm IST after the NSE close. Data may occasionally be delayed, incomplete or revised by the exchange;
          we do not guarantee that any figure, indicator or scan result is accurate, complete or timely, and the
          Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We aim for high availability but do
          not warrant uninterrupted access, and we may suspend the Service for maintenance without notice.
        </p>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <p>
          You agree not to: (a) copy, redistribute, resell or commercially exploit any part of the Service or its
          data; (b) scrape, crawl or systematically extract content; (c) reverse-engineer or attempt to derive the
          source of our indicators, scans or models; (d) interfere with the Service&apos;s operation or access it
          through unauthorised means; or (e) use it in violation of applicable law, including securities law. All
          intellectual property in the Service — software, designs, indicators, scans, content and the TradePulse
          brand — remains ours or our licensors&apos;.
        </p>
      </LegalSection>

      <LegalSection heading="7. Limitation of liability">
        <p>
          To the maximum extent permitted by law, TradePulse and its directors, employees and agents will not be
          liable for any indirect, incidental, special, consequential or punitive damages, or for any loss of profits,
          trades, opportunities or data arising from your use of — or inability to use — the Service, even if advised
          of the possibility of such damages. Our total aggregate liability for any claim relating to the Service is
          limited to the subscription fees you paid to us in the three months immediately preceding the claim.
        </p>
      </LegalSection>

      <LegalSection heading="8. Suspension and termination">
        <p>
          You may stop using the Service and delete your account at any time by writing to {COMPANY.supportEmail}. We
          may suspend or terminate your account if you breach these Terms, if we are legally required to, or if we
          discontinue the Service. Where we terminate a paid subscription for reasons other than your breach, we will
          refund the unexpired portion of the fees on a pro-rata basis. Sections 2, 5, 6 and 7 survive termination.
        </p>
      </LegalSection>

      <LegalSection heading="9. Governing law and jurisdiction">
        <p>
          These Terms are governed by the laws of India. Any dispute arising out of or relating to the Service or
          these Terms shall be subject to the exclusive jurisdiction of the competent courts at Bengaluru, Karnataka.
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes and contact">
        <p>
          We may update these Terms from time to time. We will announce material changes within the Service and
          revise the &ldquo;last updated&rdquo; date above; continuing to use the Service after a change takes effect
          constitutes acceptance. Questions, requests and notices can be sent to {COMPANY.supportEmail} (
          {COMPANY.supportHours}), or by post to {COMPANY.legalName}, {COMPANY.registeredAddress}.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
