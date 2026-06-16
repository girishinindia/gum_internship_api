import { createHmac } from 'node:crypto';
import dayjs from 'dayjs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { query, queryOne } from '../../db/pool';
import { eventBus } from '../../services/eventBus';
import { jobQueue } from '../../services/jobQueue';
import { notifyService } from '../../services/notify';
import { storageService } from '../../services/storage';
import { liveService } from '../live/service';
import { quizzesService } from '../quizzes/service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * Certificates (module 2.9). Eligibility reads internships.certificate_rules:
 *   { min_progress_percent, min_quiz_percent, min_attendance_percent,
 *     min_project_score, require_all_mandatory_tasks_approved }
 * Grade bands (from project score, falling back to quiz best avg):
 *   A ≥ 85 · B ≥ 70 · C otherwise.
 */

function gradeFor(score: number): 'A' | 'B' | 'C' {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  return 'C';
}

/**
 * LinkedIn "Add to Profile" certification deep link (R3-S5 lite). Public URL —
 * needs no LinkedIn app or OAuth. Opens LinkedIn pre-filled with the cert.
 */
export function linkedinAddToProfileUrl(input: {
  title: string; certificateNo: string; issuedAt: Date; verifyUrl: string;
}): string {
  const d = new Date(input.issuedAt);
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: `${input.title} — GI Internship`,
    organizationName: 'GI Internship (Grow Up More)',
    issueYear: String(d.getFullYear()),
    issueMonth: String(d.getMonth() + 1),
    certId: input.certificateNo,
    certUrl: input.verifyUrl,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

export function certificateHash(payload: {
  certificateNo: string;
  userId: number;
  internshipId: number;
  learnerName: string;
  issuedAt: string;
}): string {
  return createHmac('sha256', env.ENCRYPTION_KEY)
    .update(`${payload.certificateNo}|${payload.userId}|${payload.internshipId}|${payload.learnerName}|${payload.issuedAt}`)
    .digest('hex');
}

interface EligibilityCheck {
  rule: string;
  required: number | boolean;
  actual: number | boolean;
  ok: boolean;
}

export const certificatesService = {
  async evaluate(enrollmentId: number): Promise<{ eligible: boolean; checks: EligibilityCheck[]; score: number }> {
    const e = await queryOne<Row>(
      `select e.*, i.certificate_rules, i.title from enrollments e join internships i on i.id = e.internship_id where e.id = $1`,
      [enrollmentId],
    );
    if (!e) throw AppError.notFound('Enrollment');
    const rules = (e.certificate_rules ?? {}) as Record<string, number | boolean>;
    const checks: EligibilityCheck[] = [];

    const progress = Number(e.progress_percent);
    if (rules.min_progress_percent !== undefined) {
      checks.push({ rule: 'min_progress_percent', required: rules.min_progress_percent, actual: progress, ok: progress >= Number(rules.min_progress_percent) });
    }
    let quizAvg = 0;
    if (rules.min_quiz_percent !== undefined) {
      const bests = await quizzesService.bestPercents(enrollmentId, e.internship_id);
      quizAvg = bests.length ? Math.round((bests.reduce((s, b) => s + b.best, 0) / bests.length) * 100) / 100 : 0;
      const ok = bests.length > 0 && bests.every((b) => b.best >= Number(rules.min_quiz_percent));
      checks.push({ rule: 'min_quiz_percent', required: rules.min_quiz_percent, actual: quizAvg, ok });
    }
    if (rules.min_attendance_percent !== undefined) {
      const att = await liveService.attendancePercent(enrollmentId);
      checks.push({ rule: 'min_attendance_percent', required: rules.min_attendance_percent, actual: att, ok: att >= Number(rules.min_attendance_percent) });
    }
    if (rules.min_project_score !== undefined) {
      const ps = Number(e.project_score ?? 0);
      checks.push({ rule: 'min_project_score', required: rules.min_project_score, actual: ps, ok: ps >= Number(rules.min_project_score) });
    }
    if (rules.require_all_mandatory_tasks_approved) {
      const counts = await queryOne<{ total: number; missing: number }>(
        `select count(*)::int8 as total,
                count(*) filter (where not exists (
                  select 1 from submissions s
                  where s.task_id = t.id and s.enrollment_id = $1 and s.status = 'approved'
                ))::int8 as missing
         from project_tasks t join projects p on p.id = t.project_id
         where p.internship_id = $2 and t.is_mandatory`,
        [enrollmentId, e.internship_id],
      );
      // Strict, not vacuous: zero mandatory tasks with the rule enabled is an
      // authoring mistake — never auto-pass it (caught by 6.1 table tests).
      const ok = (counts?.total ?? 0) > 0 && (counts?.missing ?? 1) === 0;
      checks.push({ rule: 'require_all_mandatory_tasks_approved', required: true, actual: ok, ok });
    }
    const score = e.project_score !== null ? Number(e.project_score) : quizAvg;
    return { eligible: checks.every((c) => c.ok), checks, score };
  },

  /** Claim: evaluate → issue (once per enrollment) → async PDF + email. */
  async claim(userId: number, enrollmentId: number): Promise<Record<string, unknown>> {
    const e = await queryOne<Row>(
      `select e.*, i.title, i.duration_weeks, u.full_name
       from enrollments e join internships i on i.id = e.internship_id join users u on u.id = e.user_id
       where e.id = $1`,
      [enrollmentId],
    );
    if (!e || e.user_id !== userId) throw AppError.notFound('Enrollment');
    const existing = await queryOne<{ id: number; certificate_no: string }>(
      `select id, certificate_no from certificates where enrollment_id = $1`, [enrollmentId],
    );
    if (existing) return { certificateId: existing.id, certificateNo: existing.certificate_no, alreadyIssued: true };

    const verdict = await this.evaluate(enrollmentId);
    if (!verdict.eligible) {
      throw new AppError(ErrorCodes.NOT_ELIGIBLE, 'Certificate criteria not met yet', verdict.checks);
    }
    const seq = await queryOne<{ n: number }>(`select nextval('seq_certificate_no')::int8 as n`);
    const certificateNo = `${env.CERTIFICATE_NO_PREFIX}I-${new Date().getFullYear()}-${String(seq?.n ?? 0).padStart(6, '0')}`;
    const issuedAt = new Date().toISOString();
    const grade = gradeFor(verdict.score);
    const hash = certificateHash({
      certificateNo, userId: e.user_id, internshipId: e.internship_id,
      learnerName: e.full_name, issuedAt,
    });
    const metadata = {
      learnerName: e.full_name, internshipTitle: e.title, durationWeeks: e.duration_weeks,
      issuedAt, grade, score: verdict.score,
    };
    const row = await queryOne<{ id: number }>(
      `insert into certificates (certificate_no, enrollment_id, user_id, internship_id, verification_hash, grade, metadata, issued_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [certificateNo, enrollmentId, e.user_id, e.internship_id, hash, grade, JSON.stringify(metadata), issuedAt],
    );
    await query(`update enrollments set status = 'completed', completed_at = now() where id = $1 and status = 'active'`, [enrollmentId]);
    this.queuePdf(row?.id as number);
    eventBus.emit('certificate.issued', {
      certificateId: row?.id as number, userId: e.user_id, certificateNo, internshipTitle: e.title,
    });
    return { certificateId: row?.id, certificateNo, grade, score: verdict.score, verifyUrl: `${env.CERTIFICATE_VERIFY_BASE_URL}/${certificateNo}` };
  },

  /** PUBLIC verification: validity + minimal facts, nothing else (privacy). */
  async verify(certificateNo: string): Promise<Record<string, unknown>> {
    const c = await queryOne<Row>(
      `select * from certificates where certificate_no = $1`, [certificateNo],
    );
    if (!c) return { valid: false, certificateNo, reason: 'No certificate with this number' };
    const meta = c.metadata as Row;
    const expected = certificateHash({
      certificateNo: c.certificate_no, userId: c.user_id, internshipId: c.internship_id,
      learnerName: meta.learnerName, issuedAt: meta.issuedAt,
    });
    if (expected !== c.verification_hash) {
      return { valid: false, certificateNo, reason: 'Integrity check failed' };
    }
    if (c.status === 'revoked') {
      return { valid: false, certificateNo, reason: 'Certificate revoked', revokedAt: c.revoked_at };
    }
    return {
      valid: true, certificateNo,
      learnerName: meta.learnerName, internshipTitle: meta.internshipTitle,
      durationWeeks: meta.durationWeeks, grade: c.grade, issuedAt: meta.issuedAt,
    };
  },

  async myCertificates(userId: number): Promise<unknown[]> {
    const rows = await query<Row>(
      `select c.*, i.title from certificates c join internships i on i.id = c.internship_id where c.user_id = $1`,
      [userId],
    );
    return rows.map((c) => {
      const verifyUrl = `${env.CERTIFICATE_VERIFY_BASE_URL}/${c.certificate_no}`;
      return {
        id: c.id, certificateNo: c.certificate_no, internshipTitle: c.title, grade: c.grade,
        status: c.status, issuedAt: c.issued_at,
        verifyUrl,
        // R3-S5 (lite): LinkedIn "Add to profile" deep link — no API/OAuth needed.
        linkedinAddUrl: c.status === 'issued'
          ? linkedinAddToProfileUrl({ title: String(c.title), certificateNo: c.certificate_no, issuedAt: c.issued_at as Date, verifyUrl })
          : null,
        downloadReady: c.pdf_url !== null,
      };
    });
  },

  async downloadLink(userId: number, certificateId: number): Promise<Record<string, unknown>> {
    const c = await queryOne<{ user_id: number; pdf_url: string | null; certificate_no: string }>(
      `select user_id, pdf_url, certificate_no from certificates where id = $1`, [certificateId],
    );
    if (!c || c.user_id !== userId) throw AppError.notFound('Certificate');
    if (!c.pdf_url) throw AppError.notFound('Certificate PDF (still generating)');
    return { certificateNo: c.certificate_no, ...storageService.signedPrivateUrl(c.pdf_url) };
  },

  async revoke(actorId: number, certificateId: number, reason: string): Promise<void> {
    const c = await queryOne<{ id: number; status: string }>(`select id, status from certificates where id = $1`, [certificateId]);
    if (!c) throw AppError.notFound('Certificate');
    if (c.status === 'revoked') throw AppError.conflict('Already revoked');
    await query(
      `update certificates set status = 'revoked', revoked_at = now(), revoked_reason = $2, revoked_by = $3 where id = $1`,
      [certificateId, reason, actorId],
    );
    await query(
      `insert into audit_logs (actor_id, action, entity_type, entity_id, after_data)
       values ($1, 'certificate.revoke', 'certificate', $2, $3)`,
      [actorId, certificateId, JSON.stringify({ reason })],
    );
  },

  /** A4 LANDSCAPE certificate with brand tokens + QR to the public verify page. */
  queuePdf(certificateId: number): void {
    jobQueue.enqueue(`certificate:${certificateId}`, async () => {
      const c = await queryOne<Row>(`select * from certificates where id = $1`, [certificateId]);
      if (!c || c.pdf_url) return;
      const meta = c.metadata as Row;
      const verifyUrl = `${env.CERTIFICATE_VERIFY_BASE_URL}/${c.certificate_no}`;
      const qrPng = await QRCode.toBuffer(verifyUrl, { width: 120, margin: 1 });

      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
      const chunks: Buffer[] = [];
      const done = new Promise<Buffer>((resolve) => {
        doc.on('data', (b: Buffer) => chunks.push(b));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
      });
      const W = doc.page.width;
      const H = doc.page.height;
      // frame + brand band (design tokens: #1A73E8 / #34A853 / #FBBC04 / #202124 / #5F6368)
      doc.rect(0, 0, W, H).fill('#FFFFFF');
      doc.rect(0, 0, W, 14).fill('#1A73E8');
      doc.rect(0, H - 14, W, 14).fill('#1A73E8');
      doc.lineWidth(1.5).roundedRect(28, 32, W - 56, H - 64, 10).stroke('#DADCE0');
      doc.rect(48, 56, 14, 14).fill('#4285F4');
      doc.circle(75, 63, 7).fill('#34A853');
      doc.moveTo(90, 70).lineTo(104, 70).lineTo(97, 56).fill('#FBBC04');

      doc.fillColor('#1A73E8').font('Helvetica-Bold').fontSize(24).text('GUM Internships', 0, 60, { align: 'center' });
      doc.fillColor('#5F6368').font('Helvetica').fontSize(11).text('CERTIFICATE OF COMPLETION', 0, 96, { align: 'center', characterSpacing: 3 });
      doc.fillColor('#5F6368').fontSize(12).text('This certifies that', 0, 140, { align: 'center' });
      doc.fillColor('#202124').font('Helvetica-Bold').fontSize(32).text(String(meta.learnerName), 0, 162, { align: 'center' });
      doc.fillColor('#5F6368').font('Helvetica').fontSize(12).text('has successfully completed the internship program', 0, 208, { align: 'center' });
      doc.fillColor('#202124').font('Helvetica-Bold').fontSize(20).text(String(meta.internshipTitle), 60, 232, { align: 'center', width: W - 120 });
      doc.fillColor('#5F6368').font('Helvetica').fontSize(12).text(
        `${meta.durationWeeks ? `${meta.durationWeeks}-week program · ` : ''}Grade ${c.grade} · Issued ${dayjs(meta.issuedAt as string).format('DD MMM YYYY')}`,
        0, 286, { align: 'center' },
      );
      doc.image(qrPng, W - 170, H - 170, { width: 96 });
      doc.fillColor('#5F6368').fontSize(8).text('Scan to verify', W - 174, H - 66, { width: 104, align: 'center' });
      doc.fillColor('#202124').font('Helvetica-Bold').fontSize(10).text(`Certificate no: ${c.certificate_no}`, 60, H - 110);
      doc.fillColor('#5F6368').font('Helvetica').fontSize(8).text(`Verify at ${verifyUrl}`, 60, H - 94);
      doc.fillColor('#202124').font('Helvetica-Bold').fontSize(11).text('Team GUM Internships', 60, H - 70);
      doc.end();
      const pdf = await done;

      const path = await storageService.upload('private', `certificates/${c.certificate_no}.pdf`, pdf, 'application/pdf');
      await query(`update certificates set pdf_url = $2, qr_url = $3 where id = $1`, [certificateId, path, verifyUrl]);
      const u = await queryOne<{ email: string | null; full_name: string }>(`select email, full_name from users where id = $1`, [c.user_id]);
      if (u?.email) {
        await notifyService.sendEmail(
          u.email, u.full_name,
          `Your certificate — ${meta.internshipTitle}`,
          `<p>Congratulations ${u.full_name}! Your certificate <strong>${c.certificate_no}</strong> is ready in your dashboard. Anyone can verify it at <a href="${verifyUrl}">${verifyUrl}</a>.</p>`,
        );
      }
    });
  },
};
