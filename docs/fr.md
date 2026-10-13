# MET Norway

La météo dans Gladys avec [MET Norway](https://www.met.no/en), l'Institut
météorologique norvégien : ses prévisions couvrent le monde entier, sont
gratuites et ne demandent **ni compte ni clé d'API**. C'est aussi la météo
installée par défaut dans Home Assistant.

Weather data from [MET Norway](https://api.met.no/) (données météo de MET
Norway), sous licence
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.fr). Cette
intégration est un projet communautaire, non affilié à MET Norway.

## Ce que vous obtenez

- **Le widget météo de Gladys et l'assistant de chat** utilisent MET Norway :
  la météo actuelle (température, ressenti, humidité, pression, point de
  rosée, vent, couverture nuageuse, indice UV, lever et coucher du soleil), les
  24 prochaines heures avec la pluie de chaque heure, et les 8 prochains jours.
  Le jour et la nuit ont leurs propres icônes. Tout est affiché en **°C, m/s
  et mm** ou en **°F, mph et pouces**, selon le système d'unités de chaque
  utilisateur de Gladys.
- **Dans les pays nordiques** (Norvège, Suède, Finlande, Danemark, pays
  baltes), MET Norway donne en plus les **rafales** et la **probabilité de
  pluie** : elles s'affichent dans le widget et dans les scènes.
