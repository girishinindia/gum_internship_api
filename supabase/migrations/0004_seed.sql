-- ============================================================================
-- GUM Internships — 0004_seed.sql  (DEV/STAGING ONLY — never run in prod)
--
-- Deterministic INTEGER id scheme (stable handles for API testing).
-- All PKs are `generated always as identity`, so explicit ids use
-- OVERRIDING SYSTEM VALUE and each identity sequence is setval'd at the end.
--
--   roles            1..6   (created in 0001)
--   users            1..5
--   instructor_profiles 1..3
--   categories       1..8
--   internships      1..4
--   internship_batches 1..4
--   curriculum_sections  XY  (X=internship, Y=section: 11,12,21,22,31,32,41,42)
--   lessons          X0Y (X=internship, Y=lesson: 101..106, 201..206, 301..306, 401..404)
--   quizzes          1..4
--   quiz_questions   X0Q (101..105, 201..205, 301..305, 401..405)
--   projects         1..4
--   project_tasks    XW  (X=internship, W=week: 11..14, 21..24, 31..34, 41..44)
--   coupons          1..3
--   live_sessions    1..2
--
-- Demo password for ALL seeded users: Password@123
-- (bcrypt cost 10: $2b$10$ZYwFCTFGVwASpfVtGF2oGuaKW/a7Xybi.I8saeAUnG7fJSiJU4U7G)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- USERS: 1 super_admin, 2 internal instructors, 1 external instructor, 1 demo student
-- ----------------------------------------------------------------------------

insert into users (id, email, phone, password_hash, full_name, status, email_verified_at, phone_verified_at, marketing_consent) overriding system value values
  (1, 'admin@gum-demo.in',   '+919800000001', '$2b$10$ZYwFCTFGVwASpfVtGF2oGuaKW/a7Xybi.I8saeAUnG7fJSiJU4U7G', 'Girish Kumar',  'active', now(), now(), false),
  (2, 'ananya@gum-demo.in',  '+919800000002', '$2b$10$ZYwFCTFGVwASpfVtGF2oGuaKW/a7Xybi.I8saeAUnG7fJSiJU4U7G', 'Ananya Sharma', 'active', now(), now(), false),
  (3, 'rahul@gum-demo.in',   '+919800000003', '$2b$10$ZYwFCTFGVwASpfVtGF2oGuaKW/a7Xybi.I8saeAUnG7fJSiJU4U7G', 'Rahul Verma',   'active', now(), now(), false),
  (4, 'priya@gum-demo.in',   '+919800000004', '$2b$10$ZYwFCTFGVwASpfVtGF2oGuaKW/a7Xybi.I8saeAUnG7fJSiJU4U7G', 'Priya Nair',    'active', now(), now(), true),
  (5, 'student@gum-demo.in', '+919800000005', '$2b$10$ZYwFCTFGVwASpfVtGF2oGuaKW/a7Xybi.I8saeAUnG7fJSiJU4U7G', 'Arjun Mehta',   'active', now(), now(), true);

-- role ids: 1 student, 2 instructor, 3 moderator, 4 finance_admin, 5 support, 6 super_admin
insert into user_roles (user_id, role_id, granted_by) values
  (1, 6, null),   -- Girish: super_admin
  (2, 2, 1),      -- Ananya: internal instructor
  (3, 2, 1),      -- Rahul: internal instructor
  (4, 2, 1),      -- Priya: external instructor
  (4, 1, null),   -- Priya also keeps student role from signup
  (5, 1, null);   -- Arjun: student

-- ----------------------------------------------------------------------------
-- INSTRUCTOR PROFILES (2 internal, 1 external KYC-approved)
-- ----------------------------------------------------------------------------

insert into instructor_profiles
  (id, user_id, instructor_type, bio, expertise, linkedin_url, kyc_status, agreement_status, agreement_signed_at, revenue_share_percent, bank_account_last4, bank_ifsc, approved_by, approved_at) overriding system value values
  (1, 2, 'internal',
   'Senior full-stack engineer and lead mentor of the GUM in-house team.',
   array['javascript','react','node','postgres'], 'https://linkedin.com/in/ananya-demo',
   'approved', 'signed', now(), 0, null, null, 1, now()),
  (2, 3, 'internal',
   'Data scientist with 8 years across analytics and ML platforms.',
   array['python','pandas','machine-learning','sql'], 'https://linkedin.com/in/rahul-demo',
   'approved', 'signed', now(), 0, null, null, 1, now()),
  (3, 4, 'external',
   'Google Developer Expert for Flutter; founder of a mobile studio in Kochi.',
   array['flutter','dart','firebase','mobile'], 'https://linkedin.com/in/priya-demo',
   'approved', 'signed', now(), 70.00, '4321', 'HDFC0001234', 1, now());

