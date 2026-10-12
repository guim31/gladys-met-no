# Test fixtures

## Real MET Norway responses

Each `real-*.json` file is the untouched body of
`GET https://api.met.no/weatherapi/locationforecast/2.0/complete`, recorded on
12 October 2026 with the integration's User-Agent
(`gladys-met-no/1.0.0 github.com/guim31/gladys-met-no`). Public places only:
no private location. Their first instant is 15:00 UTC; the tests read them
"now" at 15:25 UTC (`FIXTURE_NOW`).

| File                          | Request                                | Why                                                                           | Last-Modified / Expires (UTC) |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `real-toulouse.json`          | `lat=43.6045&lon=1.444`                | France, dry: no gust, no probability outside the Nordic models                | recorded at 15:20             |
| `real-oslo.json`              | `lat=59.9139&lon=10.7522`              | Nordic models: gusts, precipitation and thunder probabilities, rain tomorrow  | 15:05:01 / 15:35:51           |
| `real-new-york.json`          | `lat=40.7128&lon=-74.006`              | Another time zone, fog                                                        | 15:12:53 / 15:44:13           |
| `real-sydney.json`            | `lat=-33.8688&lon=151.2093`            | Southern hemisphere, night, heavy rain under way                              | 15:12:55 / 15:43:51           |
| `real-north-atlantic.json`    | `lat=45&lon=-30`                       | At sea (altitude 0)                                                           | 15:23:40 / 15:54:56           |
| `real-pic-du-midi-2877m.json` | `lat=42.9364&lon=0.1422&altitude=2877` | Summit with an explicit altitude: snow and sleet                              | 15:23:41 / 15:54:59           |
| `real-longyearbyen.json`      | `lat=78.2232&lon=15.6267`              | Arctic (Svalbard): days shortening before the polar night, gusts, sleet, snow | 15:07:33 / 15:38:17           |

The headers (`Expires`, `Last-Modified`) are not part of the files: the tests
build them (`metNoRoute()` in `test/helpers/fixtures.js`). The `Expires` header
came 12 to 31 minutes after the request. A conditional request
(`If-Modified-Since` with the `Last-Modified` received) was answered `304 Not
Modified` with no body, and a latitude out of range `400 Bad Request` with a
plain-text body (`Invalid parameter 'lat': Illegal latitude value`).

Showers are staged on these real responses by `withNextHours()`, which
rewrites the `next_1_hours` of chosen instants.

## Other files

- `weathericons-legend.csv`: `weather/legend.csv` of
  [metno/weathericons](https://github.com/metno/weathericons) (MIT, © Yr), the
  official list of the 41 symbols, as published (with its trailing space and
  its two misspelled ids).
- `gladys-feature-table.json`: the category/type pairs the Gladys front end can
  display, shared by the maintainer's integrations. This one publishes no
  device (a weather provider), so no test reads it.
