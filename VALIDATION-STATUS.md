# PilotPaper V1 — état de validation

Dernière base contrôlée : branche `release/v1-k-par-k-local`.

## Validé automatiquement par le corpus existant

- CI GitHub : build web, tests de régression, compilation du launcher Windows et packaging contrôlé avant publication.
- Résolution cadastrale commune IGN/APICARTO.
- Accès raster IGN commun avec orthophoto et cadastre séparés, plus fallbacks d'endpoint.
- Solveur de calepinage déterministe avec coordonnées physiques uniques par module.
- Dimensions et puissance issues de la référence fabricant vérifiée.
- Calepinage fixe sans reflow silencieux.
- Réduction dynamique du recul gouttière préféré avant rejet.
- Contrôle polygonal des limites et obstacles/keepouts.
- Géométrie de production projetée par homographie.
- DP4, DP5 et DP6 reliées au même jeu de modules physiques dans le pipeline dossier complet historique.
- Inspector déterministe et QA photoréaliste strict disponibles pour les pièces visuelles.
- Tout export K-par-K/test reste `test_unverified`.
- Cerfa embarqué vérifié par SHA-256 avant assemblage.
- Les corrections spécifiques à une adresse ou à un bâtiment sont interdites : seules les règles génériques par classe d'erreur sont acceptées.

## Nouveau chemin automatique DP2 en validation

Le chemin prioritaire DP2 V1 est désormais :

`adresse → Google Solar Building Insights → centre physique bâtiment → Target Property Resolver → parcelle APICARTO → cellules de panneaux Google contiguës → dimensions fabricant exactes → PV Layout Engine → projection → DP2`

Google Solar est utilisé comme fournisseur spécialisé du **support solaire admissible**, pas comme rendu final :

- `roofSegmentStats` fournit pente/azimut/segment ;
- `solarPanels` fournit les centres de panneaux candidats déjà positionnés ;
- PilotPaper reconstruit une grille de cellules ;
- seuls les rectangles entièrement contigus sont admis ;
- les dimensions réelles du module du formulaire doivent tenir intégralement dans ce bloc ;
- le Layout Engine reste la source du nombre exact, des dimensions fabricant, des rangées/colonnes, du jeu et du placement final.

Si le chemin automatique ne peut pas démontrer un support compatible, PilotPaper bascule vers le Roof Designer. Il n'invente aucune géométrie.

## Correction Target Property

La parcelle ne doit plus être choisie uniquement à partir du point postal, qui peut tomber sur la rue ou une limite.

Le nouveau `TargetPropertyResolver` utilise le centre physique retourné par le fournisseur bâtiment, refait un reverse cadastral IGN à cet endroit, puis recharge la géométrie vectorielle officielle APICARTO. Cette brique est destinée à éliminer les erreurs de parcelle voisine.

## Correction métrique importante

Le Roof Designer et les surfaces dérivées d'une orthophoto EPSG:3857 corrigent désormais l'échelle Web Mercator avec le facteur local `cos(latitude)` avant de convertir les coordonnées en mètres physiques. Les cotes toiture ne doivent plus assimiler directement un mètre projeté EPSG:3857 à un mètre terrain.

## Architecture de référence actuelle

`Official Address Context → Automatic Roof Provider → Target Property Resolver → Official Parcel → Safe Surface → SurfaceSupport → PV Layout Engine → Projection Engine → Photorealistic Render Engine → PilotPaper Inspector → Régression`

Pour DP2 V1, le fournisseur automatique primaire est Google Solar. Le Roof Designer est un fallback revu. Le LiDAR HD IGN / BD TOPO reste expérimental et optionnel. OpenAI n'est pas une source métrique DP2 ; il doit servir de contrôle visuel et, plus tard, de rendu photoréaliste pour DP6.

## Briques communes déjà promues

- `lib/dp-ai-engine/context/officialParcel.ts`
- `lib/dp-ai-engine/context/ignRaster.ts`
- `lib/dp-ai-engine/providers/googleSolar.ts`
- `lib/dp-ai-engine/site-model/targetPropertyResolver.ts`
- `lib/dp-ai-engine/site-model/googleSolarAutomaticRoof.ts`
- `lib/dp-ai-engine/site-model/manualRoofDesigner.ts`
- `lib/dp-ai-engine/geometry/projectLayout.ts`
- `lib/dp-ai-engine/geometry/panelProjection.ts`

Les anciens moteurs Cross-View, obstacle Vision et LiDAR restent dans le dépôt pour expérimentation, contrôle ou autres pièces, mais ne constituent plus le chemin automatique primaire de DP2.

## Périmètre V1

La V1 vise d'abord les maisons résidentielles standard 1/2/4 pans. Un cas automatique est accepté uniquement si le fournisseur spécialisé retourne des données exploitables et si le calepinage réel demandé tient dans une zone sûre démontrée.

Les cas non couverts doivent passer en récupération revue ou échouer proprement au lieu d'être devinés.

## État K-par-K

- DP1 : moteur cadastral implémenté ; validation multi-cas réelle encore requise avant gel.
- DP2 : Google Solar AUTO + recalage de parcelle + Layout exact en cours de validation CI puis réelle.
- DP3 à DP8 : à valider ensuite dans cet ordre, en réutilisant progressivement la même vérité SiteModel/support/layout.

## Barrière de changement de stratégie

Si Google Solar est réellement disponible sur les maisons V1 mais que notre conversion de ses segments/panneaux en zone sûre échoue sur plusieurs maisons simples, on corrige ou remplace **l'adaptateur provider**, pas le Layout Engine avec des règles spécifiques aux adresses.

Si la couverture Google Solar est insuffisante sur notre marché réel, le prochain provider à évaluer est une API spécialisée telle qu'Aurora AI Roof + AutoDesigner / Scanifly, derrière la même abstraction, sans remettre la géométrie dans un prompt Vision généraliste.

## Gel des sujets périphériques

Tant que DP1/DP2 puis le K-par-K ne sont pas validés : aucune amélioration esthétique du launcher, aucune nouvelle fonction updater et aucun travail de packaging hors nécessité de test. La priorité est le moteur.

## Dernière barrière avant Release Candidate V1

La validation automatisée ne remplace pas les essais réels. Avant Release Candidate :

1. plusieurs maisons résidentielles standard doivent passer le chemin AUTO ;
2. la parcelle et le bâtiment doivent être vérifiés visuellement ;
3. le nombre, les rangées/colonnes, l'orientation et les dimensions fabricant doivent être exacts ;
4. le même support/layout doit alimenter les autres DP ;
5. les pièces photoréalistes doivent passer l'Inspector ;
6. l'assemblage DP1 à DP8 et le PDF final doivent passer le contrôle structurel ;
7. le mode production strict doit rester distinct du banc `test_unverified`.

Tout défaut réel doit devenir une règle universelle et un test de régression avant correction du cas témoin.