-- ----------------------------------------------------------------------------
-- CATEGORIES (8)
-- ----------------------------------------------------------------------------

insert into categories (id, name, slug, description, display_order) overriding system value values
  (1, 'Web Development',   'web-development',   'Frontend, backend and full-stack web internships', 1),
  (2, 'Flutter',           'flutter',           'Cross-platform mobile development with Flutter',   2),
  (3, 'Python',            'python',            'Python programming and automation',                3),
  (4, 'Data Science',      'data-science',      'Analytics, visualisation and statistics',          4),
  (5, 'AI / ML',           'ai-ml',             'Machine learning and applied AI',                  5),
  (6, 'Digital Marketing', 'digital-marketing', 'SEO, social media and performance marketing',      6),
  (7, 'HR',                'hr',                'Human resources and talent operations',            7),
  (8, 'Finance',           'finance',           'Accounting, markets and fintech fundamentals',     8);

-- ----------------------------------------------------------------------------
-- INTERNSHIPS (4: free+recorded, paid+live, paid+hybrid, free+project_only)
-- All cohort-based so each can carry the seeded batch below.
-- ----------------------------------------------------------------------------

insert into internships
  (id, instructor_profile_id, category_id, created_by, title, slug, short_description, description,
   outcomes, prerequisites, languages, provider_type, pricing_type, price, delivery_mode, pace_type,
   duration_weeks, thumbnail_url, certificate_rules, status, published_at) overriding system value values

  -- 1) FREE + RECORDED (system, internal instructor Ananya)
  (1, 1, 1, 2,
   'Full-Stack Web Development Internship', 'full-stack-web-development-internship',
   'Build and ship a production-grade MERN application in 4 weeks.',
   'A hands-on internship where you build a complete web application: REST API, React frontend, auth, and deployment. Weekly real-world tasks reviewed by mentors.',
   array['Build a REST API with Express','Build a React SPA','Deploy a full-stack app','Work with Git like a professional'],
   array['Basic HTML/CSS/JS'], array['english','hindi'],
   'system', 'free', 0, 'recorded', 'batch', 4, 'https://cdn.gum-demo.in/thumbs/web.jpg',
   '{"min_progress_percent": 80, "min_quiz_percent": 60, "require_all_mandatory_tasks_approved": true}',
   'published', now()),

  -- 2) PAID + LIVE (external instructor Priya, revenue share 70%)
  (2, 3, 2, 4,
   'Flutter App Development Internship', 'flutter-app-development-internship',
   'Live cohort: design, build and publish a Flutter app with an industry mentor.',
   'Twice-weekly live sessions with a Google Developer Expert. You will architect a real app with Riverpod, integrate APIs with Dio, and publish a release build.',
   array['Build a multi-screen Flutter app','Manage state with Riverpod','Integrate REST APIs with Dio','Prepare a Play Store release'],
   array['Basic programming in any language'], array['english'],
   'external', 'paid', 4999.00, 'live', 'batch', 6, 'https://cdn.gum-demo.in/thumbs/flutter.jpg',
   '{"min_progress_percent": 70, "min_quiz_percent": 60, "require_all_mandatory_tasks_approved": true, "min_attendance_percent": 70}',
   'published', now()),

  -- 3) PAID + HYBRID (system, internal instructor Rahul)
  (3, 2, 4, 3,
   'Data Science with Python Internship', 'data-science-with-python-internship',
   'Recorded foundations plus weekly live problem-solving labs.',
   'Learn pandas, visualisation and basic ML from recorded lessons, then apply them in weekly live labs on real Indian datasets (UPI transactions, census, agri prices).',
   array['Clean and analyse data with pandas','Visualise insights with matplotlib','Build a first ML model','Present findings like an analyst'],
   array['School-level mathematics','Basic Python helpful'], array['english','hindi'],
   'system', 'paid', 7999.00, 'hybrid', 'batch', 6, 'https://cdn.gum-demo.in/thumbs/ds.jpg',
   '{"min_progress_percent": 75, "min_quiz_percent": 65, "require_all_mandatory_tasks_approved": true}',
   'published', now()),

  -- 4) FREE + PROJECT_ONLY (system, internal instructor Ananya)
  (4, 1, 6, 2,
   'Digital Marketing Portfolio Internship', 'digital-marketing-portfolio-internship',
   'No lectures — four weekly briefs that build a real marketing portfolio.',
   'A project-only internship: each week you receive a brief (SEO audit, social calendar, ad copy, analytics report) with reference documents, submit your work, and get rubric-scored mentor feedback.',
   array['Run an SEO audit','Plan a 30-day content calendar','Write conversion ad copy','Read Google Analytics like a marketer'],
   array['None'], array['english'],
   'system', 'free', 0, 'project_only', 'batch', 4, 'https://cdn.gum-demo.in/thumbs/dm.jpg',
   '{"require_all_mandatory_tasks_approved": true, "min_quiz_percent": 50}',
   'published', now());

