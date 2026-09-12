# PilotPaper V1 — validation K-par-K

Cette branche est un **banc de validation local**. Elle sécurise les briques qui serviront ensuite à V2/V3/V4.

## Règle de travail

1. Tester chaque DP séparément sur plusieurs cas réels.
2. Corriger uniquement par règles générales + tests de régression.
3. Ne jamais masquer une incertitude géométrique derrière une génération IA.
4. Figer une pièce seulement lorsque sa géométrie est traçable et reproductible.
5. Rejouer le corpus V1 complet après toute correction du moteur.

## Architecture V1 de référence

`Adresse → Google Solar Building Insights → Target Property Resolver → parcelle APICARTO → zone sûre toiture → SurfaceSupport → PV Layout Engine → Projection Engine → DP → PilotPaper Inspector → Régression`

Le principe central est celui des logiciels solaires matures : **un fournisseur spécialisé propose la géométrie physique et PilotPaper reste responsable des dimensions fabricant, du calepinage exact, de la projection, de la cohérence documentaire et du contrôle qualité**.

Le **Roof Designer** reste disponible comme récupération humaine fiable lorsque le fournisseur automatique n'a pas de donnée exploitable. Il n'est plus le chemin normal de DP2.

### Ce qui est déterministe dans PilotPaper

- géocodage et contexte IGN/APICARTO ;
- recalage de la parcelle officielle au centre physique du bâtiment ;
- dimensions fabricant des modules ;
- choix d'un bloc contigu de cellules Google Solar déjà admissibles ;
- vérification que le champ photovoltaïque réel tient intégralement dans cette zone sûre ;
- calepinage exact rangées × colonnes ;
- jeux entre modules et recul bas ;
- projection ;
- contrôles de cohérence.

### Ce qui vient du fournisseur automatique

Google Solar Building Insights fournit notamment :

- le centre physique du bâtiment ;
- les segments de toiture ;
- pente et azimut ;
- dimensions du panneau de référence Google ;
- les centres des panneaux candidats déjà positionnés sur les segments ;
- leur orientation et leur segment d'appartenance ;
- un indicateur de qualité d'imagerie.

PilotPaper n'utilise pas les panneaux Google comme dimensions finales. Ils forment une **carte de cellules sûres**. Le moteur recherche un rectangle contigu entièrement couvert par ces cellules, assez grand pour contenir les dimensions réelles du module choisi dans le formulaire, puis le `PV Layout Engine` repose les modules fabricant exacts.

## Target Property Resolver

Le point postal peut être placé sur la rue ou près d'une limite cadastrale. Il ne doit donc jamais être la seule preuve de parcelle.

Flux V1 automatique :

1. l'adresse fournit une première coordonnée ;
2. Google Solar localise le bâtiment physique ;
3. PilotPaper utilise le **centre physique du bâtiment** pour refaire un reverse cadastral IGN ;
4. APICARTO retourne la géométrie vectorielle officielle de cette parcelle ;
5. cette parcelle devient la vérité cadastrale du dossier.

Cette étape doit empêcher les erreurs de type parcelle voisine lorsque le point adresse tombe sur une limite.

## Google Solar API — fournisseur AUTO primaire

Google Solar est le fournisseur automatique principal de DP2 V1 lorsqu'une clé est configurée et qu'un Building Insights exploitable est disponible.

Le chemin normal est :

`formulaire → adresse → Google Solar → bâtiment physique → parcelle officielle recalée → segment/zone sûre → dimensions fabricant → Layout Engine → DP2`

Règles :

- l'utilisateur ne doit pas cliquer sur le toit lorsque le chemin AUTO réussit ;
- la quantité, les rangées, colonnes, orientation, module, jeu et placement viennent du formulaire ;
- un bloc Google incomplet ou discontinu est rejeté ;
- les dimensions fabricant doivent tenir intégralement dans la zone sûre ;
- si aucune zone sûre n'est démontrée, PilotPaper bascule vers le Roof Designer au lieu d'inventer une géométrie ;
- les données `BASE` sont autorisées uniquement en V1 `test_unverified` et doivent rester signalées à l'Inspector ;
- aucune erreur fournisseur ne peut transformer une sortie incertaine en document validé.

## Roof Designer — fallback de sécurité

Le Roof Designer reste disponible si Google Solar est absent, indisponible ou incapable d'accueillir le calepinage exact demandé.

Dans ce mode seulement, l'utilisateur peut valider :

1. coin gauche de la gouttière ;
2. coin droit de la gouttière ;
3. coin droit du faîtage ;
4. coin gauche du faîtage ;
5. pente du pan ;
6. obstacles/keepouts éventuels.

Il ne doit jamais être déclenché tant que le chemin automatique Google Solar a démontré un support sûr compatible avec le formulaire.

## LiDAR HD IGN / BD TOPO

Les briques LiDAR HD IGN, BD TOPO, segmentation de pans et détection géométrique d'obstacles restent disponibles comme fournisseurs expérimentaux et futurs contrôles croisés. Le LiDAR est **optionnel** dans la V1 et ne doit jamais bloquer DP2.

## OpenAI

OpenAI n'est pas une source métrique pour DP2.

Son rôle cible est :

