# PilotPaper V1 — état de validation

Dernière base contrôlée : branche `release/v1-k-par-k-local`.

## Validé automatiquement
- CI GitHub : build web, tests de régression, compilation du launcher Windows et packaging contrôlé avant publication.
- Résolution cadastrale commune : adresse IGN → parcelle → géométrie vectorielle APICARTO.
- Accès raster IGN commun avec orthophoto et cadastre séparés, plus fallbacks d'endpoint.
- Cross-View Surface Identity Engine commun : même bâtiment et même pan physique démontrés avant toute implantation.
- Réconciliation d'identité en deux passes fail-closed : le second passage reçoit les causes déterministes du rejet, sans baisse des seuils.
- Reconstruction métrique commune d'une surface prouvée, y compris reprojection projective des obstacles vus sur photo.
- Solveur de calepinage déterministe avec coordonnées physiques uniques par module.
- Dimensions et puissance issues de la référence fabricant vérifiée, jamais déduites de la puissance seule.
- Calepinage fixe conservé s'il tient réellement ; aucun reflow silencieux en mode fixe.
- Mode automatique capable d'énumérer plusieurs matrices compatibles.
- Réduction dynamique du recul gouttière préféré avant rejet.
- Répartition multi-pans déterministe sans franchissement de faîtage.
- Contrôle polygonal des limites de pan et des obstacles métriques.
- Un obstacle non localisable métriquement bloque le pan au lieu d'être ignoré.
- Panneaux adjacents autorisés à gap nul ; chevauchement de surface interdit.
- Géométrie de production projetée par homographie ; aucun fallback bilinéaire silencieux.
- Quadrilatère de perspective dégénéré, non fini, auto-croisé ou mal ordonné rejeté.
- DP4, DP5 et DP6 reliées au même jeu de modules physiques dans le pipeline dossier complet.
- Liaison cryptographique des rendus avec les photos source utilisées par la géométrie (SHA-256).
- Masques d'édition construits depuis les îlots exacts des modules.
- Recomposition stricte : les pixels hors zone autorisée sont restaurés depuis la photo source.
- Inspector déterministe : nombre de panneaux, projection, chevauchements, conservation hors masque et présence de modification dans chaque îlot.
- QA photoréaliste strict pour DP4 et DP6 : perspective, échelle apparente, bords, lumière, reflets, netteté, bruit/compression et artefacts CGI.
- DP7 et DP8 conservent les photographies réelles d'origine.
- Export production bloqué si le QA ou le contrôle structurel du PDF échoue.
- Tout export K-par-K/test reste `test_unverified`.
- Cerfa embarqué vérifié par SHA-256 avant assemblage.
- Corpus de régression V1 : 1 pan, 2 pans, 4 pans simples, portrait, paysage, trapèze, obstacle métrique, recul gouttière dynamique, identité cross-view et ancrage cadastral.
- Les corrections spécifiques à une adresse ou à un bâtiment sont interdites : seules les règles génériques par classe d'erreur sont acceptées.

## Architecture de référence actuelle

`Official Parcel Context → Cross-View Surface Identity → Roof/Surface Understanding → SurfaceSupport → PV Layout Engine → Projection Engine → Photorealistic Render Engine → PilotPaper Inspector → Régression`

Le K-par-K sert à découvrir les failles. Toute règle engine-level trouvée dans DP1/DP2/etc. doit être promue dans une brique commune avant gel de la pièce.

Briques communes déjà promues :
- `lib/dp-ai-engine/context/officialParcel.ts`
- `lib/dp-ai-engine/context/ignRaster.ts`
- `lib/dp-ai-engine/identity/crossViewSurfaceIdentity.ts`
- `lib/dp-ai-engine/geometry/metricSurfaceFromIdentity.ts`
- `lib/dp-ai-engine/geometry/projectLayout.ts`
- `lib/dp-ai-engine/geometry/panelProjection.ts`

## Périmètre V1
La V1 vise les maisons résidentielles standard dont la toiture et les preuves sont suffisamment nettes pour être calibrées : toitures simples 1 pan, 2 pans et 4 pans simples, avec photos exploitables, vue IGN métrique et référence de panneau présente dans le catalogue fabricant vérifié.

Les cas complexes ou insuffisamment démontrés doivent échouer proprement au lieu d'être devinés.

## État K-par-K
- DP1 : moteur cadastral commun branché ; contour vectoriel officiel implémenté ; validation multi-cas réelle encore requise avant gel.
- DP2 : nouveau pipeline parcelle → identité cross-view → métrique → layout → projection ; validation multi-cas réelle encore requise avant gel.
- DP3 à DP8 : à valider ensuite dans cet ordre, sans sauter de pièce.

## Barrière de changement de stratégie
Si plusieurs maisons V1 simples et exploitables échouent encore au stade identité bâtiment/pan après le nouveau pipeline partagé, sans amélioration mesurable ni nouvelle classe d'erreur claire, on arrête les patchs du pipeline actuel et on réévalue le Roof Understanding Engine (modèle, découpage en étapes, sources géométriques et calibration) avant DP3.

## Gel des sujets périphériques
Tant que DP1/DP2 puis le K-par-K ne sont pas validés : aucune amélioration esthétique du launcher, aucune nouvelle fonction updater et aucun travail de packaging hors nécessité de test. La priorité est le moteur.

## Dernière barrière avant Release Candidate V1
La validation automatisée ne remplace pas des essais réels. Les pièces doivent d'abord passer plusieurs cas K-par-K, puis le premier dossier témoin complet doit être exécuté avec :
1. une vraie maison résidentielle standard ;
2. les trois photographies utilisateur distinctes requises par le dossier complet (`near`, `roof`, `far`) ;
3. les vues IGN générées par PilotPaper ;
4. une référence module certifiée dans le catalogue ;
5. `OPENAI_API_KEY` disponible dans l'environnement d'exécution ;
6. le mode production strict, sans `DP_TEST_EXPORT`.

Le dossier n'est déclaré Release Candidate V1 qu'après réussite de la chaîne complète : Parcel Context → Cross-View Identity → Roof Understanding → Layout → Projection → rendu DP4/DP6 → Inspector → assemblage DP1 à DP8 → contrôle PDF final.

Si un défaut réel apparaît, il doit être converti en règle universelle et en test de régression avant toute correction du cas témoin.