-- ----------------------------------------------------------------------------
-- BATCHES (one per internship)
-- ----------------------------------------------------------------------------

insert into internship_batches (id, internship_id, name, start_date, end_date, enrollment_deadline, seats_total, waitlist_enabled, waitlist_limit, status) overriding system value values
  (1, 1, 'July 2026 Cohort',      '2026-07-01', '2026-07-28', '2026-06-29 18:30:00+00', 200, false, null, 'enrolling'),
  (2, 2, 'July 2026 Live Cohort', '2026-07-06', '2026-08-14', '2026-07-03 18:30:00+00',  30, true,  15,  'enrolling'),
  (3, 3, 'August 2026 Cohort',    '2026-08-03', '2026-09-11', '2026-07-31 18:30:00+00',  50, true,  20,  'scheduled'),
  (4, 4, 'July 2026 Cohort',      '2026-07-01', '2026-07-28', '2026-06-29 18:30:00+00', 100, false, null, 'enrolling');

-- ----------------------------------------------------------------------------
-- CURRICULUM SECTIONS (2 per internship; id = internship*10 + seq)
-- ----------------------------------------------------------------------------

insert into curriculum_sections (id, internship_id, title, display_order) overriding system value values
  (11, 1, 'Backend Foundations with Express', 1),
  (12, 1, 'React Frontend and Deployment',    2),
  (21, 2, 'Flutter Fundamentals (Live)',      1),
  (22, 2, 'State, APIs and Release (Live)',   2),
  (31, 3, 'Python and Pandas Foundations',    1),
  (32, 3, 'Visualisation, ML and Live Labs',  2),
  (41, 4, 'Briefs and Reference Material',    1),
  (42, 4, 'Wrap-up and Assessment',           2);

-- ----------------------------------------------------------------------------
-- QUIZZES (1 per internship) — inserted before lessons so quiz lessons can link
-- ----------------------------------------------------------------------------

insert into quizzes (id, internship_id, title, description, pass_percent, time_limit_minutes, max_attempts, is_published) overriding system value values
  (1, 1, 'Full-Stack Fundamentals Quiz', 'Covers Express, REST and React basics.', 60, 15, 3, true),
  (2, 2, 'Flutter Essentials Quiz',      'Widgets, state and packaging.',          60, 15, 3, true),
  (3, 3, 'Data Science Basics Quiz',     'Pandas, plotting and ML concepts.',      65, 20, 3, true),
  (4, 4, 'Marketing Concepts Quiz',      'SEO, content and analytics concepts.',   50, 10, 3, true);

