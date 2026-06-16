import { createHmac } from 'node:crypto';
import request from 'supertest';
import { app } from '../../src/app';
import { closePool, query, queryOne } from '../../src/db/pool';
import { jobQueue } from '../../src/services/jobQueue';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Critical-path integration suite (Phase 6.1) against a real Postgres. */

const sign = (body: string): string =>
  createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET as string).update(body).digest('hex');

async function register(name: string, email: string, phone: string): Promise<string> {
  const reg = await request(app)
    .post('/v1/auth/register')
    .send({ fullName: name, email, phone, password: 'Password1' });
  expect(reg.status).toBe(201);
  const otp = reg.body.meta.dev.otp.email as string;
  await request(app).post('/v1/auth/otp/verify').send({ destination: email, purpose: 'email_verify', code: otp }).expect(200);
  return login(email, 'Password1');
}

async function login(identifier: string, password: string): Promise<string> {
  const res = await request(app).post('/v1/auth/login').send({ identifier, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

const auth = (t: string): [string, string] => ['authorization', `Bearer ${t}`];

afterAll(async () => {
  await jobQueue.drain();
  await closePool();
});

describe('auth chain: signup → otp → login → refresh rotation → logout', () => {
  it('walks the whole chain incl. reuse detection', async () => {
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ fullName: 'Chain Tester', email: 'chain@test.in', phone: '9811110001', password: 'Password1' });
    expect(reg.body.data.verificationRequired).toBe(true);

    // login before verification is blocked
    const early = await request(app).post('/v1/auth/login').send({ identifier: 'chain@test.in', password: 'Password1' });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('VERIFICATION_PENDING');

    await request(app)
      .post('/v1/auth/otp/verify')
      .send({ destination: 'chain@test.in', purpose: 'email_verify', code: reg.body.meta.dev.otp.email })
      .expect(200);

    const l1 = await request(app).post('/v1/auth/login').send({ identifier: 'chain@test.in', password: 'Password1' });
    const rt1 = l1.body.data.refreshToken as string;

    const r1 = await request(app).post('/v1/auth/refresh').send({ refreshToken: rt1 });
    expect(r1.status).toBe(200);
    const rt2 = r1.body.data.refreshToken as string;
    expect(rt2).not.toBe(rt1);

    // reuse of the rotated token revokes the fleet
    const reuse = await request(app).post('/v1/auth/refresh').send({ refreshToken: rt1 });
    expect(reuse.status).toBe(401);
    const fleet = await request(app).post('/v1/auth/refresh').send({ refreshToken: rt2 });
    expect(fleet.status).toBe(401);

    const l2 = await request(app).post('/v1/auth/login').send({ identifier: 'chain@test.in', password: 'Password1' });
    await request(app).post('/v1/auth/logout').send({ refreshToken: l2.body.data.refreshToken }).expect(200);
    await request(app).post('/v1/auth/refresh').send({ refreshToken: l2.body.data.refreshToken }).expect(401);
  });
});

describe('free enrollment + signed playback authorization', () => {
  let student: string;
  let stranger: string;
  let enrollmentId: number;

  beforeAll(async () => {
    student = await register('Free Flow', 'free@test.in', '9811110002');
    stranger = await register('Stranger', 'stranger@test.in', '9811110003');
    await query(`update lessons set bunny_video_id = 'vid-int-101', video_status = 'ready' where id = 101`);
    await query(`update lessons set bunny_video_id = 'vid-int-102', video_status = 'ready' where id = 102`);
  });

  it('enrolls instantly and produces an offer letter', async () => {
    const res = await request(app).post('/v1/enrollments').set(...auth(student)).send({ internshipId: 1, batchId: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('active');
    enrollmentId = res.body.data.id as number;
    await jobQueue.drain();
    const e = await queryOne<Row>(`select offer_letter_no from enrollments where id = $1`, [enrollmentId]);
    expect(e?.offer_letter_no).toMatch(/^OL-\d{4}-\d{6}$/);
  });

  it('blocks duplicates, non-enrolled playback, and enforces sequential unlock', async () => {
    const dup = await request(app).post('/v1/enrollments').set(...auth(student)).send({ internshipId: 1, batchId: 1 });
    expect(dup.body.error.code).toBe('ALREADY_ENROLLED');

    // stranger cannot mint a playback token for someone else's enrollment
    // (lesson 102: NON-preview — 101 is a public preview lesson by design)
    const strangerPlay = await request(app)
      .get(`/v1/lessons/102/play?enrollmentId=${enrollmentId}`)
      .set(...auth(stranger));
    expect(strangerPlay.status).toBe(403);

    const locked = await request(app).get(`/v1/lessons/102/play?enrollmentId=${enrollmentId}`).set(...auth(student));
    expect(locked.body.error.code).toBe('LESSON_LOCKED');
    expect(locked.body.error.details.blockingLessonId).toBe(101);

    const ok = await request(app).get(`/v1/lessons/101/play?enrollmentId=${enrollmentId}`).set(...auth(student));
    expect(ok.status).toBe(200);
    expect(ok.body.data.hlsUrl).toContain('token=');

    await request(app)
      .post('/v1/lessons/101/progress')
      .set(...auth(student))
      .send({ enrollmentId, completed: true })
      .expect(200);
    const unlocked = await request(app).get(`/v1/lessons/102/play?enrollmentId=${enrollmentId}`).set(...auth(student));
    expect(unlocked.status).toBe(200);
  });
});

describe('paid enrollment: order → webhook (idempotent) → earning → refund clawback', () => {
  let buyer: string;
  let admin: string;
  let orderId: number;
  let rzpOrderId: string;
  let paise: number;

  beforeAll(async () => {
    buyer = await register('Paid Flow', 'paid@test.in', '9811110004');
    admin = await login('admin@gum-demo.in', 'Password@123');
  });

  it('creates the order with exact GST math and a pending enrollment', async () => {
    const res = await request(app).post('/v1/orders').set(...auth(buyer)).send({
      internshipId: 2, batchId: 2, couponCode: 'FLUTTER500',
      billingName: 'Paid Flow', billingEmail: 'paid@test.in', billingPhone: '+919811110004', billingState: 'Maharashtra',
    });
    expect(res.status).toBe(201);
    const o = res.body.data.order as Row;
    expect(o.discountAmount).toBe(500);
    expect(o.taxableAmount).toBe(4499);
    expect(o.igstAmount).toBe(809.82);
    expect(o.totalAmount).toBe(5308.82);
    orderId = o.id as number;
    rzpOrderId = res.body.data.razorpayOrderId as string;
    paise = res.body.data.amountPaise as number;
    expect(paise).toBe(530882);

    const pending = await queryOne<Row>(`select status from enrollments where order_id = $1`, [orderId]);
    expect(pending?.status).toBe('pending_payment');
  });

  it('rejects forged signatures and flags tampered amounts (audited)', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_forged', order_id: rzpOrderId, amount: paise } } } });
    await request(app).post('/v1/payments/razorpay/webhook')
      .set('content-type', 'application/json').set('x-razorpay-signature', 'deadbeef').send(body).expect(401);

    const tampered = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_tamper', order_id: rzpOrderId, amount: 1 } } } });
    const res = await request(app).post('/v1/payments/razorpay/webhook')
      .set('content-type', 'application/json').set('x-razorpay-signature', sign(tampered)).send(tampered);
    expect(res.body.data.status).toBe('amount-mismatch-flagged');
    const audit = await queryOne<Row>(`select 1 from audit_logs where action = 'payment.amount_mismatch' and entity_id = $1`, [orderId]);
    expect(audit).not.toBeNull();
  });

  it('captures once, ignores the duplicate delivery, writes the exact earning', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_int_1', order_id: rzpOrderId, amount: paise, method: 'upi' } } } });
    const first = await request(app).post('/v1/payments/razorpay/webhook')
      .set('content-type', 'application/json').set('x-razorpay-signature', sign(body)).send(body);
    expect(first.body.data.status).toBe('processed');

    const second = await request(app).post('/v1/payments/razorpay/webhook')
      .set('content-type', 'application/json').set('x-razorpay-signature', sign(body)).send(body);
    expect(second.body.data.status).toBe('duplicate-ignored');

    await jobQueue.drain();
    const payments = await query<Row>(`select * from payments where order_id = $1 and status = 'captured'`, [orderId]);
    expect(payments).toHaveLength(1);
    const order = await queryOne<Row>(`select status, invoice_no from orders where id = $1`, [orderId]);
    expect(order?.status).toBe('paid');
    expect(order?.invoice_no).toMatch(/^INV\/\d{4}-\d{2}\/\d{4}$/);
    const enr = await queryOne<Row>(`select status from enrollments where order_id = $1`, [orderId]);
    expect(enr?.status).toBe('active');
    // earning: share 70% of (4499 − 2% of 5308.82) = 70% of 4392.82 = 3074.97
    const earning = await queryOne<Row>(`select gross_amount, amount, status from instructor_earnings where order_id = $1`, [orderId]);
    expect(Number(earning?.gross_amount)).toBe(4392.82);
    expect(Number(earning?.amount)).toBe(3074.97);
    expect(earning?.status).toBe('pending');
  });

  it('refund: request → approve → clawback reverses the earning and suspends the enrollment', async () => {
    const req1 = await request(app).post(`/v1/orders/${orderId}/refund-request`).set(...auth(buyer))
      .send({ reason: 'Cannot attend the live cohort this month' });
    expect(req1.status).toBe(201);
    const refundId = req1.body.data.id as number;

    const decide = await request(app).post(`/v1/admin/refunds/${refundId}/decision`).set(...auth(admin))
      .send({ decision: 'approved' });
    expect(decide.body.data.status).toBe('processed'); // PAYMENTS_DRY_RUN settles inline

    const earning = await queryOne<Row>(`select status from instructor_earnings where order_id = $1`, [orderId]);
    expect(earning?.status).toBe('reversed');
    const enr = await queryOne<Row>(`select status from enrollments where order_id = $1`, [orderId]);
    expect(enr?.status).toBe('suspended');
    const order = await queryOne<Row>(`select status from orders where id = $1`, [orderId]);
    expect(order?.status).toBe('refunded');
  });
});

describe('project loop: submit → resubmit → approve (+ weighted score)', () => {
  let student: string;
  let instructor: string;
  let enrollmentId: number;

  beforeAll(async () => {
    student = await register('Project Flow', 'project@test.in', '9811110005');
    instructor = await login('priya@gum-demo.in', 'Password@123');
    const row = await queryOne<Row>(
      `insert into enrollments (user_id, internship_id, batch_id, status)
       values ((select id from users where email = 'project@test.in'), 2, 2, 'active') returning id`,
    );
    enrollmentId = row?.id as number;
  });

  it('runs the full loop with rubric validation', async () => {
    const bad = await request(app).post('/v1/tasks/21/submissions').set(...auth(student))
      .send({ enrollmentId, submissionType: 'live_url', urlValue: 'https://x.in' });
    expect(bad.status).toBe(400); // task 21 accepts github_url only

    const s1 = await request(app).post('/v1/tasks/21/submissions').set(...auth(student))
      .send({ enrollmentId, submissionType: 'github_url', urlValue: 'https://github.com/p/v1' });
    expect(s1.body.data.version).toBe(1);
    const sid1 = s1.body.data.id as number;

    const wrongRubric = await request(app).post(`/v1/submissions/${sid1}/review`).set(...auth(instructor))
      .send({ decision: 'approved', rubricScores: [{ criterion: 'Nope', points: 1 }] });
    expect(wrongRubric.status).toBe(400);

    const resubmit = await request(app).post(`/v1/submissions/${sid1}/review`).set(...auth(instructor))
      .send({
        decision: 'resubmit', feedback: 'Routing breaks on back button.',
        rubricScores: [
          { criterion: 'Navigation works', points: 20 },
          { criterion: 'Project structure', points: 15 },
          { criterion: 'UI polish', points: 15 },
        ],
      });
    expect(resubmit.body.data.resubmitDueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const s2 = await request(app).post('/v1/tasks/21/submissions').set(...auth(student))
      .send({ enrollmentId, submissionType: 'github_url', urlValue: 'https://github.com/p/v2' });
    expect(s2.body.data.version).toBe(2);

    const approve = await request(app).post(`/v1/submissions/${s2.body.data.id}/review`).set(...auth(instructor))
      .send({
        decision: 'approved',
        rubricScores: [
          { criterion: 'Navigation works', points: 38 },
          { criterion: 'Project structure', points: 28 },
          { criterion: 'UI polish', points: 27 },
        ],
      });
    expect(approve.body.data.totalScore).toBe(93);

    const e = await queryOne<Row>(`select project_score from enrollments where id = $1`, [enrollmentId]);
    expect(Number(e?.project_score)).toBe(93);

    const again = await request(app).post('/v1/tasks/21/submissions').set(...auth(student))
      .send({ enrollmentId, submissionType: 'github_url', urlValue: 'https://github.com/p/v3' });
    expect(again.status).toBe(409);
  });
});

describe('certificate eligibility — table-driven across rule combinations', () => {
  let student: string;
  let studentId: number;

  beforeAll(async () => {
    student = await register('Cert Flow', 'cert@test.in', '9811110006');
    studentId = (await queryOne<Row>(`select id from users where email = 'cert@test.in'`))?.id as number;
  });

  interface Case {
    name: string;
    rules: Row;
    fixture: { progress?: number; projectScore?: number };
    eligible: boolean;
    failingRule?: string;
  }
  const CASES: Case[] = [
    { name: 'progress rule passes', rules: { min_progress_percent: 50 }, fixture: { progress: 80 }, eligible: true },
    { name: 'progress rule fails', rules: { min_progress_percent: 90 }, fixture: { progress: 80 }, eligible: false, failingRule: 'min_progress_percent' },
    { name: 'quiz rule fails with no attempts', rules: { min_quiz_percent: 50 }, fixture: {}, eligible: false, failingRule: 'min_quiz_percent' },
    { name: 'project score gate', rules: { min_project_score: 70 }, fixture: { projectScore: 90.5 }, eligible: true },
    { name: 'mandatory tasks unmet', rules: { require_all_mandatory_tasks_approved: true }, fixture: {}, eligible: false, failingRule: 'require_all_mandatory_tasks_approved' },
    { name: 'combined: one of two fails', rules: { min_progress_percent: 50, min_project_score: 95 }, fixture: { progress: 80, projectScore: 90 }, eligible: false, failingRule: 'min_project_score' },
  ];

  it.each(CASES)('$name', async (c) => {
    const internship = await queryOne<Row>(
      `insert into internships (instructor_profile_id, category_id, created_by, title, slug, pricing_type, price,
                                delivery_mode, pace_type, certificate_rules, status, published_at)
       values (1, 1, 2, $1, $2, 'free', 0, 'recorded', 'self_paced', $3, 'published', now())
       returning id`,
      [`Cert Case ${c.name}`, `cert-case-${CASES.indexOf(c)}`, JSON.stringify(c.rules)],
    );
    const enr = await queryOne<Row>(
      `insert into enrollments (user_id, internship_id, status, progress_percent, project_score)
       values ($1, $2, 'active', $3, $4) returning id`,
      [studentId, internship?.id, c.fixture.progress ?? 0, c.fixture.projectScore ?? null],
    );
    const res = await request(app)
      .get(`/v1/enrollments/${enr?.id}/certificate/eligibility`)
      .set(...auth(student));
    expect(res.status).toBe(200);
    expect(res.body.data.eligible).toBe(c.eligible);
    if (!c.eligible && c.failingRule) {
      const failing = (res.body.data.checks as Row[]).filter((x) => !x.ok).map((x) => x.rule);
      expect(failing).toContain(c.failingRule);
    }
  });

  it('issues + verifies + detects tamper end-to-end on a passing enrollment', async () => {
    const internship = await queryOne<Row>(
      `insert into internships (instructor_profile_id, category_id, created_by, title, slug, pricing_type, price,
                                delivery_mode, pace_type, certificate_rules, status, published_at)
       values (1, 1, 2, 'Cert Issue Case', 'cert-issue-case', 'free', 0, 'recorded', 'self_paced',
               '{"min_progress_percent": 50}', 'published', now()) returning id`,
    );
    const enr = await queryOne<Row>(
      `insert into enrollments (user_id, internship_id, status, progress_percent)
       values ($1, $2, 'active', 100) returning id`,
      [studentId, internship?.id],
    );
    const claim = await request(app).post(`/v1/enrollments/${enr?.id}/certificate`).set(...auth(student));
    expect(claim.status).toBe(201);
    const certNo = claim.body.data.certificateNo as string;
    expect(certNo).toMatch(/^GUMI-\d{4}-\d{6}$/);

    const ok = await request(app).get(`/v1/verify/${certNo}`);
    expect(ok.body.data.valid).toBe(true);
    expect(Object.keys(ok.body.data).sort()).toEqual(
      ['certificateNo', 'durationWeeks', 'grade', 'internshipTitle', 'issuedAt', 'learnerName', 'valid'].sort(),
    );

    await query(`update certificates set metadata = jsonb_set(metadata, '{learnerName}', '"Forged Name"') where certificate_no = $1`, [certNo]);
    const tampered = await request(app).get(`/v1/verify/${certNo}`);
    expect(tampered.body.data.valid).toBe(false);
    expect(tampered.body.data.reason).toBe('Integrity check failed');
  });
});

describe('security regressions (6.3 fixes)', () => {
  it('SEC-01/02: stranger cannot read another enrollment eligibility or attendance', async () => {
    const stranger = await register('Sec Probe', 'probe@test.in', '9811110007');
    await request(app).get('/v1/enrollments/1/certificate/eligibility').set(...auth(stranger)).expect(404);
    await request(app).get('/v1/enrollments/1/attendance').set(...auth(stranger)).expect(404);
  });

  it('SEC-03: bunny webhook requires the header secret (query param dead)', async () => {
    await request(app).post('/v1/media/bunny/webhook?secret=change-me').send({ VideoGuid: 'x', Status: 3 }).expect(401);
    const ok = await request(app).post('/v1/media/bunny/webhook').set('x-webhook-secret', 'test')
      .send({ VideoGuid: 'nonexistent', Status: 3 });
    expect(ok.status).toBe(200);
  });

  it('SEC-05: tokens signed with the wrong algorithm are rejected', async () => {
    // unsigned (alg=none) token with a valid-looking payload
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: '1', roles: ['super_admin'] })).toString('base64url');
    await request(app).get('/v1/users/me').set('authorization', `Bearer ${header}.${payload}.`).expect(401);
  });
});
