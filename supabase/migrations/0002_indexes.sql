-- ============================================================================
-- GUM Internships — 0002_indexes.sql
-- Every FK gets an index (Postgres does not auto-index FK columns), plus
-- composite/partial indexes for the hot queries: public catalog filtering,
-- my-enrollments, review/moderation queues, earnings by instructor.
-- Columns already covered by a PK/UNIQUE (or as the leading column of a
-- UNIQUE constraint) are intentionally skipped.
-- ============================================================================

create extension if not exists pg_trgm;  -- catalog free-text search on title

-- --------------------------------------------------------------------------
-- Identity & access
-- --------------------------------------------------------------------------
create index idx_user_roles_user_id        on user_roles (user_id);
create index idx_user_roles_role_id        on user_roles (role_id);
create index idx_user_roles_granted_by     on user_roles (granted_by);
create index idx_user_sessions_user_id     on user_sessions (user_id);
create index idx_user_sessions_expires_at  on user_sessions (expires_at) where revoked_at is null;
create index idx_otp_codes_user_id         on otp_codes (user_id);
-- Hot: OTP verify lookup — newest unconsumed code for a destination+purpose
create index idx_otp_codes_lookup          on otp_codes (destination, purpose, created_at desc) where consumed_at is null;
create index idx_instructor_profiles_approved_by on instructor_profiles (approved_by);
-- Hot: moderator KYC queue
create index idx_instructor_profiles_kyc_queue   on instructor_profiles (kyc_status, created_at) where kyc_status = 'submitted';

-- --------------------------------------------------------------------------
-- Catalog & content
-- --------------------------------------------------------------------------
create index idx_internships_instructor_profile_id on internships (instructor_profile_id);
create index idx_internships_category_id           on internships (category_id);
create index idx_internships_created_by            on internships (created_by);
-- Hot: public catalog filtering (only published rows are ever served)
create index idx_internships_catalog on internships (category_id, pricing_type, delivery_mode, published_at desc) where status = 'published';
create index idx_internships_published_recent on internships (published_at desc) where status = 'published';
create index idx_internships_languages on internships using gin (languages) ;
create index idx_internships_title_trgm on internships using gin (title gin_trgm_ops);
-- Hot: moderation queue
create index idx_internships_review_queue on internships (created_at) where status = 'pending_review';

create index idx_batches_internship_id on internship_batches (internship_id);
-- Hot: upcoming/enrolling batches on detail pages
create index idx_batches_enrolling on internship_batches (internship_id, start_date) where status in ('scheduled', 'enrolling');

create index idx_sections_internship_id on curriculum_sections (internship_id, display_order);
create index idx_quizzes_internship_id  on quizzes (internship_id);
create index idx_lessons_section_id     on lessons (section_id, display_order);
create index idx_lessons_quiz_id        on lessons (quiz_id);

create index idx_live_sessions_internship_id       on live_sessions (internship_id);
create index idx_live_sessions_lesson_id           on live_sessions (lesson_id);
create index idx_live_sessions_recording_lesson_id on live_sessions (recording_lesson_id);
create index idx_live_sessions_created_by          on live_sessions (created_by);
-- Hot: batch schedule & reminder cron (upcoming sessions)
create index idx_live_sessions_batch_schedule on live_sessions (batch_id, scheduled_start);
create index idx_live_sessions_upcoming       on live_sessions (scheduled_start) where status = 'scheduled';

-- --------------------------------------------------------------------------
-- Commerce
-- --------------------------------------------------------------------------
create index idx_coupons_internship_id on coupons (internship_id);
create index idx_coupons_created_by    on coupons (created_by);

create index idx_orders_user_id       on orders (user_id, created_at desc);
create index idx_orders_internship_id on orders (internship_id);
create index idx_orders_batch_id      on orders (batch_id);
create index idx_orders_coupon_id     on orders (coupon_id);
create index idx_orders_status        on orders (status, created_at desc);

create index idx_payments_order_id on payments (order_id);

create index idx_refunds_order_id     on refunds (order_id);
create index idx_refunds_payment_id   on refunds (payment_id);
create index idx_refunds_requested_by on refunds (requested_by);
create index idx_refunds_decided_by   on refunds (decided_by);
-- Hot: finance refund-approval queue
create index idx_refunds_pending on refunds (created_at) where status = 'requested';

