-- 0022 — Point the seeded demo document lessons at real, publicly-hosted sample
-- PDFs so they actually open (the original docs/dm/*.pdf paths were never
-- uploaded to Bunny Storage, so signing them returned a 404). The classroom
-- now passes absolute http(s) URLs straight through (only Bunny paths are
-- signed). Replace these with your own uploaded files for production.
set search_path = intern, public;

update lessons set document_url = 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf'
  where type = 'document' and document_url = 'docs/dm/brief-pack.pdf';

update lessons set document_url = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
  where type = 'document' and document_url = 'docs/dm/seo-checklist.pdf';

update lessons set document_url = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
  where type = 'document' and document_url = 'docs/dm/analytics-template.pdf';
