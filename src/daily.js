// -----------------------------------------------------------------------------
// The days of the forecast, built from the instants.
//
// Locationforecast has no daily block: the days are cut at the local
// midnights of Gladys (time.js) and summed up here, the way Home Assistant's
// `met` integration and Yr do.
//
//   temperature   the lowest and highest of the instants of the day and of
//                 the `next_6_hours` minimum/maximum of the periods centred
//                 in it — after the hourly part the instants are 6 hours
//                 apart, and only the period extremes catch the afternoon
//                 maximum;
//   precipitation the sum of a timeline without overlap: `next_1_hours` while
//                 the instants are hourly, `next_6_hours` after, each period
//                 counted in the day holding its middle;
//   probability   the highest probability of those periods (Nordic only);
//   condition     the symbol of the 6-hour period centred nearest local noon
//                 (the daytime weather), else of the hour nearest noon;
//   wind          the strongest wind of the instants, its direction, and the
//                 strongest gust (Nordic only);
//   UV index      the highest clear-sky UV index (see pivot.js);
//   sun           sunrise and sunset, computed (sun.js).
//
// Today only holds what is still to come: MET Norway forecasts from the
// current hour, so today's minimum is the minimum of the rest of the day.
// -----------------------------------------------------------------------------

import { toCondition } from './symbols.js';
import { sunTimes } from './sun.js';
import { HOUR_MS, nextDayStart, startOfDay } from './time.js';

/**
 * @description The precipitation timeline: one period per stretch of time,
 * hourly while the forecast is hourly, 6-hourly after, without overlap.
 * @param {Array<object>} points - The slim points, sorted.
 * @returns {Array<object>} `[{ start, end, symbol, precipitation,
 * probability }]` (ms; precipitation and probability may be null).
 * @example
 * precipitationTimeline(forecast.points);
 */
function precipitationTimeline(points) {
  const periods = [];
  let coveredUntil = -Infinity;
  points.forEach((point, index) => {
    if (point.time < coveredUntil) {
      return;
    }
    const next = points[index + 1];
    // An hour is only usable when the next instant is an hour later: the
    // last hourly instant before the 6-hourly part would otherwise leave
    // five hours uncounted.
    const hourly =
      point.next1 !== null && (next === undefined || next.time - point.time === HOUR_MS);
    const period = hourly ? point.next1 : point.next6;
    if (period === null) {
      return;
    }
    const length = hourly ? HOUR_MS : 6 * HOUR_MS;
    periods.push({
      start: point.time,
      end: point.time + length,
      symbol: period.symbol,
      precipitation: period.precipitation,
      probability: period.probability,
    });
    coveredUntil = point.time + length;
  });
  return periods;
}

/**
 * @description Pick the highest of two values, either of which may be null.
 * @param {number|null} a - A value.
 * @param {number|null} b - Another value.
 * @returns {number|null} The highest.
 * @example
 * maxOf(null, 3); // -> 3
 */
function maxOf(a, b) {
  if (a === null) {
    return b;
  }
  return b === null ? a : Math.max(a, b);
}

/**
 * @description Pick the lowest of two values, either of which may be null.
 * @param {number|null} a - A value.
 * @param {number|null} b - Another value.
 * @returns {number|null} The lowest.
 * @example
 * minOf(null, 3); // -> 3
 */
function minOf(a, b) {
  if (a === null) {
    return b;
  }
  return b === null ? a : Math.min(a, b);
}

/**
 * @description Build the days of a forecast.
 * @param {object} forecast - The slim forecast (forecast.js).
 * @param {object} options - Options.
 * @param {number} options.latitude - The latitude of the house.
 * @param {number} options.longitude - Its longitude.
 * @param {string} options.timeZone - The time zone cutting the days.
 * @returns {Array<object>} `[{ start, end, temperatureMin, temperatureMax,
 * symbol, condition, precipitation, probability, windSpeed, windDirection,
 * windGust, uvIndex, humidity, sunrise, sunset }]` (times in ms): the
 * first day of the forecast, then every day it covers to the end, in order.
 * @example
 * buildDays(forecast, { latitude: 43.6, longitude: 1.44, timeZone: 'Europe/Paris' });
 */
