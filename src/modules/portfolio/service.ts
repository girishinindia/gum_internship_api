import { env } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { portfolioRepository as repo } from './repository';
import type { CertificateRow, CompletedInternshipRow, OwnerRow, PortfolioRow } from './repository';
import type { UpsertPortfolioInput } from './schemas';

function verifyUrl(certificateNo: string): string {
  return `${env.CERTIFICATE_VERIFY_BASE_URL}/${certificateNo}`;
}

function shapeCertificate(c: CertificateRow): Record<string, unknown> {
  return {
    certificateNo: c.certificate_no,
    internshipTitle: c.internship_title,
    grade: c.grade,
    issuedAt: c.issued_at,
    verifyUrl: verifyUrl(c.certificate_no),
  };
}

function shapeInternship(i: CompletedInternshipRow): Record<string, unknown> {
  return {
    internshipId: i.internship_id,
    title: i.title,
    slug: i.slug,
    level: i.level,
    durationWeeks: i.duration_weeks,
    category: i.category,
    projectScore: i.project_score !== null ? Number(i.project_score) : null,
    completedAt: i.completed_at,
  };
}

export interface PortfolioStats {
  completedInternships: number;
  certificates: number;
  projectsShipped: number;
  averageScore: number | null;
}

function computeStats(completed: CompletedInternshipRow[], certs: CertificateRow[], shipped: number): PortfolioStats {
  const scores = completed.map((c) => (c.project_score !== null ? Number(c.project_score) : null)).filter((n): n is number => n !== null);
  const avg = scores.length ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10 : null;
  return {
    completedInternships: completed.length,
    certificates: certs.length,
    projectsShipped: shipped,
    averageScore: avg,
  };
}

/** Full aggregation used by the resume builder and the owner's own view. */
export async function aggregate(userId: number): Promise<{
  owner: OwnerRow;
  completed: CompletedInternshipRow[];
  certificates: CertificateRow[];
  stats: PortfolioStats;
}> {
  const owner = await repo.owner(userId);
  if (!owner) throw AppError.notFound('User');
  const [completed, certificates, shipped] = await Promise.all([
    repo.completedInternships(userId),
    repo.certificates(userId),
    repo.approvedSubmissionCount(userId),
  ]);
  return { owner, completed, certificates, stats: computeStats(completed, certificates, shipped) };
}

export const portfolioService = {
  aggregate,

  /** The caller's own portfolio + their aggregated achievements (always full view). */
  async getMine(userId: number): Promise<Record<string, unknown>> {
    const portfolio = await repo.byUserId(userId);
    const { owner, completed, certificates, stats } = await aggregate(userId);
    return {
      portfolio: portfolio ? shapePortfolio(portfolio) : null,
      publicUrl: portfolio ? `${env.WEB_APP_URL}/u/${portfolio.handle}` : null,
      profile: {
        fullName: owner.full_name,
        avatarUrl: owner.avatar_url,
        track: owner.track,
        email: owner.email,
        resumeUrl: owner.resume_url,
      },
      stats,
      completedInternships: completed.map(shapeInternship),
      certificates: certificates.map(shapeCertificate),
    };
  },

  async upsertMine(userId: number, input: UpsertPortfolioInput): Promise<Record<string, unknown>> {
    if (await repo.handleTakenByOther(input.handle, userId)) {
      throw new AppError(ErrorCodes.CONFLICT, 'That handle is already taken');
    }
    const row = await repo.upsert(userId, input);
    return { ...shapePortfolio(row), publicUrl: `${env.WEB_APP_URL}/u/${row.handle}` };
  },

  /**
   * Public credential wallet (GET /p/:handle). Privacy-aware:
   *  - private  → 404 (resolved out at the SQL layer)
   *  - toggles  → omit certificates / projects / contact per the owner's choice
   */
  async getPublic(handle: string): Promise<Record<string, unknown>> {
    const portfolio = await repo.byPublicHandle(handle);
    if (!portfolio) throw AppError.notFound('Portfolio');
    const owner = await repo.owner(portfolio.user_id);
    if (!owner) throw AppError.notFound('Portfolio');

    const [completed, certificates, shipped] = await Promise.all([
      portfolio.show_projects ? repo.completedInternships(portfolio.user_id) : Promise.resolve([]),
      portfolio.show_certificates ? repo.certificates(portfolio.user_id) : Promise.resolve([]),
      repo.approvedSubmissionCount(portfolio.user_id),
    ]);

    return {
      handle: portfolio.handle,
      headline: portfolio.headline,
      bio: portfolio.bio,
      location: portfolio.location,
      fullName: owner.full_name,
      avatarUrl: owner.avatar_url,
      track: owner.track,
      links: portfolio.links,
      contact: portfolio.show_contact ? { email: owner.email } : null,
      stats: computeStats(completed, certificates, shipped),
      certificates: portfolio.show_certificates ? certificates.map(shapeCertificate) : [],
      completedInternships: portfolio.show_projects ? completed.map(shapeInternship) : [],
    };
  },
};

function shapePortfolio(p: PortfolioRow): Record<string, unknown> {
  return {
    handle: p.handle,
    headline: p.headline,
    bio: p.bio,
    location: p.location,
    visibility: p.visibility,
    showCertificates: p.show_certificates,
    showProjects: p.show_projects,
    showContact: p.show_contact,
    links: p.links,
    updatedAt: p.updated_at,
  };
}
