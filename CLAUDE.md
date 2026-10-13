# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/pivot.test.js            # one file
node --test --test-name-pattern "Oslo"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

A **weather** integration (manifest `type: "weather"`): no devices, a provider
API. Gladys asks for the weather of a house (`onWeatherGet`), the integration
answers in the pivot format of the core from the forecast it keeps in memory.

```
index.js                          SDK wiring only: createApp() then connect()
src/app.js                        the integration on an injected client: handlers, status, lifecycle
src/api.js                        the one MET Norway request (User-Agent, If-Modified-Since, error kinds)
src/forecast.js                   GeoJSON response → slim metric forecast (points sorted by time)
src/forecast-store.js             cache per location; enforces Expires, 304, 429/403 pauses
src/scheduler.js                  refresh timer: at Expires, ≥ 30 min, + 0-5 min jitter
src/pivot.js                      slim forecast → pivot weather (current, 24 hours, 8 days)
src/daily.js                      days cut at local midnights, precipitation timeline
src/symbols.js                    the 83 symbol codes → Gladys conditions, day/night variant
src/sun.js, src/time.js           computed sunrise/sunset (NOAA), local days (TZ)
src/next-hour.js                  precipitation within the hour (trigger + action)
src/scene-triggers.js             "precipitation_expected" (dry → wet, baseline, 1 h cooldown)
src/scene-actions.js              "get_precipitation_next_hour", "get_day_forecast"
src/houses.js                     the houses of Gladys (getHouses, `location: true`)
src/failure-log.js                repeated failures logged once (warn, debug, then info on recovery)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/texts.js, src/units.js        texts in en/fr/de/es, metric → us conversions
gladys-assistant-integration.json manifest: name, config_schema, actions, scene cards, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en and fr mandatory)
test/                             node --test, against the SDK's fake Gladys and real API responses
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Logs.** At `info` (the default), only the lifecycle: start, MET Norway or
  Gladys lost and back, errors the user can act on, one line per user action.
  A refresh cycle, a published event, a retry are `debug` (the SDK logger reads
  `LOG_LEVEL`: debug, info, warn, error, silent). A failure that repeats goes
  through `src/failure-log.js`: one warning at the first failure, `debug`
  while it repeats, one `info` when it recovers. `test/logs.test.js` checks it.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0; `source: "houses"`: 5.2.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** exists in English, French, German and Spanish: action
  messages, scene texts, manifest texts, and `docs/{en,fr,de,es}.md`, kept in
  sync (`test/i18n.test.js` checks it).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli. **Piège du 5.2.0**
  (GladysAssistant/Gladys#3198, correctif #3199 non publié) : les appareils **déjà créés** sans
  `should_poll` ne sont **jamais** sondés, même après correction. Ici, sans objet : un fournisseur
  météo n'a pas d'appareil, les mises à jour viennent du minuteur du conteneur (`scheduler.js`),
  jamais du polling du cœur ; `test/logs.test.js` vérifie qu'il se relance seul.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. La dernière version publiée est la **5.2.0** (12/10/2026). Les boutons
  de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8) étaient absents de la 5.1.4 : le
  bouton s'affichait et n'envoyait rien. Vérifier par `git tag --contains`.

- Un réglage de widget, un champ de scène ou d'action ne propose en liste que les **appareils**
  de l'intégration (`source: "devices"`) ou, **depuis la 5.2.0**, les **maisons** de Gladys
  (`source: "houses"`, la valeur reçue est le `selector`), ce qui impose `gladys_version >=5.2.0`.
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. L'indexeur du store publie `docs/en.md` et `docs/fr.md`
(obligatoires), et aussi `docs/de.md` et `docs/es.md` quand ils existent (`DOCS_OPTIONAL_LANGUAGES` d'integration-store) :
les quatre docs sont écrites, avec les mêmes sections (vérifié par `test/i18n.test.js`). Attention, le test du « Sie »
attrape aussi le « sie/Sie » de la 3e personne en début de phrase : reformuler.

## MET Norway (cette intégration)

**API.** `GET https://api.met.no/weatherapi/locationforecast/2.0/complete?lat&lon[&altitude]`,
GeoJSON (`geometry.coordinates` = [lon, lat, altitude], `properties.timeseries`). Pas horaire
pendant ~50 à 60 h selon le lieu, puis 6 h jusqu'à J+9/10. Chaque instant : `instant.details`
(état de l'air) et `next_1_hours` / `next_6_hours` / `next_12_hours` (période qui **commence** à
cet instant : symbole, précipitations, min/max sur 6 h). Toutes les heures en UTC, unités
métriques fixes. Réponses réelles du 12/10/2026 dans `test/fixtures/` (voir leur README).