insert into quiz_questions (id, quiz_id, question_text, question_type, options, correct_options, explanation, marks, display_order) overriding system value values
  -- Quiz 1: Full-stack
  (101, 1, 'Which HTTP method is conventionally used to update part of a resource?', 'single_choice',
   '[{"id":"a","text":"GET"},{"id":"b","text":"PATCH"},{"id":"c","text":"DELETE"},{"id":"d","text":"HEAD"}]', '["b"]',
   'PATCH applies a partial update; PUT replaces the whole resource.', 1, 1),
  (102, 1, 'Express middleware functions receive which arguments?', 'single_choice',
   '[{"id":"a","text":"req, res, next"},{"id":"b","text":"input, output"},{"id":"c","text":"ctx only"},{"id":"d","text":"event, context"}]', '["a"]',
   'Standard Express middleware signature is (req, res, next).', 1, 2),
  (103, 1, 'React re-renders a component when its state changes.', 'true_false',
   '[{"id":"a","text":"True"},{"id":"b","text":"False"}]', '["a"]',
   'State changes trigger reconciliation and re-render.', 1, 3),
  (104, 1, 'Which are valid HTTP status code families for client errors and server errors?', 'multiple_choice',
   '[{"id":"a","text":"4xx"},{"id":"b","text":"2xx"},{"id":"c","text":"5xx"},{"id":"d","text":"1xx"}]', '["a","c"]',
   '4xx = client errors, 5xx = server errors.', 2, 4),
  (105, 1, 'Which command records your staged changes in Git history?', 'single_choice',
   '[{"id":"a","text":"git push"},{"id":"b","text":"git add"},{"id":"c","text":"git commit"},{"id":"d","text":"git fetch"}]', '["c"]',
   'git commit writes the staged snapshot to history.', 1, 5),

  -- Quiz 2: Flutter
  (201, 2, 'Everything you see on screen in Flutter is a…', 'single_choice',
   '[{"id":"a","text":"Fragment"},{"id":"b","text":"Widget"},{"id":"c","text":"Activity"},{"id":"d","text":"Layout"}]', '["b"]',
   'Flutter composes UIs entirely from widgets.', 1, 1),
  (202, 2, 'A StatelessWidget can call setState to update itself.', 'true_false',
   '[{"id":"a","text":"True"},{"id":"b","text":"False"}]', '["b"]',
   'Only State objects of StatefulWidgets have setState.', 1, 2),
  (203, 2, 'Which package does this internship use for HTTP calls?', 'single_choice',
   '[{"id":"a","text":"http"},{"id":"b","text":"chopper"},{"id":"c","text":"dio"},{"id":"d","text":"graphql"}]', '["c"]',
   'The stack standardises on Dio for interceptors and typing.', 1, 3),
  (204, 2, 'Which are valid Riverpod provider types?', 'multiple_choice',
   '[{"id":"a","text":"StateNotifierProvider"},{"id":"b","text":"FutureProvider"},{"id":"c","text":"BlocProvider"},{"id":"d","text":"Provider"}]', '["a","b","d"]',
   'BlocProvider belongs to the bloc package, not Riverpod.', 2, 4),
  (205, 2, 'Which command produces a release Android build?', 'single_choice',
   '[{"id":"a","text":"flutter run"},{"id":"b","text":"flutter build apk --release"},{"id":"c","text":"flutter doctor"},{"id":"d","text":"flutter pub get"}]', '["b"]',
   'flutter build apk --release creates the optimised binary.', 1, 5),

  -- Quiz 3: Data Science
  (301, 3, 'Which pandas method shows the first rows of a DataFrame?', 'single_choice',
   '[{"id":"a","text":"df.top()"},{"id":"b","text":"df.head()"},{"id":"c","text":"df.first()"},{"id":"d","text":"df.peek()"}]', '["b"]',
   'df.head(n) returns the first n rows (default 5).', 1, 1),
  (302, 3, 'Dropping rows with missing values always improves a model.', 'true_false',
   '[{"id":"a","text":"True"},{"id":"b","text":"False"}]', '["b"]',
   'It can discard signal and bias the sample; imputation is often better.', 1, 2),
  (303, 3, 'Which plot best shows the distribution of a single numeric column?', 'single_choice',
   '[{"id":"a","text":"Histogram"},{"id":"b","text":"Pie chart"},{"id":"c","text":"Line chart"},{"id":"d","text":"Radar chart"}]', '["a"]',
   'Histograms bin values to reveal the distribution shape.', 1, 3),
  (304, 3, 'Which of these are supervised learning tasks?', 'multiple_choice',
   '[{"id":"a","text":"Classification"},{"id":"b","text":"Clustering"},{"id":"c","text":"Regression"},{"id":"d","text":"Dimensionality reduction"}]', '["a","c"]',
   'Clustering and dimensionality reduction are unsupervised.', 2, 4),
  (305, 3, 'train_test_split is used to…', 'single_choice',
   '[{"id":"a","text":"Speed up training"},{"id":"b","text":"Hold out data to evaluate generalisation"},{"id":"c","text":"Normalise features"},{"id":"d","text":"Remove outliers"}]', '["b"]',
   'Held-out test data estimates real-world performance.', 1, 5),

  -- Quiz 4: Marketing
  (401, 4, 'What does SEO stand for?', 'single_choice',
   '[{"id":"a","text":"Search Engine Optimisation"},{"id":"b","text":"Social Engagement Outreach"},{"id":"c","text":"Sales Enablement Operations"},{"id":"d","text":"Site Error Override"}]', '["a"]',
   'SEO improves organic visibility in search results.', 1, 1),
  (402, 4, 'CTR is the ratio of clicks to impressions.', 'true_false',
   '[{"id":"a","text":"True"},{"id":"b","text":"False"}]', '["a"]',
   'Click-through rate = clicks ÷ impressions.', 1, 2),
  (403, 4, 'Which metric best indicates content kept a visitor engaged?', 'single_choice',
   '[{"id":"a","text":"Bounce rate going up"},{"id":"b","text":"Average engagement time going up"},{"id":"c","text":"Page weight going up"},{"id":"d","text":"Server uptime"}]', '["b"]',
   'Longer engagement time signals the content held attention.', 1, 3),
  (404, 4, 'Which channels are typically PAID acquisition?', 'multiple_choice',
   '[{"id":"a","text":"Google Ads"},{"id":"b","text":"Organic Instagram posts"},{"id":"c","text":"Meta Ads"},{"id":"d","text":"Referral word-of-mouth"}]', '["a","c"]',
   'Organic posts and word-of-mouth are unpaid channels.', 2, 4),
  (405, 4, 'A/B testing compares…', 'single_choice',
   '[{"id":"a","text":"Two variants against the same goal metric"},{"id":"b","text":"Two unrelated products"},{"id":"c","text":"Two analytics tools"},{"id":"d","text":"Two ad budgets"}]', '["a"]',
   'A/B tests isolate one change and measure impact on a metric.', 1, 5);