- contrôle visuel indépendant du résultat automatique ;
- détection d'incohérences évidentes entre orthophoto, bâtiment, champ photovoltaïque et document produit ;
- rendu photoréaliste pour les pièces où l'insertion paysagère est nécessaire, notamment DP6 ;
- classification ou commentaire d'obstacles lorsqu'une information sémantique est utile.

Une réponse OpenAI ne peut jamais déplacer ou redimensionner silencieusement un champ photovoltaïque déjà déterminé par la géométrie.

## Fournisseurs premium de secours futurs

Aurora AI Roof + AutoDesigner, Scanifly SolarAI ou une autre API spécialisée pourront être ajoutés derrière la même abstraction fournisseur. Ils devront produire un résultat compatible avec le `SiteModel` et ne jamais introduire de règle documentaire privée.

## Règle de promotion obligatoire

Le K-par-K est un laboratoire, pas l'architecture finale. Toute règle découverte pendant la validation d'une pièce doit être classée avant gel de la pièce :

- **document-specific** : rendu, légende, composition ou données propres à DP1/DP2/etc. ;
- **engine-level** : parcelle, géométrie, obstacle, métrique, layout, projection, contrôle qualité ; elle doit être extraite dans une brique commune.

Une pièce ne peut pas être déclarée validée si elle contient encore une copie privée d'une règle engine-level déjà nécessaire ailleurs.

## Briques communes actuelles

- `context/officialParcel.ts` : adresse → premier contexte cadastral IGN/APICARTO ;
- `context/ignRaster.ts` : accès WMS IGN et fallbacks ;
- `providers/googleSolar.ts` : Building Insights Google Solar ;
- `site-model/targetPropertyResolver.ts` : centre physique bâtiment → parcelle officielle recalée ;
- `site-model/googleSolarAutomaticRoof.ts` : cellules Google contiguës → zone sûre compatible avec le formulaire ;
- `site-model/manualRoofDesigner.ts` : fallback revu → géométrie métrique, avec correction de l'échelle Web Mercator ;
- `geometry/projectLayout.ts` : calepinage déterministe ;
- `geometry/panelProjection.ts` : projection homographique ;
- `site-model/siteModelEngine.ts` : expérimentation automatique secondaire ;
- `site-model/lidarAltimetry.ts` et `site-model/roofGeometryEngine.ts` : fournisseurs LiDAR expérimentaux et optionnels.

## DP1 — Plan de situation

DP1 doit :

- récupérer la géométrie cadastrale officielle ;
- dessiner le contour réel de la parcelle ;
- conserver adresse, référence cadastrale, nord et source ;
- ne jamais inventer de contour ;
- être confirmé sur plusieurs parcelles réelles.

Lorsque le Target Property Resolver corrige la parcelle cible à partir du bâtiment physique, cette même vérité cadastrale devra ensuite être partagée avec DP1 et toutes les autres pièces du dossier.

## DP2 — Plan de masse

Flux AUTO V1 :

`formulaire → Google Solar → parcelle cible recalée → zone sûre → Layout Engine → projection → DP2`

Contraintes :

- aucune photo utilisateur obligatoire ;
- aucun clic utilisateur obligatoire lorsque le fournisseur AUTO réussit ;
- le module réel vient du catalogue fabricant vérifié ;
- le Layout Engine ne peut jamais placer un module hors de la zone sûre démontrée ;
- le nombre de modules et le calepinage doivent correspondre exactement au formulaire ;
- la DP2 finale montre la maison et les parcelles environnantes ;
- la parcelle cible est contourée avec une couleur distincte ;
- un simple point repère l'adresse/accès ;
- Roof Designer seulement en récupération.

## Stratégie de fallback

Ordre de préférence V1 :

1. **Google Solar AUTO** ;
2. fournisseur automatique secondaire lorsqu'il sera intégré ;
3. **Roof Designer** revu ;
4. blocage explicite si aucune géométrie sûre ne peut être démontrée.

Il n'existe jamais de fallback « deviné » qui invente un toit ou un obstacle pour éviter un blocage.

## Gel des sujets périphériques

Jusqu'à validation DP1/DP2 et progression K-par-K :

- aucune amélioration esthétique du launcher ;
- aucune nouvelle fonction updater sauf blocage réel ;
- aucun travail de packaging hors nécessité de build ;
- aucune refonte UI sans impact direct sur la validation.

La priorité est le moteur.

## Mode de sécurité

Toute sortie de cet atelier porte le statut `test_unverified`.

- `DP_TEST_EXPORT=true`
- `DP_TEST_FAST=false`
- QA complète active
- aucune sortie V1 K-par-K ne peut devenir `verified`

Le passage en production/export strict reste une opération distincte.

## Application locale

La couche locale est suffisamment stable pour les tests :

- une seule instance Windows ;
- une seule fenêtre WebView2 ;
- moteur local sur `127.0.0.1:5174` ;
- aucune ouverture automatique dans le navigateur ;
- aucune mise à jour silencieuse ;
- bouton manuel **Mettre à jour PilotPaper** ;
- vérification SHA-256 de l'installeur ;
- dossier isolé `%LOCALAPPDATA%\PilotPaper\V1`.