**Conditions d'utilisation, appliquées dans `forecast-store.js`** (aucun appelant ne peut les
contourner) : `User-Agent` `gladys-met-no/<version> github.com/guim31/gladys-met-no` (version lue
dans `package.json`, donc suivie par la Release) ; 4 décimales au plus ; jamais d'appel avant
`Expires` ; après, `If-Modified-Since` = le `Last-Modified` reçu, tel quel (304 sans corps : on
garde la prévision) ; 429 → pause 10 min doublée jusqu'à 2 h ; 403 → 6 h ; 203 → log. Le planificateur
ajoute 0 à 5 min au hasard (les CGU demandent d'étaler les appels). Constaté : `Expires` arrive
12 à 31 min après la requête, d'où le plancher de 30 min.

**Pièges découverts.**

- Hors pays nordiques, **ni rafales, ni probabilités** (pluie, orage), ni percentiles : champs
  absents, pas nuls. Les sorties de scène correspondantes sont omises, jamais mises à 0.
- `ultraviolet_index_clear_sky` est l'UV **par ciel clair** (un maximum). Pas de visibilité.
- `symbol_code` : 41 symboles, 21 avec variantes `_day`/`_night`/`_polartwilight` (83 codes).
  Deux fautes officielles gardées par l'API : `lightssleetshowersandthunder`,
  `lightssnowshowersandthunder` (et un espace parasite dans `legend.csv`). `fair` →
  `partly-cloudy`, comme Home Assistant (pas `clear`).
- Les derniers instants horaires n'ont **que** `next_1_hours`, le premier instant 6-horaire
  n'a pas `next_1_hours` : la frise des précipitations (`precipitationTimeline`) prend l'heure
  tant que l'instant suivant est à +1 h, sinon les 6 h, sans recouvrement.
- Le dernier jour de la prévision n'est souvent couvert que par un instant de minuit UTC : il
  est écarté (`buildDays`), sinon il afficherait les extrêmes de quelques heures de nuit.
- Sans altitude, MET utilise son modèle de terrain (`geometry.coordinates[2]` la renvoie) ; le
  cœur ne stocke pas l'altitude des maisons, d'où un champ facultatif unique.
- Pas de lever/coucher du soleil dans Locationforecast : calcul local (`sun.js`) plutôt qu'un
  appel Sunrise 3.0 par maison et par jour.

**Pièges du cœur 5.2.0 (type weather).**

- `onWeatherGet` reçoit `{ latitude, longitude, language, units }` ; `units` vaut `metric` ou
  `us`. Le contrat B.18 et le SDK disent : précipitations en **pouces** pour `us`. Mais le widget
  météo du front 5.2.0 (`WeatherBox.jsx`, `formatRain`) considère les précipitations **toujours
  en mm** et les divise lui-même par 25,4, alors que le chat (MCP `formatWeather`) les étiquette
  « in ». L'intégration suit le contrat (pouces, comme `gladys-open-meteo`) : en `us`, le widget
  affichera des pouces divisés deux fois. Incohérence du cœur à signaler.
- Une erreur d'`onWeatherGet` (lancée) fait passer le cœur au fournisseur suivant. Le cœur ne
  transmet ni la maison ni son `selector` à `onWeatherGet`, seulement ses coordonnées.
- L'ack d'une action, d'une action de scène ou d'une demande météo du faux Gladys du SDK porte
  l'erreur en **chaîne** (`ack.error`), pas en objet.