-- ----------------------------------------------------------------------------
-- LESSONS (id = internship*100 + seq)
-- Internship 1 (recorded): videos ready on Bunny; lesson 101 is a free preview.
-- Internship 2 (live): live-type lessons fulfilled by scheduled sessions below.
-- Internship 3 (hybrid): recorded videos + one live lab slot per section.
-- Internship 4 (project_only): reference documents only.
-- Each internship ends with a quiz lesson linked to its quiz.
-- ----------------------------------------------------------------------------

insert into lessons (id, section_id, title, type, display_order, duration_minutes, bunny_video_id, video_status, document_url, quiz_id, is_preview, is_mandatory) overriding system value values
  -- Internship 1 — Section 11
  (101, 11, 'Welcome and Project Overview',           'video', 1, 12, 'bunny-demo-w101', 'ready', null, null, true,  true),
  (102, 11, 'Express Routing and Middleware',         'video', 2, 28, 'bunny-demo-w102', 'ready', null, null, false, true),
  (103, 11, 'PostgreSQL and Data Modelling',          'video', 3, 31, 'bunny-demo-w103', 'ready', null, null, false, true),
  -- Internship 1 — Section 12
  (104, 12, 'React Components and Hooks',             'video', 1, 35, 'bunny-demo-w104', 'ready', null, null, false, true),
  (105, 12, 'Deploying the Full Stack',               'video', 2, 22, 'bunny-demo-w105', 'ready', null, null, false, true),
  (106, 12, 'Final Quiz: Full-Stack Fundamentals',    'quiz',  3, 15, null, null, null, 1, false, true),

  -- Internship 2 — Section 21 (live)
  (201, 21, 'Live: Dart Crash Course',                'live',  1, 90, null, null, null, null, false, true),
  (202, 21, 'Live: Widgets and Layout',               'live',  2, 90, null, null, null, null, false, true),
  (203, 21, 'Live: Navigation with go_router',        'live',  3, 90, null, null, null, null, false, true),
  -- Internship 2 — Section 22 (live)
  (204, 22, 'Live: State Management with Riverpod',   'live',  1, 90, null, null, null, null, false, true),
  (205, 22, 'Live: APIs with Dio and Release Build',  'live',  2, 90, null, null, null, null, false, true),
  (206, 22, 'Final Quiz: Flutter Essentials',         'quiz',  3, 15, null, null, null, 2, false, true),

  -- Internship 3 — Section 31 (hybrid: recorded + live lab)
  (301, 31, 'Python Refresher for Analysis',          'video', 1, 26, 'bunny-demo-d301', 'ready', null, null, true,  true),
  (302, 31, 'Pandas: Series, DataFrames, GroupBy',    'video', 2, 38, 'bunny-demo-d302', 'ready', null, null, false, true),
  (303, 31, 'Live Lab 1: Cleaning a UPI Dataset',     'live',  3, 60, null, null, null, null, false, true),
  -- Internship 3 — Section 32
  (304, 32, 'Visualisation with Matplotlib',          'video', 1, 29, 'bunny-demo-d304', 'ready', null, null, false, true),
  (305, 32, 'Live Lab 2: Your First ML Model',        'live',  2, 60, null, null, null, null, false, true),
  (306, 32, 'Final Quiz: Data Science Basics',        'quiz',  3, 20, null, null, null, 3, false, true),

  -- Internship 4 — Section 41 (documents)
  (401, 41, 'How This Internship Works (Brief Pack)', 'document', 1, 10, null, null, 'docs/dm/brief-pack.pdf', null, true,  true),
  (402, 41, 'SEO Audit Checklist and Examples',       'document', 2, 20, null, null, 'docs/dm/seo-checklist.pdf', null, false, true),
  -- Internship 4 — Section 42
  (403, 42, 'Analytics Report Template',              'document', 1, 15, null, null, 'docs/dm/analytics-template.pdf', null, false, true),
  (404, 42, 'Final Quiz: Marketing Concepts',         'quiz',     2, 10, null, null, null, 4, false, true);

