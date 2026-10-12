// -----------------------------------------------------------------------------
// The real responses, parsed and converted to the pivot weather format of the
// core: what normalizeWeather keeps, in the requested units, for every kind of
// location (Nordic with probabilities and gusts, elsewhere without, at sea,
// on a summit, in the Arctic, south of the equator).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import { buildDays, precipitationTimeline } from '../src/daily.js';
import { parseForecast } from '../src/forecast.js';
import { MAX_DAYS, MAX_HOURS, buildWeather } from '../src/pivot.js';
import { HOUR_MS, startOfDay } from '../src/time.js';
import { FIXTURE_NOW, HOUSES, forecastOf, loadFixture } from './helpers/fixtures.js';

// The fields of normalizeWeather (server/lib/external-integration/
// externalIntegration.normalizeWeather.js in Gladys 5.2.0): anything else
// is dropped by the core.
const CURRENT_FIELDS = [
  'temperature',
  'weather',
  'datetime',
  'apparent_temperature',
  'humidity',
  'pressure',
  'dew_point',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'visibility',
  'cloud_cover',
  'uv_index',
  'sunrise',
  'sunset',
  'is_day',
  'hours',
  'days',
  'alerts',
  'images',
];
const HOUR_FIELDS = [
  'temperature',
  'weather',
  'datetime',
  'apparent_temperature',
  'humidity',
  'pressure',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'cloud_cover',
  'precipitation',
  'precipitation_probability',
  'uv_index',
  'is_day',
];
const DAY_FIELDS = [
  'temperature_min',
  'temperature_max',
  'datetime',
  'weather',
  'humidity',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'precipitation',
  'precipitation_probability',
  'uv_index',
  'sunrise',
  'sunset',
];
const CONDITIONS = Object.values(WEATHER_CONDITIONS);

/**
 * @param {object} house - A HOUSES entry.
 * @param {object} [options] - { units, now }.
 * @returns {object} The pivot weather.
 */
function weatherOf(house, { units = 'metric', now = FIXTURE_NOW } = {}) {
  return buildWeather(forecastOf(house.fixture), {
    latitude: house.latitude,
    longitude: house.longitude,
    units,
    timeZone: house.timeZone,
    now,
  });
}

test('every real response gives a payload the core keeps whole', () => {
  for (const house of Object.values(HOUSES)) {
    const weather = weatherOf(house);
    const where = house.fixture;
    assert.deepEqual(
      Object.keys(weather).filter((key) => !CURRENT_FIELDS.includes(key)),
      [],
      where,
    );
    assert.equal(typeof weather.temperature, 'number', where);
    assert.ok(CONDITIONS.includes(weather.weather), where);
    assert.notEqual(weather.weather, 'unknown', where);
    assert.ok(!Number.isNaN(Date.parse(weather.datetime)), where);
    assert.equal(typeof weather.is_day, 'boolean', where);
    assert.equal(weather.visibility, undefined, 'MET gives no visibility');
    assert.equal(weather.alerts, undefined, 'MetAlerts is Norway only');

    assert.equal(weather.hours.length, MAX_HOURS, where);
    for (const hour of weather.hours) {
      assert.deepEqual(
        Object.keys(hour).filter((key) => !HOUR_FIELDS.includes(key)),
        [],
      );
      assert.ok(CONDITIONS.includes(hour.weather) && hour.weather !== 'unknown', where);
      assert.equal(typeof hour.precipitation, 'number', where);
      assert.equal(typeof hour.is_day, 'boolean', where);
    }
    const times = weather.hours.map((hour) => Date.parse(hour.datetime));
    assert.ok(
      times.every((time, index) => index === 0 || time - times[index - 1] === HOUR_MS),
      `${where}: consecutive hours`,
    );

    assert.ok(weather.days.length >= 7 && weather.days.length <= MAX_DAYS, where);
    for (const day of weather.days) {
      assert.deepEqual(
        Object.keys(day).filter((key) => !DAY_FIELDS.includes(key)),
        [],
      );
      assert.ok(day.temperature_min <= day.temperature_max, where);
      assert.ok(CONDITIONS.includes(day.weather), where);
    }
    for (const value of [weather.humidity, weather.cloud_cover]) {
      assert.ok(value >= 0 && value <= 100, where);
    }
  }
});

test('Toulouse at 17:25: the current hour, its sun, its days', () => {
  const weather = weatherOf(HOUSES.toulouse);
  assert.equal(weather.datetime, '2026-10-12T15:00:00.000Z');
  assert.equal(weather.temperature, 20.9);
  assert.equal(weather.apparent_temperature, 20.9);
  assert.equal(weather.weather, 'partly-cloudy', 'fair_day');
  assert.equal(weather.humidity, 69);
  assert.equal(weather.pressure, 1020);
  assert.equal(weather.wind_speed, 1.5);
  assert.equal(weather.wind_direction, 294);
  assert.equal(weather.wind_gust, undefined, 'no gust outside the Nordic countries');
  assert.equal(weather.is_day, true);
  assert.equal(weather.sunrise, '2026-10-12T06:04:34.000Z');
  assert.equal(weather.sunset, '2026-10-12T17:16:09.000Z');
  assert.equal(weather.hours[0].datetime, '2026-10-12T15:00:00.000Z');
  assert.equal(weather.hours[0].precipitation_probability, undefined);
  assert.equal(weather.days[0].datetime, '2026-10-11T22:00:00.000Z', 'local midnight');
});

