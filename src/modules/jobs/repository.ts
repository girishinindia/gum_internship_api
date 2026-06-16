import { query, queryOne } from '../../db/pool';

export interface EmployerRow {
  id: number;
  user_id: number;
  company_name: string;
  kyc_status: string;
  agreement_status: string;
}

export const jobsRepository = {
  // ---- Employers -----------------------------------------------------------
  async employerByUser(userId: number): Promise<EmployerRow | null> {
    return queryOne<EmployerRow>(`select id, user_id, company_name, kyc_status, agreement_status from employers where user_id = $1`, [userId]);
  },

  async createEmployer(userId: number, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await queryOne<Record<string, unknown>>(
      `insert into employers (user_id, company_name, website, about, contact_email, contact_phone, gstin)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, company_name as "companyName", kyc_status as "kycStatus", agreement_status as "agreementStatus"`,
      [userId, input.companyName, input.website ?? null, input.about ?? null, input.contactEmail ?? null, input.contactPhone ?? null, input.gstin ?? null],
    );
    return r ?? {};
  },

  async updateEmployer(userId: number, fields: Record<string, unknown>): Promise<void> {
    const map: Record<string, string> = {
      companyName: 'company_name', website: 'website', about: 'about',
      contactEmail: 'contact_email', contactPhone: 'contact_phone', gstin: 'gstin', logoUrl: 'logo_url',
    };
    const sets: string[] = []; const params: unknown[] = [userId];
    for (const [k, col] of Object.entries(map)) {
      if (fields[k] !== undefined) { params.push(fields[k]); sets.push(`${col} = $${params.length}`); }
    }
    if (!sets.length) return;
    await query(`update employers set ${sets.join(', ')} where user_id = $1`, params);
  },

  async employerProfile(userId: number): Promise<Record<string, unknown> | null> {
    return queryOne(
      `select id, company_name as "companyName", website, about, logo_url as "logoUrl",
              contact_email as "contactEmail", contact_phone as "contactPhone", gstin,
              kyc_status as "kycStatus", agreement_status as "agreementStatus",
              rejection_reason as "rejectionReason", created_at as "createdAt"
       from employers where user_id = $1`,
      [userId],
    );
  },

  async setEmployerKycStatus(employerId: number, status: string, reason: string | null): Promise<void> {
    await query(`update employers set kyc_status = $2, rejection_reason = $3 where id = $1`, [employerId, status, reason]);
  },

  async acceptAgreementAndSubmit(userId: number): Promise<void> {
    await query(`update employers set agreement_status = 'accepted', kyc_status = 'submitted' where user_id = $1 and kyc_status in ('pending','rejected')`, [userId]);
  },

  async listEmployersByKyc(status: string | null, page: number, limit: number): Promise<{ items: unknown[]; total: number }> {
    const offset = (page - 1) * limit;
    const items = await query(
      `select e.id, e.company_name as "companyName", u.full_name as "owner", u.email,
              e.kyc_status as "kycStatus", e.gstin, e.website, e.created_at as "createdAt",
              count(*) over()::int8 as total_count
       from employers e join users u on u.id = e.user_id
       where ($1::text is null or e.kyc_status = $1)
       order by e.created_at asc limit ${limit} offset ${offset}`,
      [status],
    );
    const total = Number((items[0] as { total_count?: number } | undefined)?.total_count ?? 0);
    return { items: items.map((r) => { const x = r as Record<string, unknown>; delete x.total_count; return x; }), total };
  },

  // ---- Jobs ----------------------------------------------------------------
  async createJob(employerId: number, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await queryOne<Record<string, unknown>>(
      `insert into jobs (employer_id, title, description, location, work_mode, employment_type, stipend_min, stipend_max, skills)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])
       returning id, title, status`,
      [employerId, input.title, input.description, input.location ?? null, input.workMode ?? 'remote',
       input.employmentType ?? 'internship', input.stipendMin ?? null, input.stipendMax ?? null, input.skills ?? []],
    );
    return r ?? {};
  },

  async jobById(jobId: number): Promise<Record<string, unknown> | null> {
    return queryOne(`select * from jobs where id = $1`, [jobId]);
  },

  async updateJob(jobId: number, fields: Record<string, unknown>): Promise<void> {
    const map: Record<string, string> = {
      title: 'title', description: 'description', location: 'location', workMode: 'work_mode',
      employmentType: 'employment_type', stipendMin: 'stipend_min', stipendMax: 'stipend_max',
    };
    const sets: string[] = []; const params: unknown[] = [jobId];
    for (const [k, col] of Object.entries(map)) {
      if (fields[k] !== undefined) { params.push(fields[k]); sets.push(`${col} = $${params.length}`); }
    }
    if (fields.skills !== undefined) { params.push(fields.skills); sets.push(`skills = $${params.length}::text[]`); }
    if (!sets.length) return;
    await query(`update jobs set ${sets.join(', ')} where id = $1`, params);
  },

  async setJobStatus(jobId: number, status: string, opts?: { publish?: boolean; reason?: string | null }): Promise<void> {
    await query(
      `update jobs set status = $2,
         published_at = case when $3 then now() else published_at end,
         rejection_reason = $4
       where id = $1`,
      [jobId, status, opts?.publish ?? false, opts?.reason ?? null],
    );
  },

  async myJobs(employerId: number): Promise<unknown[]> {
    return query(
      `select j.id, j.title, j.status, j.work_mode as "workMode", j.employment_type as "employmentType",
              j.published_at as "publishedAt", j.created_at as "createdAt",
              (select count(*) from job_applications a where a.job_id = j.id)::int8 as "applicants"
       from jobs j where j.employer_id = $1 order by j.created_at desc`,
      [employerId],
    );
  },

  async publicBoard(filters: { q?: string; workMode?: string }, page: number, limit: number): Promise<{ items: unknown[]; total: number }> {
    const where: string[] = [`j.status = 'published'`]; const params: unknown[] = [];
    if (filters.q) { params.push(`%${filters.q}%`); where.push(`(j.title ilike $${params.length} or e.company_name ilike $${params.length})`); }
    if (filters.workMode) { params.push(filters.workMode); where.push(`j.work_mode = $${params.length}`); }
    const offset = (page - 1) * limit;
    const items = await query(
      `select j.id, j.title, j.work_mode as "workMode", j.employment_type as "employmentType",
              j.location, j.stipend_min as "stipendMin", j.stipend_max as "stipendMax", j.skills,
              j.published_at as "publishedAt", e.company_name as "company", e.logo_url as "logoUrl",
              count(*) over()::int8 as total_count
       from jobs j join employers e on e.id = j.employer_id
       where ${where.join(' and ')}
       order by j.published_at desc limit ${limit} offset ${offset}`,
      params,
    );
    const total = Number((items[0] as { total_count?: number } | undefined)?.total_count ?? 0);
    return { items: items.map((r) => { const x = r as Record<string, unknown>; delete x.total_count; return x; }), total };
  },

  async publicJob(jobId: number): Promise<Record<string, unknown> | null> {
    return queryOne(
      `select j.id, j.title, j.description, j.work_mode as "workMode", j.employment_type as "employmentType",
              j.location, j.stipend_min as "stipendMin", j.stipend_max as "stipendMax", j.skills, j.status,
              j.published_at as "publishedAt", e.id as "employerId", e.company_name as "company",
              e.website, e.about as "companyAbout", e.logo_url as "logoUrl"
       from jobs j join employers e on e.id = j.employer_id where j.id = $1`,
      [jobId],
    );
  },

  // ---- Applications --------------------------------------------------------
  async apply(jobId: number, userId: number, portfolioHandle: string | null, resumeUrl: string | null, coverNote: string | null): Promise<{ id: number } | null> {
    return queryOne<{ id: number }>(
      `insert into job_applications (job_id, user_id, portfolio_handle, resume_url, cover_note)
       values ($1, $2, $3, $4, $5)
       on conflict (job_id, user_id) do nothing
       returning id`,
      [jobId, userId, portfolioHandle, resumeUrl, coverNote],
    );
  },

  async applicationsForJob(jobId: number): Promise<unknown[]> {
    return query(
      `select a.id, a.status, a.portfolio_handle as "portfolioHandle", a.resume_url as "resumeUrl",
              a.cover_note as "coverNote", a.created_at as "createdAt",
              u.id as "userId", u.full_name as "applicant", u.email
       from job_applications a join users u on u.id = a.user_id
       where a.job_id = $1 order by a.created_at desc`,
      [jobId],
    );
  },

  async applicationById(appId: number): Promise<Record<string, unknown> | null> {
    return queryOne(
      `select a.*, j.employer_id from job_applications a join jobs j on j.id = a.job_id where a.id = $1`,
      [appId],
    );
  },

  async setApplicationStatus(appId: number, status: string): Promise<void> {
    await query(`update job_applications set status = $2 where id = $1`, [appId, status]);
  },

  async myApplications(userId: number): Promise<unknown[]> {
    return query(
      `select a.id, a.status, a.created_at as "createdAt",
              j.id as "jobId", j.title, j.work_mode as "workMode", e.company_name as "company"
       from job_applications a join jobs j on j.id = a.job_id join employers e on e.id = j.employer_id
       where a.user_id = $1 order by a.created_at desc`,
      [userId],
    );
  },

  // applicant portfolio/resume snapshot at apply time
  async applicantPortfolio(userId: number): Promise<{ handle: string | null; resumeUrl: string | null }> {
    const p = await queryOne<{ handle: string | null; resume_url: string | null }>(
      `select po.handle, u.resume_url
       from users u left join portfolios po on po.user_id = u.id
       where u.id = $1`,
      [userId],
    );
    return { handle: p?.handle ?? null, resumeUrl: p?.resume_url ?? null };
  },
};