-- ----------------------------------------------------------------------------
-- LIVE SESSIONS (first two scheduled sessions of the Flutter live cohort)
-- ----------------------------------------------------------------------------

insert into live_sessions (id, internship_id, batch_id, lesson_id, provider, title, meeting_id, join_url, scheduled_start, scheduled_end, status, created_by) overriding system value values
  (1, 2, 2, 201, 'zoom',        'Dart Crash Course',  '983-2026-0001', 'https://zoom.us/j/98320260001',      '2026-07-06 13:30:00+00', '2026-07-06 15:00:00+00', 'scheduled', 4),
  (2, 2, 2, 202, 'google_meet', 'Widgets and Layout', 'gum-flt-002',   'https://meet.google.com/gum-flt-002', '2026-07-09 13:30:00+00', '2026-07-09 15:00:00+00', 'scheduled', 4);

-- ----------------------------------------------------------------------------
-- PROJECTS (1 per internship) + 4 WEEKLY TASKS each (task id = internship*10 + week)
-- ----------------------------------------------------------------------------

insert into projects (id, internship_id, title, description, display_order) overriding system value values
  (1, 1, 'Build "CampusKart" — a Student Marketplace', 'Ship a full-stack marketplace step by step over four weeks.', 1),
  (2, 2, 'Build "RailTrack" — a Train PNR Companion App', 'A Flutter app with real API integration, built across the cohort.', 1),
  (3, 3, 'Analyse "MandiPrices" — Agricultural Market Data', 'A four-part analysis of real agri price data ending in an ML model.', 1),
  (4, 4, 'Marketing Portfolio for a Real D2C Brand', 'Four client-style briefs that produce portfolio-ready deliverables.', 1);