test('Oslo, inside the Nordic models: probabilities and gusts', () => {
  const weather = weatherOf(HOUSES.oslo);
  assert.equal(weather.wind_gust, 4.3);
  assert.ok(weather.hours.every((hour) => typeof hour.precipitation_probability === 'number'));
  assert.ok(weather.days.some((day) => typeof day.precipitation_probability === 'number'));
  const tomorrow = weather.days[1];
  assert.equal(tomorrow.datetime, '2026-10-12T22:00:00.000Z');
  assert.equal(tomorrow.precipitation_probability, 100);
});

test('the units of the request: °F, mph and inches for "us", hPa in both', () => {
  const metric = weatherOf(HOUSES.newYork);
  const us = weatherOf(HOUSES.newYork, { units: 'us' });
  assert.equal(us.temperature, Math.round(((metric.temperature * 9) / 5 + 32) * 10) / 10);
  assert.equal(us.wind_speed, Math.round((metric.wind_speed / 0.44704) * 10) / 10);
  assert.equal(us.pressure, metric.pressure);
  const wet = metric.days.findIndex((day) => day.precipitation > 0);
  assert.ok(wet >= 0);
  assert.equal(
    us.days[wet].precipitation,
    Math.round((metric.days[wet].precipitation / 25.4) * 100) / 100,
  );
});

test('a forecast served from the cache an hour later moves on', () => {
  const later = FIXTURE_NOW + HOUR_MS;
  const weather = weatherOf(HOUSES.toulouse, { now: later });
  assert.equal(weather.datetime, '2026-10-12T16:00:00.000Z');
  assert.equal(weather.hours[0].datetime, '2026-10-12T16:00:00.000Z');
  assert.equal(weather.is_day, true, '18:25, before the 19:16 sunset');
  const evening = weatherOf(HOUSES.toulouse, { now: Date.UTC(2026, 9, 12, 17, 50) });
  assert.equal(evening.is_day, false, '19:50, after the sunset');
});

test('night in Sydney, a summit, the open sea and the Arctic', () => {
  const sydney = weatherOf(HOUSES.sydney);
  assert.equal(sydney.is_day, false, '2:25 in the morning');
  assert.equal(sydney.days[0].datetime, '2026-10-12T13:00:00.000Z');

  const summit = forecastOf(HOUSES.picDuMidi.fixture);
  assert.equal(summit.altitude, 2877);
  assert.ok(
    weatherOf(HOUSES.picDuMidi).days.some((day) => ['snow', 'sleet'].includes(day.weather)),
  );

  const sea = weatherOf(HOUSES.atlantic);
  assert.equal(forecastOf(HOUSES.atlantic.fixture).altitude, 0);
  assert.ok(sea.days.length >= 7);

  const arctic = weatherOf(HOUSES.longyearbyen);
  assert.ok(arctic.sunrise && arctic.sunset, 'still a sunrise in mid-October');
});

test('the precipitation timeline never counts an hour twice', () => {
  for (const house of Object.values(HOUSES)) {
    const periods = precipitationTimeline(forecastOf(house.fixture).points);
    periods.forEach((period, index) => {
      if (index > 0) {
        assert.equal(period.start, periods[index - 1].end, `${house.fixture} at ${period.start}`);
      }
    });
    assert.equal(periods[0].end - periods[0].start, HOUR_MS);
    assert.equal(periods.at(-1).end - periods.at(-1).start, 6 * HOUR_MS);
  }
});

test('a day sums its hours and its 6-hour periods', () => {
  const raw = loadFixture('real-oslo.json');
  const forecast = parseForecast(raw);
  const days = buildDays(forecast, { ...HOUSES.oslo });
  const tomorrow = days[1];
  const expected = precipitationTimeline(forecast.points)
    .filter((period) => {
      const middle = (period.start + period.end) / 2;
      return middle >= tomorrow.start && middle < tomorrow.end;
    })
    .reduce((sum, period) => sum + period.precipitation, 0);
  assert.ok(Math.abs(tomorrow.precipitation - expected) < 1e-9);
  assert.ok(tomorrow.precipitation > 0);
  // The 6-hour maximum catches what the 6-hourly instants miss.
  const late = days.at(-1);
  const instants = forecast.points.filter((p) => p.time >= late.start && p.time < late.end);
  assert.ok(late.temperatureMax >= Math.max(...instants.map((p) => p.temperature)));
});

test('a last day the forecast barely enters is left out', () => {
  const forecast = forecastOf('real-toulouse.json');
  const days = buildDays(forecast, { ...HOUSES.toulouse });
  const last = forecast.points.at(-1).time;
  assert.ok(days.at(-1).end <= last + 6 * HOUR_MS);
  assert.ok(
    !days.some(
      (day) => day.start === startOfDay(last, 'Europe/Paris') && day.end > last + 6 * HOUR_MS,
    ),
  );
});

test('a body without instants, or in another unit, is refused', () => {
  assert.throws(() => parseForecast(null), /not an object/);
  assert.throws(() => parseForecast({ properties: {} }), /no time series/);
  assert.throws(
    () => parseForecast({ properties: { timeseries: [{ time: 'x', data: {} }] } }),
    /no forecast/,
  );
  const raw = loadFixture('real-oslo.json');
  raw.properties.meta.units.air_temperature = 'fahrenheit';
  assert.throws(() => parseForecast(raw), /Unexpected temperature unit/);
});