function buildDays(forecast, { latitude, longitude, timeZone }) {
  const days = new Map();
  const dayOf = (ms) => {
    const start = startOfDay(ms, timeZone);
    let day = days.get(start);
    if (day === undefined) {
      day = {
        start,
        end: nextDayStart(start, timeZone),
        instants: 0,
        temperatureMin: null,
        temperatureMax: null,
        precipitation: null,
        probability: null,
        windSpeed: null,
        windDirection: null,
        windGust: null,
        uvIndex: null,
        humiditySum: 0,
        humidityCount: 0,
        symbols: [],
      };
      days.set(start, day);
    }
    return day;
  };

  for (const point of forecast.points) {
    const day = dayOf(point.time);
    day.instants += 1;
    day.temperatureMin = minOf(day.temperatureMin, point.temperature);
    day.temperatureMax = maxOf(day.temperatureMax, point.temperature);
    if (point.windSpeed !== null && (day.windSpeed === null || point.windSpeed > day.windSpeed)) {
      day.windSpeed = point.windSpeed;
      day.windDirection = point.windDirection;
    }
    day.windGust = maxOf(day.windGust, point.windGust);
    day.uvIndex = maxOf(day.uvIndex, point.uvIndex);
    if (point.humidity !== null) {
      day.humiditySum += point.humidity;
      day.humidityCount += 1;
    }
    if (point.next6 !== null) {
      const middle = point.time + 3 * HOUR_MS;
      const periodDay = dayOf(middle);
      periodDay.temperatureMin = minOf(periodDay.temperatureMin, point.next6.temperatureMin);
      periodDay.temperatureMax = maxOf(periodDay.temperatureMax, point.next6.temperatureMax);
      if (point.next6.symbol !== null) {
        periodDay.symbols.push({ middle, symbol: point.next6.symbol, weight: 0 });
      }
    }
    if (point.next1?.symbol) {
      day.symbols.push({ middle: point.time + HOUR_MS / 2, symbol: point.next1.symbol, weight: 1 });
    }
  }

  for (const period of precipitationTimeline(forecast.points)) {
    const day = dayOf((period.start + period.end) / 2);
    if (period.precipitation !== null) {
      day.precipitation = (day.precipitation ?? 0) + period.precipitation;
    }
    day.probability = maxOf(day.probability, period.probability);
  }

  // The forecast stops a little after midnight UTC: a last day it barely
  // enters would show the extremes of a few night hours as the day's.
  const coveredUntil = (forecast.points.at(-1)?.time ?? 0) + 6 * HOUR_MS;
  return [...days.values()]
    .filter((day) => day.instants > 0 && day.temperatureMin !== null)
    .sort((a, b) => a.start - b.start)
    .filter((day, index) => index === 0 || coveredUntil >= day.end)
    .map((day) => {
      // Local noon: 12 hours after midnight, but within the day of 23 or
      // 25 hours of a daylight saving switch.
      const noon = Math.min(day.start + 12 * HOUR_MS, day.end - HOUR_MS);
      // A 6-hour period describes the daytime better than one hour: prefer
      // it (weight 0), then the nearest to noon.
      const [best] = [...day.symbols].sort(
        (a, b) => a.weight - b.weight || Math.abs(a.middle - noon) - Math.abs(b.middle - noon),
      );
      const symbol = best?.symbol ?? null;
      const { sunrise, sunset } = sunTimes(day.start, day.end, latitude, longitude);
      return {
        start: day.start,
        end: day.end,
        temperatureMin: day.temperatureMin,
        temperatureMax: day.temperatureMax,
        symbol,
        condition: toCondition(symbol, { temperature: day.temperatureMax }),
        precipitation: day.precipitation,
        probability: day.probability,
        windSpeed: day.windSpeed,
        windDirection: day.windDirection,
        windGust: day.windGust,
        uvIndex: day.uvIndex,
        humidity: day.humidityCount > 0 ? day.humiditySum / day.humidityCount : null,
        sunrise,
        sunset,
      };
    });
}

export { buildDays, precipitationTimeline };