insert into project_tasks (id, project_id, week_number, title, instructions, allowed_submission_types, max_score, rubric, due_offset_days, is_mandatory, display_order) overriding system value values
  -- Project 1 (web) — GitHub-first
  (11, 1, 1, 'REST API: products and auth endpoints',
   'Build /products CRUD and JWT auth in Express. Push to a public repo with a README and curl examples.',
   '{github_url}', 100, '[{"criterion":"Functionality","weight":0.4,"max_points":40},{"criterion":"Code quality","weight":0.3,"max_points":30},{"criterion":"README & tests","weight":0.3,"max_points":30}]', 7, true, 1),
  (12, 1, 2, 'Database schema and listings search',
   'Add PostgreSQL with migrations, seed 50 products, implement search + pagination.',
   '{github_url}', 100, '[{"criterion":"Schema design","weight":0.4,"max_points":40},{"criterion":"Query correctness","weight":0.4,"max_points":40},{"criterion":"Migrations hygiene","weight":0.2,"max_points":20}]', 14, true, 2),
  (13, 1, 3, 'React frontend with cart flow',
   'Build listing, detail and cart pages consuming your API. Deploy a preview and share both URLs.',
   '{github_url,live_url}', 100, '[{"criterion":"UX completeness","weight":0.4,"max_points":40},{"criterion":"State handling","weight":0.3,"max_points":30},{"criterion":"API integration","weight":0.3,"max_points":30}]', 21, true, 3),
  (14, 1, 4, 'Production deployment and demo video',
   'Deploy frontend + API + DB. Submit the live URL and a short Loom-style walkthrough file or link.',
   '{live_url,file,github_url}', 100, '[{"criterion":"Working deployment","weight":0.5,"max_points":50},{"criterion":"Performance & errors","weight":0.25,"max_points":25},{"criterion":"Demo clarity","weight":0.25,"max_points":25}]', 28, true, 4),

  -- Project 2 (flutter)
  (21, 2, 1, 'App skeleton with go_router navigation',
   'Create the RailTrack project: splash, home, search and details screens wired with go_router.',
   '{github_url}', 100, '[{"criterion":"Navigation works","weight":0.4,"max_points":40},{"criterion":"Project structure","weight":0.3,"max_points":30},{"criterion":"UI polish","weight":0.3,"max_points":30}]', 7, true, 1),
  (22, 2, 2, 'Riverpod state for search history',
   'Model search history with StateNotifier, persist in memory, cover with two widget tests.',
   '{github_url}', 100, '[{"criterion":"State correctness","weight":0.4,"max_points":40},{"criterion":"Tests pass","weight":0.3,"max_points":30},{"criterion":"Code quality","weight":0.3,"max_points":30}]', 14, true, 2),
  (23, 2, 3, 'Dio integration with a public API',
   'Integrate a public transport/mock API with Dio interceptors, loading and error states.',
   '{github_url}', 100, '[{"criterion":"API layer design","weight":0.4,"max_points":40},{"criterion":"Error handling","weight":0.3,"max_points":30},{"criterion":"UX states","weight":0.3,"max_points":30}]', 21, true, 3),
  (24, 2, 4, 'Release build and store listing draft',
   'Produce a signed release APK and a store listing document (screenshots, description).',
   '{file,github_url}', 100, '[{"criterion":"Build installs & runs","weight":0.5,"max_points":50},{"criterion":"Listing quality","weight":0.25,"max_points":25},{"criterion":"App stability","weight":0.25,"max_points":25}]', 28, true, 4),

  -- Project 3 (data science) — file-first
  (31, 3, 1, 'Load and clean the MandiPrices dataset',
   'Handle missing values, fix dtypes, document every cleaning decision in a notebook.',
   '{file,github_url}', 100, '[{"criterion":"Cleaning rigour","weight":0.4,"max_points":40},{"criterion":"Reproducibility","weight":0.3,"max_points":30},{"criterion":"Documentation","weight":0.3,"max_points":30}]', 7, true, 1),
  (32, 3, 2, 'Exploratory analysis with five insights',
   'Produce five non-obvious insights with supporting tables; explain each in two sentences.',
   '{file,github_url}', 100, '[{"criterion":"Insight quality","weight":0.5,"max_points":50},{"criterion":"Analysis correctness","weight":0.3,"max_points":30},{"criterion":"Clarity","weight":0.2,"max_points":20}]', 14, true, 2),
  (33, 3, 3, 'Visualisation story (six charts)',
   'Build a six-chart narrative: trend, seasonality, region comparison, distribution, outliers, summary.',
   '{file,github_url}', 100, '[{"criterion":"Chart correctness","weight":0.4,"max_points":40},{"criterion":"Story flow","weight":0.3,"max_points":30},{"criterion":"Labelling & style","weight":0.3,"max_points":30}]', 21, true, 3),
  (34, 3, 4, 'Price prediction model with evaluation',
   'Train a regression model, report MAE/RMSE on a held-out split, discuss limitations honestly.',
   '{file,github_url}', 100, '[{"criterion":"Methodology","weight":0.4,"max_points":40},{"criterion":"Evaluation rigour","weight":0.4,"max_points":40},{"criterion":"Limitations discussion","weight":0.2,"max_points":20}]', 28, true, 4),

  -- Project 4 (marketing) — file/live-url
  (41, 4, 1, 'SEO audit of an assigned D2C site',
   'Use the checklist lesson to audit the assigned site: 10 findings, severity, and fixes.',
   '{file}', 100, '[{"criterion":"Finding accuracy","weight":0.4,"max_points":40},{"criterion":"Prioritisation","weight":0.3,"max_points":30},{"criterion":"Actionability","weight":0.3,"max_points":30}]', 7, true, 1),
  (42, 4, 2, '30-day Instagram content calendar',
   'Plan 30 days of posts with hooks, formats and CTAs aligned to the brand voice.',
   '{file,live_url}', 100, '[{"criterion":"Strategic fit","weight":0.4,"max_points":40},{"criterion":"Creativity","weight":0.3,"max_points":30},{"criterion":"Consistency","weight":0.3,"max_points":30}]', 14, true, 2),
  (43, 4, 3, 'Ad copy set for two campaigns',
   'Write 3 headline + body variants each for a search campaign and a social campaign.',
   '{file}', 100, '[{"criterion":"Persuasion craft","weight":0.4,"max_points":40},{"criterion":"Platform fit","weight":0.3,"max_points":30},{"criterion":"Brand voice","weight":0.3,"max_points":30}]', 21, true, 3),
  (44, 4, 4, 'Analytics report from the sample export',
   'Using the template lesson and sample GA4 export, produce a one-page performance report with three recommendations.',
   '{file}', 100, '[{"criterion":"Metric literacy","weight":0.4,"max_points":40},{"criterion":"Recommendation quality","weight":0.4,"max_points":40},{"criterion":"Presentation","weight":0.2,"max_points":20}]', 28, true, 4);

