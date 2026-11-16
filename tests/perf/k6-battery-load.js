import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '20s', target: 15 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
};

const BASE = __ENV.TRUSTGUARD_WEB_URL || 'http://127.0.0.1:3100';
const SAMPLE_CODE = __ENV.SAMPLE_CODE || 'DMAPB010000001E114616111';

export default function () {
  const dash = http.get(`${BASE}/api/bff/dashboard`);
  check(dash, { 'dashboard 200': r => r.status === 200 });

  const bat = http.get(`${BASE}/api/bff/battery?code=${SAMPLE_CODE}`);
  check(bat, { 'battery 200': r => r.status === 200 });

  const risk = http.get(`${BASE}/api/bff/risk`);
  check(risk, { 'risk 200': r => r.status === 200 });

  sleep(0.2);
}
