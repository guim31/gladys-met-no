// -----------------------------------------------------------------------------
// The MET Norway client: what the terms of service ask of every request
// (identifying User-Agent, 4 decimals, conditional requests) and how each
// answer is classified.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ERROR_KINDS,
  USER_AGENT,
  buildUrl,
  fetchForecast,
  formatCoordinate,
  readReason,
  readRetryAfter,
} from '../src/api.js';
import { FIXTURE_NOW, fakeFetch, loadFixture } from './helpers/fixtures.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('the User-Agent names the application, its version and a contact', () => {
  assert.equal(USER_AGENT, `gladys-met-no/${pkg.version} github.com/guim31/gladys-met-no`);
});

test('coordinates keep 4 decimals at most, and the altitude is optional', () => {
  assert.equal(formatCoordinate(43.604512), '43.6045');
  assert.equal(formatCoordinate(-74.00597), '-74.006');
  assert.equal(formatCoordinate(45), '45');
  assert.equal(
    buildUrl(43.604512, 1.444, null),
    'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=43.6045&lon=1.444',
  );
  assert.equal(
    buildUrl(42.93641, 0.14219, 2877),
    'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=42.9364&lon=0.1422&altitude=2877',
  );
});

test('a first request is identified, and reads Expires and Last-Modified', async () => {
  const fetchImpl = fakeFetch(() => ({
    body: loadFixture('real-oslo.json'),
    headers: {
      expires: 'Mon, 12 Oct 2026 15:35:51 GMT',
      'last-modified': 'Mon, 12 Oct 2026 15:05:01 GMT',
    },
  }));
  const answer = await fetchForecast({ latitude: 59.9139, longitude: 10.7522, fetchImpl });
  assert.equal(answer.status, 200);
  assert.equal(answer.expiresAt, Date.UTC(2026, 9, 12, 15, 35, 51));
  assert.equal(answer.lastModified, 'Mon, 12 Oct 2026 15:05:01 GMT');
  assert.equal(answer.body.type, 'Feature');
  const [{ headers }] = fetchImpl.calls;
  assert.equal(headers['user-agent'], USER_AGENT);
  assert.equal(headers['if-modified-since'], undefined);
});

test('a later request is conditional, and a 304 carries no body', async () => {
  const fetchImpl = fakeFetch(() => ({
    status: 304,
    headers: { expires: 'Mon, 12 Oct 2026 16:05:51 GMT' },
  }));
  const answer = await fetchForecast({
    latitude: 59.9139,
    longitude: 10.7522,
    lastModified: 'Mon, 12 Oct 2026 15:05:01 GMT',
    fetchImpl,
  });
  assert.deepEqual(answer, {
    status: 304,
    body: null,
    expiresAt: Date.UTC(2026, 9, 12, 16, 5, 51),
    lastModified: 'Mon, 12 Oct 2026 15:05:01 GMT',
  });
  assert.equal(fetchImpl.calls[0].headers['if-modified-since'], 'Mon, 12 Oct 2026 15:05:01 GMT');
});

test('each failure is classified', async () => {
  const cases = [
    [{ status: 429, body: 'Too Many Requests', headers: { 'retry-after': '120' } }, 'throttled'],
    [{ status: 403, body: '403 Forbidden\nMissing User-Agent' }, 'forbidden'],
    [{ status: 400, body: "400 Bad Request\nInvalid parameter 'lat'" }, 'request'],
    [{ status: 500, body: '<html>oops</html>' }, 'upstream'],
    [{ status: 200, body: '{"truncated' }, 'invalid'],
  ];
  for (const [answer, kind] of cases) {
    const fetchImpl = fakeFetch(() => answer);
    await assert.rejects(
      fetchForecast({ latitude: 1, longitude: 2, fetchImpl, now: () => FIXTURE_NOW }),
      (err) => {
        assert.equal(err.kind, kind, `HTTP ${answer.status}`);
        if (answer.status === 429) {
          assert.equal(err.retryAfterMs, 120000);
        }
        if (answer.status === 400) {
          assert.match(err.message, /Invalid parameter 'lat'/);
        }
        return true;
      },
    );
  }
  const unreachable = fakeFetch(() => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  });
  await assert.rejects(fetchForecast({ latitude: 1, longitude: 2, fetchImpl: unreachable }), {
    kind: ERROR_KINDS.NETWORK,
    message: 'MET Norway unreachable (ENOTFOUND)',
  });
  await assert.rejects(fetchForecast({ latitude: Number.NaN, longitude: 2 }), {
    kind: ERROR_KINDS.REQUEST,
  });
});

test('a deprecated product (203) still delivers its forecast', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 203, body: loadFixture('real-sydney.json') }));
  const answer = await fetchForecast({ latitude: -33.8688, longitude: 151.2093, fetchImpl });
  assert.equal(answer.status, 203);
  assert.equal(answer.expiresAt, null);
});

test('Retry-After and error bodies are read safely', () => {
  assert.equal(readRetryAfter('60', 0), 60000);
  assert.equal(readRetryAfter('Mon, 12 Oct 2026 15:30:00 GMT', FIXTURE_NOW), 5 * 60000);
  assert.equal(readRetryAfter(null, 0), null);
  assert.equal(readRetryAfter('soon', 0), null);
  assert.equal(readReason('<html><body>Bad gateway</body></html>'), null);
  assert.equal(readReason('x'.repeat(500)).length, 200);
});
