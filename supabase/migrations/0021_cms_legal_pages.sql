-- 0021 — Seed & publish the standing CMS pages (legal + company) so the public
-- footer links resolve instead of 404ing. Content is the reviewed template text
-- from docs/legal/* with placeholders filled (refund window = 7 days, entity =
-- GUM Internships, jurisdiction = Gujarat). Idempotent: re-running refreshes the
-- body but never un-publishes. Edit later via Admin → Content.
set search_path = intern, public;

insert into cms_pages (slug, title, content_md, meta_title, meta_description, is_published, published_at)
values
(
  'refund-policy',
  'Refund & Cancellation Policy',
  $md$_Last updated: 17 June 2026_

This policy applies to paid programs on the GI Internship platform (operated by GUM Internships).

## 1. Cooling-off / refund window
You may request a refund within **7 days** of payment, provided you have not completed a substantial portion of the program (as indicated by your progress) or claimed a certificate.

## 2. How to request
Request a refund from **My Orders → Request refund**, or contact support@gum-internships.in with your order number. Approved refunds are processed to the original payment method via our payment partner (Razorpay), typically within **5–7 business days**.

## 3. What is refundable
- **Free programs:** no payment, nothing to refund.
- **Paid programs:** refundable within the window per §1.
- **GST:** taxes collected are refunded proportionately where the law allows.
- **Gateway fees / partial consumption:** may be deducted where applicable and disclosed at the time of the refund decision.

## 4. Non-refundable cases
After the refund window; after a certificate has been claimed; where program completion exceeds the stated threshold; or where abuse/fraud is detected.

## 5. Cohort cancellations by us
If we cancel or materially reschedule a cohort, you may transfer to another batch or receive a full refund, at your choice.

## 6. Bundles & corporate (B2B) purchases
Bundle and seat/B2B purchases may have specific terms shown at checkout; those prevail where they differ from this policy.

## 7. Contact
support@gum-internships.in · GUM Internships, Gujarat, India.$md$,
  'Refund & Cancellation Policy — GI Internship',
  'How refunds work on GI Internship: the 7-day window, how to request one, and what is refundable.',
  true, now()
),
(
  'terms',
  'Terms of Service',
  $md$_Last updated: 17 June 2026_

These Terms govern your use of the GI Internship platform ("Platform"), operated by GUM Internships, Gujarat, India ("we", "us"). By creating an account or enrolling in any program, you agree to these Terms.

## 1. Eligibility & accounts
You must provide accurate information and keep your credentials secure. You are responsible for activity under your account. We may suspend accounts that breach these Terms.

## 2. Programs, enrolment & content
Internships may be free or paid, self-paced or cohort-based, delivered by our team or vetted instructors. Access is for your personal, non-commercial learning. You may not copy, resell, or redistribute program content, videos, or materials.

## 3. Fees, taxes & payments
Paid programs show the price inclusive of applicable **GST**. Payments are processed by our payment partner (Razorpay); we do not store full card details. A GST invoice is issued to your account.

## 4. Certificates
Completion certificates are issued when the program's stated requirements are met (progress and graded work). Certificates carry a unique ID and a public verification page. Misrepresenting a certificate is prohibited.

## 5. Acceptable use
No unlawful, infringing, harassing, or harmful activity; no scraping, reverse engineering, or interfering with the Platform; no sharing of accounts or content.

## 6. Intellectual property
All Platform content and trademarks belong to us or our licensors. Work you submit remains yours; you grant us a licence to host and review it for delivering the program and (where you opt in) showcasing it in your portfolio.

## 7. Instructors & employers
Instructors and employers using the Platform agree to additional role-specific terms (KYC, agreements, content accuracy, lawful job postings).

## 8. Disclaimers & liability
The Platform is provided "as is". To the extent permitted by law, our liability is limited to the fees you paid for the program giving rise to the claim. We do not guarantee employment outcomes.

## 9. Suspension & termination
We may suspend or terminate access for breach. You may stop using the Platform at any time; certain obligations (fees due, IP, liability) survive termination.

## 10. Governing law & disputes
These Terms are governed by the laws of India. Courts at Ahmedabad, Gujarat have exclusive jurisdiction, subject to any mandatory consumer-protection rights.

## 11. Changes
We may update these Terms; material changes will be notified in-app or by email. Continued use after changes means acceptance.

## 12. Contact
support@gum-internships.in · GUM Internships, Gujarat, India.$md$,
  'Terms of Service — GI Internship',
  'The terms governing accounts, enrolment, payments, certificates and acceptable use on GI Internship.',
  true, now()
),
(
  'privacy',
  'Privacy Policy',
  $md$_Last updated: 17 June 2026_

GUM Internships ("we") is the data fiduciary for personal data processed on the GI Internship platform. This policy explains what we collect, why, and your rights.

## 1. Data we collect
- **Account:** name, email, phone, password (hashed), roles.
- **Learning:** enrolments, progress, submissions, quiz/assessment results, certificates, forum and AI-assistant activity.
- **Payments:** billing name/email/phone, GST details, order/invoice records. Card data is handled by our payment processor (Razorpay) — we do **not** store it.
- **Instructor/employer KYC:** PAN, bank details, GSTIN — **encrypted at rest**.
- **Technical:** IP address, device/browser, log and audit data.

## 2. Why we process it (purposes)
To provide programs and certificates, process payments and issue GST invoices, provide support, ensure security and prevent fraud, meet legal/tax obligations, and (with consent) send updates. We process on the basis of contract, consent, legal obligation, and legitimate interests as applicable.

## 3. Sharing
With service providers acting on our behalf — payments (Razorpay), media/storage (Bunny), email (Brevo), SMS (DLT-registered gateway), and error/analytics tools — under contract. We disclose to authorities where legally required. We do **not** sell personal data.

## 4. Storage & security
Data is stored on managed infrastructure (Supabase/Postgres) with access controls, audit logging, encryption of sensitive identifiers, and TLS in transit. We retain data only as long as needed for the purposes above or as law requires (e.g. tax/invoice records).

## 5. Your rights (DPDP Act)
You may access, correct, and erase your personal data, withdraw consent, and nominate a representative. Use **Settings → Privacy** to export or delete your data, or contact our Grievance Officer below. We respond within the timelines required by law.

## 6. Children
The Platform is intended for users of 18+; minors require verifiable parental consent as required by law.

## 7. Cookies
We use strictly necessary cookies for authentication and security. Any analytics/preference cookies are used per your consent choices.

## 8. International transfers
Where data is processed outside India, we use appropriate safeguards.

## 9. Grievance / Data Protection Officer
Grievance Officer, support@gum-internships.in, GUM Internships, Gujarat, India. We aim to acknowledge requests within 7 days.

## 10. Changes
We will post updates here and notify you of material changes.$md$,
  'Privacy Policy — GI Internship',
  'What personal data GI Internship collects, why, how it is protected, and your DPDP rights.',
  true, now()
),
(
  'about',
  'About GI Internship',
  $md$GI Internship (by GUM Internships) is an internship marketplace and delivery platform for India — connecting students and working professionals with real, project-based internships.

Programs are **free or paid**, **self-paced or cohort-based**, and delivered by our in-house team or vetted industry mentors. The core loop is simple: enrol, learn, ship weekly real-world project tasks, get mentor feedback against a rubric, and earn a verifiable completion certificate.

## What makes it different
- **Real project work**, reviewed by mentors — not just videos.
- **Verifiable certificates** with a unique ID and public verification page.
- **GST-compliant** paid programs with proper invoices.
- Built for India — mobile-first, multi-language friendly.

Questions? Reach us at support@gum-internships.in.$md$,
  'About — GI Internship',
  'GI Internship is a project-based internship marketplace and delivery platform for India.',
  true, now()
),
(
  'contact',
  'Contact us',
  $md$We are here to help.

- **Support (learners & payments):** support@gum-internships.in
- **Instructors & partnerships:** partners@gum-internships.in
- **Grievance Officer (privacy/DPDP):** support@gum-internships.in

**GUM Internships**, Gujarat, India.

For order-specific help, include your **order number** (from My Orders). We typically respond within 1–2 business days.$md$,
  'Contact — GI Internship',
  'Get in touch with GI Internship support, partnerships, and grievance contacts.',
  true, now()
)
on conflict (slug) do update set
  title = excluded.title,
  content_md = excluded.content_md,
  meta_title = excluded.meta_title,
  meta_description = excluded.meta_description,
  is_published = true,
  published_at = coalesce(cms_pages.published_at, excluded.published_at),
  updated_at = now();