-- --------------------------------------------------------------------------
-- Enrollment & learning
-- --------------------------------------------------------------------------
-- Hot: my-enrollments (user dashboard)
create index idx_enrollments_user on enrollments (user_id, status, enrolled_at desc);
create index idx_enrollments_internship_id on enrollments (internship_id);
create index idx_enrollments_batch_id      on enrollments (batch_id);
create index idx_enrollments_order_id      on enrollments (order_id);
-- Hot: waitlist promotion (FIFO per batch)
create index idx_enrollments_waitlist on enrollments (batch_id, waitlist_position) where status = 'waitlisted';

create index idx_lesson_progress_lesson_id on lesson_progress (lesson_id);
-- enrollment_id is the leading column of lesson_progress_unique — covered.

create index idx_attendance_enrollment_id on attendance_records (enrollment_id);
create index idx_attendance_marked_by     on attendance_records (marked_by);
-- live_session_id is the leading column of attendance_unique — covered.

create index idx_quiz_questions_quiz_id on quiz_questions (quiz_id, display_order);
create index idx_quiz_attempts_enrollment_id on quiz_attempts (enrollment_id);
-- quiz_id is the leading column of quiz_attempts_unique — covered.

-- --------------------------------------------------------------------------
-- Projects & reviews
-- --------------------------------------------------------------------------
create index idx_projects_internship_id on projects (internship_id);
create index idx_project_tasks_project  on project_tasks (project_id, week_number);

create index idx_submissions_enrollment_id on submissions (enrollment_id);
-- task_id is the leading column of submissions_version_unique — covered.
-- Hot: mentor review queue (oldest pending first)
create index idx_submissions_review_queue on submissions (submitted_at) where status in ('submitted', 'under_review');
create index idx_submissions_status on submissions (status);

create index idx_submission_reviews_reviewer_id on submission_reviews (reviewer_id);

-- --------------------------------------------------------------------------
-- Earnings & payouts
-- --------------------------------------------------------------------------
-- Hot: earnings by instructor (statements, settlement runs)
create index idx_earnings_instructor on instructor_earnings (instructor_profile_id, status, created_at desc);
create index idx_earnings_internship_id on instructor_earnings (internship_id);
create index idx_earnings_order_id      on instructor_earnings (order_id);
create index idx_earnings_enrollment_id on instructor_earnings (enrollment_id);
create index idx_earnings_settlement_id on instructor_earnings (settlement_id);
-- Hot: cron that flips pending → available after the refund window
create index idx_earnings_maturing on instructor_earnings (available_at) where status = 'pending';

create index idx_settlements_instructor on payout_settlements (instructor_profile_id, created_at desc);
create index idx_settlements_initiated_by on payout_settlements (initiated_by);
create index idx_settlements_status       on payout_settlements (status);

-- --------------------------------------------------------------------------
-- Certificates
-- --------------------------------------------------------------------------
create index idx_certificates_user_id       on certificates (user_id);
create index idx_certificates_internship_id on certificates (internship_id);
create index idx_certificates_revoked_by    on certificates (revoked_by);

-- --------------------------------------------------------------------------
-- Notifications, support, CMS, audit
-- --------------------------------------------------------------------------
create index idx_notifications_user on notifications (user_id, created_at desc);
-- Hot: in-app unread badge
create index idx_notifications_unread on notifications (user_id) where channel = 'in_app' and read_at is null;
-- Hot: dispatcher retry queue
create index idx_notifications_pending on notifications (created_at) where status = 'pending';

create index idx_device_tokens_user_id on device_tokens (user_id);
-- notification_preferences.user_id is the leading column of its UNIQUE — covered.

create index idx_tickets_user_id       on support_tickets (user_id);
create index idx_tickets_assigned_to   on support_tickets (assigned_to);
create index idx_tickets_internship_id on support_tickets (internship_id);
-- Hot: support queue
create index idx_tickets_queue on support_tickets (status, priority, created_at);

create index idx_cms_banners_created_by on cms_banners (created_by);
create index idx_cms_banners_active     on cms_banners (placement, display_order) where is_active;
create index idx_cms_pages_updated_by   on cms_pages (updated_by);

create index idx_audit_logs_actor  on audit_logs (actor_id, created_at desc);
create index idx_audit_logs_entity on audit_logs (entity_type, entity_id, created_at desc);
create index idx_audit_logs_action on audit_logs (action, created_at desc);