-- ----------------------------------------------------------------------------
-- COUPONS (3)
-- ----------------------------------------------------------------------------

insert into coupons (id, code, description, discount_type, discount_value, max_discount_amount, internship_id, valid_from, valid_until, max_redemptions, per_user_limit, min_order_amount, is_active, created_by) overriding system value values
  (1, 'WELCOME10',   '10% off any paid internship (capped ₹500) for new learners.',  'percent', 10.00, 500.00,  null, '2026-06-01 00:00:00+00', '2026-12-31 23:59:59+00', 1000, 1, 0,       true, 1),
  (2, 'FLUTTER500',  'Flat ₹500 off the Flutter live cohort.',                       'flat',    500.00, null,    2,    '2026-06-01 00:00:00+00', '2026-07-03 23:59:59+00',  200, 1, 1000.00, true, 1),
  (3, 'EARLYBIRD25', '25% off Data Science (capped ₹1500) for the first 100 seats.', 'percent', 25.00, 1500.00, 3,    '2026-06-01 00:00:00+00', '2026-07-31 23:59:59+00',  100, 1, 0,       true, 1);

-- ----------------------------------------------------------------------------
-- RESYNC identity sequences after explicit-id inserts
-- ----------------------------------------------------------------------------

select setval(pg_get_serial_sequence('users', 'id'),               (select max(id) from users));
select setval(pg_get_serial_sequence('instructor_profiles', 'id'), (select max(id) from instructor_profiles));
select setval(pg_get_serial_sequence('categories', 'id'),          (select max(id) from categories));
select setval(pg_get_serial_sequence('internships', 'id'),         (select max(id) from internships));
select setval(pg_get_serial_sequence('internship_batches', 'id'),  (select max(id) from internship_batches));
select setval(pg_get_serial_sequence('curriculum_sections', 'id'), (select max(id) from curriculum_sections));
select setval(pg_get_serial_sequence('quizzes', 'id'),             (select max(id) from quizzes));
select setval(pg_get_serial_sequence('quiz_questions', 'id'),      (select max(id) from quiz_questions));
select setval(pg_get_serial_sequence('lessons', 'id'),             (select max(id) from lessons));
select setval(pg_get_serial_sequence('live_sessions', 'id'),       (select max(id) from live_sessions));
select setval(pg_get_serial_sequence('projects', 'id'),            (select max(id) from projects));
select setval(pg_get_serial_sequence('project_tasks', 'id'),       (select max(id) from project_tasks));
select setval(pg_get_serial_sequence('coupons', 'id'),             (select max(id) from coupons));

commit;

-- ============================================================================
-- QUICK REFERENCE FOR TESTING (deterministic handles)
--   super_admin login: admin@gum-demo.in / Password@123  (user id 1)
--   external instructor: priya@gum-demo.in / Password@123 (user 4, profile 3)
--   student: student@gum-demo.in / Password@123           (user id 5)
--   free+recorded internship:  id 1 (slug full-stack-web-development-internship)
--   paid+live internship:      id 2 (₹4,999, batch 2, waitlist on, coupon FLUTTER500)
--   paid+hybrid internship:    id 3 (₹7,999, batch 3, coupon EARLYBIRD25)
--   free+project_only:         id 4 (batch 4)
-- ============================================================================
