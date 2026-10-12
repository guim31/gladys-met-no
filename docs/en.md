# MET Norway

The weather in Gladys from [MET Norway](https://www.met.no/en), the Norwegian
Meteorological Institute: its forecasts cover the whole world, are free and
need **no account and no API key**. It is also the weather Home Assistant
installs by default.

Weather data from [MET Norway](https://api.met.no/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This integration is
a community project, not affiliated with MET Norway.

## What you get

- **The Gladys weather widget and the chat assistant** use MET Norway: the
  current weather (temperature, feels-like, humidity, pressure, dew point,
  wind, cloud cover, UV index, sunrise and sunset), the next 24 hours with the
  rain of each hour, and the next 8 days. Day and night have their own icons.
  Everything is shown in **°C, m/s and mm** or in **°F, mph and inches**,
  following the unit system of each Gladys user.
- **In the Nordic countries** (Norway, Sweden, Finland, Denmark, the Baltic
  states), MET Norway also gives the **wind gusts** and the **chance of
  rain**: they show in the widget and in the scenes.
- **Scene trigger "Rain or snow expected within the hour"**.
- **Scene action "Get the precipitation of the next hour"**.
- **Scene action "Get the forecast of the day"** (today or tomorrow), with a
  sentence ready to put in a message.

No extra widget: the Gladys weather widget already shows everything MET
Norway publishes.

**No weather alerts.** MET Norway only publishes its alerts (MetAlerts) for
Norway: the built-in "Weather alert" trigger of Gladys stays silent with this
integration. For alerts, also install the **Météo France** integration
(vigilance, France) or **Pirate Weather** (United States, Canada, Europe).

## Installation

1. In Gladys, check that your house has a location: **Settings → Houses**,
   then enter the address or the position on the map. The integration
   refreshes the weather of every house that has one.
2. Install **MET Norway** from the integration catalog (or **Integrations →
   Install from GitHub**, with the address
   `https://github.com/guim31/gladys-met-no`). Gladys asks you to allow access
   to the location of your houses: it is used to watch the rain of the next
   hour for the scene trigger.
3. Open the **Configuration** tab and click **Test MET Norway**. The answer
   shows the current temperature of your first house.

That's it: the weather widget of your dashboard now shows MET Norway. If
another weather integration is installed, pick the provider in the settings
of the weather widget.

Gladys 5.2 or later is required.

## Configuration

Nothing is mandatory.

- **Altitude (m)** — leave it empty: MET Norway then uses its terrain model,
  right almost everywhere. Enter the altitude only in the mountains, if the
  forecast temperature is clearly too warm or too cold for your house (a deep
  valley, a chalet well above the village). The altitude applies to all your
  houses.
- **Units of the scene values** — the units of the temperatures, wind and
  precipitation the integration puts in scene variables. **Automatic** follows
  the unit system of the last user who looked at the weather; choose
  **Metric** or **US** to pin it. The weather widget always follows the
  preference of each user.
- **Language of the scene texts** — the language of the sentences the
  integration writes in scene variables ("Moderate rain expected in 35
  minutes."): English, French, German or Spanish. French by default;
  **Automatic** follows the language of your Gladys.

## Refresh rate and MET Norway's terms

MET Norway offers its API on the condition that every application spares it.
The integration follows its
[terms of service](https://api.met.no/doc/TermsOfService):

- **one refresh about every 30 minutes**, never before the expiry time MET
  Norway gives with each forecast, plus a few random minutes so that Gladys
  installations do not all call at the same second;
- **one call per house** (houses at the same place share it), which feeds
  everything: the dashboard, the chat and the scenes. Opening the dashboard
  costs nothing: Gladys is served from the forecast in memory;
- **a conditional request**: when the forecast has not changed, MET Norway
  answers "nothing new" without sending it again;
- coordinates rounded to 4 decimals (about 10 m) and an identification of the
  application (`gladys-met-no/<version> github.com/guim31/gladys-met-no`), as
  MET Norway requires;
- if MET Norway asks to slow down (error 429), the integration pauses for 10
  minutes, then longer and longer if it happens again; if it refuses the
  requests (error 403), it waits 6 hours.

During an outage, the last forecast stays displayed for 3 hours at most.

## Scenes

The integration adds its cards to the scene editor, in the **Integrations**
category. The **House** field lists your houses.

### Rain or snow expected within the hour

Trigger: starts the scene when the hourly forecast shows precipitation during
the current hour or the next one, where the previous refresh showed none. It
fires once per episode, at most once an hour per house, and never on the
first refresh after a restart.

Optional filters (empty: anything matches):

- **House**;
- **Precipitation**: rain, sleet or snow;
- **Intensity**: light, moderate or heavy.

Variables the following actions can use: the name of the house, the kind of
precipitation (`rain`, `sleet`, `snow`), the intensity (`light`, `moderate`,
`heavy`), whether there is thunder, the minutes until it starts (0 when it is
already raining), the amount expected in that hour, the probability (Nordic
countries only) and a **summary** ready to send, for example: "Light rain
with thunder expected in 35 minutes."

### Get the precipitation of the next hour

Action: tells the scene whether rain or snow is coming within the hour
(**Precipitation expected**: yes or no), when, what, how hard, and the same
summary. Leave **House** empty for your first house that has a location. If
no hourly forecast covers the hour, **Forecast available** is no: do not
conclude it will be dry.

### Get the forecast of the day

Action: reads the forecast of **today** (the rest of the day) or **tomorrow**
for a house, and returns:

- the sky, as a Gladys code (`clear`, `partly-cloudy`, `rain`, `snow`…) and in
  words ("Rain");
- the minimum and maximum temperatures;
- the precipitation of the day, and its probability (Nordic countries only);
- the strongest wind, and the strongest gust (Nordic countries only);
- a **summary**, for example: "Tomorrow: rain, 8 to 14 °C, 5.2 mm of
  precipitation."

## Scene examples

- **Bring the laundry in**: trigger "Rain or snow expected within the hour",
  then a notification with the **Summary** variable.
- **Morning weather**: at 7:00, action "Get the forecast of the day" (today),
  then a message or a speaker announcement with its **Summary**.
- **Watering**: every evening, action "Get the forecast of the day"
  (tomorrow), then a condition on **Precipitation** to start the watering
  only when less than 2 mm is expected.
- **Shutters and awning**: when the wind picks up, action "Get the
  precipitation of the next hour", then retract the awning if **Precipitation
  expected** is true.

## Limits

- **No official alerts** outside Norway (see above).
- **The hour is the finest step.** Outside the Nordic countries, MET Norway
  gives no minute-by-minute rain (Nowcast): the trigger announces a shower to
  the hour, not to the minute. The forecast is hourly for about two and a half
  days, then in 6-hour steps up to 9 days.
- **Gusts and chance of rain**: only in the Nordic countries.
- **No visibility**: MET Norway gives a fog fraction, not a distance.
- **The UV index** is the clear-sky one (the one Yr shows): a maximum, lower
  under clouds.
- **Today** only covers the hours to come: the minimum of the day is the
  minimum of the rest of the day.
- **The days** are cut in the time zone of Gladys, for every house.
- The integration requires Gladys 5.2 or later.

## Troubleshooting

- **"No house of Gladys has a location"** — set the location of your house in
  **Settings → Houses**.
- **"MET Norway has no usable forecast for the location of your house"** —
  the location is invalid: check it in **Settings → Houses**.
- **"MET Norway asks to slow down"** — too many requests from your Internet
  connection (another application may use the same API): the integration
  waits and retries on its own.
- **"MET Norway refuses the requests (HTTP 403)"** — MET Norway no longer
  accepts the identification of this version: update the integration.
- **"MET Norway is unreachable"** — Gladys cannot reach `api.met.no`: check
  its Internet access. The integration retries after 5 minutes, then less and
  less often.
- **The forecast temperature is wrong in the mountains** — enter the
  **Altitude** in the configuration.
- **The dashboard still shows another provider** — open the settings of the
  weather widget and pick MET Norway.
- **Logs**: the **Logs** tab of the integration shows every refresh
  ("Refreshed 1 location(s) of 1 house(s); next refresh in 31 min").

## Privacy

The coordinates of your houses, rounded to about 10 m, are sent to MET Norway
to get their forecast, and nowhere else. No account, no key, nothing is
written to disk.

## Credits

Weather data from [MET Norway](https://api.met.no/) (the Norwegian
Meteorological Institute), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): the forecasts are
converted to the Gladys weather format (units, symbols, days). The weather
symbols follow the legend of
[metno/weathericons](https://github.com/metno/weathericons). Thanks to MET
Norway for keeping its forecasts open to everyone.
