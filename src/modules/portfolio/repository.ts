import { query, queryOne } from '../../db/pool';
import type { UpsertPortfolioInput } from './schemas';

export interface PortfolioRow {
  id: number;
  user_id: number;
  handle: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  visibility: 'private' | 'unlisted' | 'public';
  show_certificates: boolean;
  show_projects: boolean;
  show_contact: boolean;
  links: Record<string, string>;
  created_at: Date;
  updated_at: Date;
}

export interface OwnerRow {
  id: number;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  track: string | null;
  resume_url: string | null;
}

export interface CompletedInternshipRow {
  internship_id: number;
  title: string;
  slug: string;
  level: string | null;
  duration_weeks: number | null;
  category: string | null;
  project_score: string | null;
  completed_at: Date | null;
}

export interface CertificateRow {
  certificate_no: string;
  internship_title: string;
  grade: string | null;
  status: string;
  issued_at: Date;
}

export const portfolioRepository = {
  async byUserId(userId: number): Promise<PortfolioRow | null> {
    return queryOne<PortfolioRow>(`select * from portfolios where user_id = $1`, [userId]);
  },

  /** Public lookup: only resolves non-private portfolios (privacy at the SQL layer). */
  async byPublicHandle(handle: string): Promise<PortfolioRow | null> {
    return queryOne<PortfolioRow>(
      `select * from portfolios where handle = $1 and visibility <> 'private'`,
      [handle],
    );
  },

  async handleTakenByOther(handle: string, userId: number): Promise<boolean> {
    const row = await queryOne<{ user_id: number }>(
      `select user_id from portfolios where handle = $1`,
      [handle],
    );
    return row !== null && row.user_id !== userId;
  },

  async upsert(userId: number, input: UpsertPortfolioInput): Promise<PortfolioRow> {
    const row = await queryOne<PortfolioRow>(
      `insert into portfolios
         (user_id, handle, headline, bio, location, visibility,
          show_certificates, show_projects, show_contact, links)
       values ($1, $2, $3, $4, $5, $6::portfolio_visibility, $7, $8, $9, $10::jsonb)
       on conflict (user_id) do update set
         handle = excluded.handle,
         headline = excluded.headline,
         bio = excluded.bio,
         location = excluded.location,
         visibility = excluded.visibility,
         show_certificates = excluded.show_certificates,
         show_projects = excluded.show_projects,
         show_contact = excluded.show_contact,
         links = excluded.links
       returning *`,
      [
        userId,
        input.handle,
        input.headline ?? null,
        input.bio ?? null,
        input.location ?? null,
        input.visibility,
        input.showCertificates,
        input.showProjects,
        input.showContact,
        JSON.stringify(input.links ?? {}),
      ],
    );
    if (!row) throw new Error('Portfolio upsert returned no row');
    return row;
  },

  async owner(userId: number): Promise<OwnerRow | null> {
    return queryOne<OwnerRow>(
      `select id, full_name, email, avatar_url, track, resume_url from users where id = $1`,
      [userId],
    );
  },

  async completedInternships(userId: number): Promise<CompletedInternshipRow[]> {
    return query<CompletedInternshipRow>(
      `select e.internship_id, i.title, i.slug, i.level, i.duration_weeks,
              c.name as category, e.project_score, e.completed_at
       from enrollments e
       join internships i on i.id = e.internship_id
       left join categories c on c.id = i.category_id
       where e.user_id = $1 and e.status = 'completed'
       order by e.completed_at desc nulls last`,
      [userId],
    );
  },

  async certificates(userId: number): Promise<CertificateRow[]> {
    return query<CertificateRow>(
      `select cert.certificate_no, i.title as internship_title, cert.grade,
              cert.status, cert.issued_at
       from certificates cert
       join internships i on i.id = cert.internship_id
       where cert.user_id = $1 and cert.status = 'issued'
       order by cert.issued_at desc`,
      [userId],
    );
  },

  /** Count of approved task submissions — a simple "projects shipped" stat. */
  async approvedSubmissionCount(userId: number): Promise<number> {
    const row = await queryOne<{ n: number }>(
      `select count(*)::int8 as n
       from submissions s
       join enrollments e on e.id = s.enrollment_id
       where e.user_id = $1 and s.status = 'approved'`,
      [userId],
    );
    return Number(row?.n ?? 0);
  },
};