- **Déclencheur de scène « Pluie ou neige attendue dans l'heure »**.
- **Action de scène « Obtenir les précipitations de l'heure à venir »**.
- **Action de scène « Obtenir la prévision du jour »** (aujourd'hui ou demain),
  avec une phrase prête à mettre dans un message.

Pas de widget en plus : le widget météo de Gladys affiche déjà tout ce que
MET Norway publie.

**Pas d'alertes météo.** MET Norway ne publie ses alertes (MetAlerts) que pour
la Norvège : le déclencheur intégré « Alerte météo » de Gladys reste muet avec
cette intégration. Pour les alertes, installez à côté l'intégration **Météo
France** (vigilance, France) ou **Pirate Weather** (États-Unis, Canada,
Europe).

## Installation

1. Dans Gladys, vérifiez que votre maison a une position : **Paramètres →
   Maisons**, puis renseignez l'adresse ou la position sur la carte.
   L'intégration met à jour la météo de chaque maison qui en a une.
2. Installez **MET Norway** depuis le catalogue des intégrations (ou
   **Intégrations → Installer depuis GitHub**, avec l'adresse
   `https://github.com/guim31/gladys-met-no`). Gladys vous demande
   d'autoriser l'accès à la position de vos maisons : il sert à surveiller la
   pluie de l'heure à venir pour le déclencheur de scène.
3. Ouvrez l'onglet **Configuration** et cliquez sur **Tester MET Norway**. La
   réponse affiche la température actuelle de votre première maison.

C'est tout : le widget météo de votre tableau de bord affiche désormais MET
Norway. Si une autre intégration météo est installée, choisissez le
fournisseur dans les réglages du widget météo.

Gladys 5.2 ou plus récent est nécessaire.

## Configuration

Rien n'est obligatoire.

- **Altitude (m)** — laissez vide : MET Norway utilise alors son modèle de
  terrain, juste presque partout. Renseignez l'altitude seulement en montagne,
  si la température prévue est nettement trop chaude ou trop froide pour votre
  maison (une vallée encaissée, un chalet bien au-dessus du village).
  L'altitude s'applique à toutes vos maisons.
- **Unités des valeurs de scène** — les unités des températures, du vent et
  des précipitations que l'intégration met dans les variables de scène.
  **Automatique** suit le système d'unités du dernier utilisateur qui a
  regardé la météo ; choisissez **Métrique** ou **US** pour le figer. Le widget
  météo, lui, suit toujours la préférence de chaque utilisateur.
- **Langue des textes de scène** — la langue des phrases que l'intégration
  écrit dans les variables de scène (« Pluie modérée attendue dans 35
  minutes. ») : anglais, français, allemand ou espagnol. Français par défaut ;
  **Automatique** suit la langue de votre Gladys.

## Fréquence de mise à jour et conditions de MET Norway

MET Norway offre son API à condition que chaque application la ménage.
L'intégration applique ses
[conditions d'utilisation](https://api.met.no/doc/TermsOfService) :

- **une mise à jour toutes les 30 minutes environ**, jamais avant l'heure
  d'expiration que MET Norway indique avec chaque prévision, plus quelques
  minutes tirées au hasard pour que les installations de Gladys n'appellent
  pas toutes à la même seconde ;
- **un seul appel par maison** (les maisons au même endroit le partagent), qui
  alimente tout : le tableau de bord, le chat et les scènes. Ouvrir le tableau
  de bord ne coûte rien : Gladys est servi depuis la prévision en mémoire ;
- **une requête conditionnelle** : si la prévision n'a pas changé, MET Norway
  répond « rien de nouveau » sans la renvoyer ;
- des coordonnées arrondies à 4 décimales (environ 10 m) et une
  identification de l'application (`gladys-met-no/<version>
github.com/guim31/gladys-met-no`), comme MET Norway l'exige ;
- si MET Norway demande de ralentir (erreur 429), l'intégration se met en
  pause 10 minutes, puis de plus en plus longtemps si cela se répète ; s'il
  refuse les requêtes (erreur 403), elle attend 6 heures.

Pendant une panne, la dernière prévision reste affichée 3 heures au plus.

## Scènes

L'intégration ajoute ses cartes à l'éditeur de scènes, dans la catégorie
**Intégrations**. Le champ **Maison** propose la liste de vos maisons.

### Pluie ou neige attendue dans l'heure

Déclencheur : démarre la scène quand la prévision horaire annonce des
précipitations pendant l'heure en cours ou la suivante, alors que la mise à
jour précédente n'en annonçait pas. Il se déclenche une fois par épisode, au
plus une fois par heure et par maison, et jamais à la première mise à jour
après un redémarrage.

Filtres facultatifs (vides : tout convient) :

- **Maison** ;
- **Précipitations** : pluie, neige fondue ou neige ;
- **Intensité** : faible, modérée ou forte.

Variables utilisables dans les actions suivantes : le nom de la maison, le type
de précipitations (`rain`, `sleet`, `snow`), l'intensité (`light`,
`moderate`, `heavy`), la présence d'orage, les minutes avant le début (0 s'il
pleut déjà), la quantité prévue dans cette heure, la probabilité (pays
nordiques seulement) et un **résumé** prêt à envoyer, par exemple : « Pluie
faible avec orage attendue dans 35 minutes. »

### Obtenir les précipitations de l'heure à venir

Action : indique à la scène si de la pluie ou de la neige arrive dans l'heure
(**Précipitations attendues** : oui ou non), quand, quoi, avec quelle
intensité, et le même résumé. Laissez **Maison** vide pour votre première
maison qui a une position. Si aucune prévision horaire ne couvre l'heure,
**Prévision disponible** vaut non : ne concluez pas qu'il fera sec.

### Obtenir la prévision du jour

Action : lit la prévision d'**aujourd'hui** (le reste de la journée) ou de
**demain** pour une maison, et renvoie :

- le ciel, en code Gladys (`clear`, `partly-cloudy`, `rain`, `snow`…) et en
  toutes lettres (« Pluie ») ;
- les températures minimale et maximale ;
- les précipitations de la journée, et leur probabilité (pays nordiques
  seulement) ;
- le vent le plus fort, et la rafale la plus forte (pays nordiques seulement) ;
- un **résumé**, par exemple : « Demain : pluie, de 8 à 14 °C, 5,2 mm de
  précipitations. »

## Exemples de scènes

- **Rentrer le linge** : déclencheur « Pluie ou neige attendue dans l'heure »,
  puis une notification avec la variable **Résumé**.
- **Météo du matin** : à 7 h, action « Obtenir la prévision du jour »
  (aujourd'hui), puis un message ou une annonce sur l'enceinte avec son
  **Résumé**.
- **Arrosage** : chaque soir, action « Obtenir la prévision du jour »
  (demain), puis une condition sur **Précipitations** pour ne lancer
  l'arrosage que si moins de 2 mm sont prévus.
- **Volets et store** : quand le vent se lève, action « Obtenir les
  précipitations de l'heure à venir », puis rentrer le store si
  **Précipitations attendues** est vrai.

## Limites

- **Pas d'alertes officielles** hors de Norvège (voir plus haut).
- **L'heure est le pas le plus fin.** Hors des pays nordiques, MET Norway ne
  donne pas la pluie minute par minute (Nowcast) : le déclencheur annonce une
  averse à l'heure près, pas à la minute. La prévision est horaire pendant
  environ deux jours et demi, puis par tranches de 6 heures jusqu'à 9 jours.
- **Rafales et probabilité de pluie** : seulement dans les pays nordiques.
- **Pas de visibilité** : MET Norway donne une fraction de brouillard, pas une
  distance.
- **L'indice UV** est celui d'un ciel dégagé (celui qu'affiche Yr) : un
  maximum, plus bas sous les nuages.
- **Aujourd'hui** ne couvre que les heures à venir : le minimum du jour est
  celui du reste de la journée.
- **Les journées** sont découpées selon le fuseau horaire de Gladys, pour
  toutes les maisons.
- L'intégration nécessite Gladys 5.2 ou plus récent.

## Dépannage

- **« Aucune maison de Gladys n'a de position »** — renseignez la position de
  votre maison dans **Paramètres → Maisons**.
- **« MET Norway n'a pas de prévision utilisable pour la position de votre
  maison »** — la position est invalide : vérifiez-la dans **Paramètres →
  Maisons**.
- **« MET Norway demande de ralentir »** — trop de requêtes depuis votre
  connexion Internet (une autre application utilise peut-être la même API) :
  l'intégration patiente et réessaie seule.
- **« MET Norway refuse les requêtes (HTTP 403) »** — MET Norway n'accepte
  plus l'identification de cette version : mettez à jour l'intégration.
- **« MET Norway est injoignable »** — Gladys n'arrive pas à joindre
  `api.met.no` : vérifiez son accès à Internet. L'intégration réessaie après
  5 minutes, puis de moins en moins souvent.
- **La température prévue est fausse en montagne** — renseignez l'**Altitude**
  dans la configuration.
- **Le tableau de bord affiche toujours un autre fournisseur** — ouvrez les
  réglages du widget météo et choisissez MET Norway.
- **Logs** : l'onglet **Logs** de l'intégration (ou `docker logs` sur
  l'hôte) montre le démarrage, les problèmes et le retour de MET Norway, une
  fois chacun, pas chaque mise à jour. Lancez le conteneur avec
  `LOG_LEVEL=debug` pour voir chaque mise à jour et chaque nouvel essai.

## Vie privée

Les coordonnées de vos maisons, arrondies à environ 10 m, sont envoyées à MET
Norway pour obtenir leur prévision, et nulle part ailleurs. Pas de compte, pas
de clé, rien n'est enregistré sur le disque.

## Crédits

Weather data from [MET Norway](https://api.met.no/) (Institut météorologique
norvégien), sous licence
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.fr) : les
prévisions sont converties au format météo de Gladys (unités, symboles,
journées). Les symboles météo suivent la légende de
[metno/weathericons](https://github.com/metno/weathericons). Merci à MET
Norway de garder ses prévisions ouvertes à tous.
