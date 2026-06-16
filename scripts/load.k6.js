// Load test for the hot public read paths (catalog list + detail).
//   BASE_URL=https://api.example.in k6 run scripts/load.k6.js
// Install k6: https://k6.io/docs/get-started/installation/
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8001';

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // ramp up
    { duration: '1m', target: 50 },   // sustain
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],      // < 1% errors
    http_req_duration: ['p(95)<800'],    // p95 under 800ms
  },
};

export default function () {
  const list = http.get(`${BASE}/v1/catalog/internships?limit=12`, { tags: { name: 'catalog-list' } });
  check(list, { 'list 200': (r) => r.status === 200 });

  try {
    const items = list.json('data');
    if (Array.isArray(items) && items.length > 0) {
      const slug = items[Math.floor(Math.random() * items.length)].slug;
      const detail = http.get(`${BASE}/v1/catalog/internships/${slug}`, { tags: { name: 'catalog-detail' } });
      check(detail, { 'detail 200/404': (r) => r.status === 200 || r.status === 404 });
    }
  } catch (_e) {
    // ignore parse issues under load
  }
  sleep(1);
}
