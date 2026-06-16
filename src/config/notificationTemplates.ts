/**
 * Event → template mapping (module 2.10). EDIT FREELY — this file is config.
 * Variables use {name} and are replaced from the event payload.
 * SMS texts are written to fit DLT registration (≤160 chars, {#var#} slots in
 * the DLT portal correspond to the {name} placeholders here, same order).
 * category drives notification_preferences (transactional cannot be muted).
 */
export interface EventTemplate {
  category: 'transactional' | 'reminders' | 'marketing';
  email?: { subject: string; html: string };
  sms?: { dltTemplateIdEnv: string; text: string };
  push?: { title: string; body: string };
  inApp?: { title: string; body: string };
}

export const notificationTemplates: Record<string, EventTemplate> = {
  'enrollment.activated': {
    category: 'transactional',
    email: {
      subject: 'You are enrolled — {internshipTitle}',
      html: '<p>Hi {name},</p><p>Your enrollment in <strong>{internshipTitle}</strong> is confirmed. Your offer letter will appear in your dashboard shortly.</p>',
    },
    sms: {
      dltTemplateIdEnv: 'SMS_DLT_TEMPLATE_ID_ENROLLED',
      text: 'Hi {name}, your enrollment in {internshipTitle} is confirmed. Check your GUM dashboard for next steps. - GUM Internships',
    },
    push: { title: 'Enrollment confirmed', body: '{internshipTitle} — let’s get started!' },
    inApp: { title: 'Enrollment confirmed', body: 'Welcome to {internshipTitle}.' },
  },
  'payment.captured': {
    category: 'transactional',
    email: {
      subject: 'Payment received — {orderNo}',
      html: '<p>We received ₹{amount} for order <strong>{orderNo}</strong>. GST invoice {invoiceNo} is in your dashboard.</p>',
    },
    sms: {
      dltTemplateIdEnv: 'SMS_DLT_TEMPLATE_ID_PAYMENT',
      text: 'Payment of Rs {amount} received for order {orderNo}. Invoice {invoiceNo} is in your GUM dashboard. - GUM Internships',
    },
    inApp: { title: 'Payment received', body: 'Order {orderNo} is paid. Invoice {invoiceNo}.' },
  },
  'live.reminder': {
    category: 'reminders',
    email: {
      subject: 'Reminder: {sessionTitle} {when}',
      html: '<p>Your live session <strong>{sessionTitle}</strong> starts {when} ({startAt} IST). Join from your dashboard.</p>',
    },
    sms: {
      dltTemplateIdEnv: 'SMS_DLT_TEMPLATE_ID_REMINDER',
      text: 'Reminder: {sessionTitle} starts {when} at {startAt} IST. Join via your GUM dashboard. - GUM Internships',
    },
    push: { title: 'Live session {when}', body: '{sessionTitle} at {startAt} IST' },
    inApp: { title: 'Live session {when}', body: '{sessionTitle} at {startAt} IST.' },
  },
  'submission.received': {
    category: 'transactional',
    inApp: { title: 'Submission received', body: '"{taskTitle}" v{version} is in the review queue.' },
    email: {
      subject: 'Submission received — {taskTitle}',
      html: '<p>Your submission (v{version}) for <strong>{taskTitle}</strong> is in the mentor review queue. You will hear back soon.</p>',
    },
  },
  'review.completed': {
    category: 'transactional',
    email: {
      subject: 'Your work was reviewed — {taskTitle}',
      html: '<p>Decision: <strong>{decision}</strong> (score {totalScore}).</p><p>{feedbackLine}</p>',
    },
    sms: {
      dltTemplateIdEnv: 'SMS_DLT_TEMPLATE_ID_REVIEW',
      text: 'Update: your submission for {taskTitle} was {decision}. Score {totalScore}. Details in your GUM dashboard. - GUM Internships',
    },
    push: { title: 'Review: {decision}', body: '{taskTitle} — score {totalScore}' },
    inApp: { title: 'Review completed', body: '{taskTitle}: {decision}, score {totalScore}.' },
  },
  'certificate.issued': {
    category: 'transactional',
    email: {
      subject: 'Your certificate is ready 🎓 {certificateNo}',
      html: '<p>Congratulations! Your certificate for <strong>{internshipTitle}</strong> is ready. Verify link: {verifyUrl}</p>',
    },
    sms: {
      dltTemplateIdEnv: 'SMS_DLT_TEMPLATE_ID_CERT',
      text: 'Congrats {name}! Your GUM certificate {certificateNo} for {internshipTitle} is ready. Verify: {verifyUrl} - GUM Internships',
    },
    push: { title: 'Certificate ready 🎓', body: '{internshipTitle} — {certificateNo}' },
    inApp: { title: 'Certificate issued', body: '{certificateNo} for {internshipTitle}.' },
  },
  'refund.processed': {
    category: 'transactional',
    email: {
      subject: 'Refund processed — {orderNo}',
      html: '<p>Your refund of ₹{amount} for order {orderNo} has been processed. It reaches your account in 5–7 working days.</p>',
    },
    sms: {
      dltTemplateIdEnv: 'SMS_DLT_TEMPLATE_ID_REFUND',
      text: 'Refund of Rs {amount} for order {orderNo} is processed. Expect credit in 5-7 working days. - GUM Internships',
    },
    inApp: { title: 'Refund processed', body: '₹{amount} for {orderNo}.' },
  },
  'payout.completed': {
    category: 'transactional',
    email: {
      subject: 'Payout completed — {settlementNo}',
      html: '<p>Your payout <strong>{settlementNo}</strong> of ₹{amount} was transferred (UTR {utr}). Statement is in your dashboard.</p>',
    },
    inApp: { title: 'Payout completed', body: '{settlementNo}: ₹{amount}, UTR {utr}.' },
  },
  'ticket.updated': {
    category: 'transactional',
    email: {
      subject: 'Ticket {ticketNo} updated',
      html: '<p>Your support ticket <strong>{ticketNo}</strong> status: {status}.</p><p>{note}</p>',
    },
    inApp: { title: 'Ticket {ticketNo}', body: 'Status: {status}.' },
  },
};
