# PilotPaper V1 — état de validation

Dernière base contrôlée : branche `release/v1-monday`.

## Validé automatiquement
- CI GitHub complète : audit sécurité critique, build production, tests de régression et lint des fichiers modifiés.
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
- DP4, DP5 et DP6 reliées au même jeu de modules physiques.
- Liaison cryptographique des rendus avec les photos source utilisées par la géométrie (SHA-256).
- Masques d'édition construits depuis les îlots exacts des modules.
- Recomposition stricte : les pixels hors zone autorisée sont restaurés depuis la photo source.
- Inspector déterministe : nombre de panneaux, projection, chevauchements, conservation hors masque et présence de modification dans chaque îlot.
- QA photoréaliste strict pour DP4 et DP6 : perspective, échelle apparente, bords, lumière, reflets, netteté, bruit/compression et artefacts CGI.
- DP7 et DP8 conservent les photographies réelles d'origine.
- Export production bloqué si le QA ou le contrôle structurel du PDF échoue.
- Export de test explicitement marqué `test_unverified` lorsqu'un contrôle échoue.
- Cerfa embarqué vérifié par SHA-256 avant assemblage.
- Corpus de régression V1 : 1 pan, 2 pans, 4 pans simples, portrait, paysage, trapèze, obstacle métrique et recul gouttière dynamique.
- Les corrections spécifiques à une adresse ou à un bâtiment sont interdites : seules les règles génériques par classe d'erreur sont acceptées.

## Périmètre V1
La V1 vise les maisons résidentielles standard dont la toiture et les preuves sont suffisamment nettes pour être calibrées : toitures simples 1 pan, 2 pans et 4 pans simples, avec photos exploitables, vue IGN métrique et référence de panneau présente dans le catalogue fabricant vérifié.

Les cas complexes ou insuffisamment démontrés doivent échouer proprement au lieu d'être devinés.

## Dernière barrière avant Release Candidate V1
La validation automatisée ne remplace pas un essai réel du pipeline image. Le premier dossier témoin doit être exécuté avec :
1. une vraie maison résidentielle standard ;
2. les trois photographies utilisateur distinctes requises (`near`, `roof`, `far`) ;
3. les deux vues IGN générées par PilotPaper ;
4. une référence module certifiée dans le catalogue ;
5. `OPENAI_API_KEY` disponible dans l'environnement d'exécution ;
6. le mode production strict, sans `DP_TEST_EXPORT`.

Le dossier n'est déclaré Release Candidate V1 qu'après réussite de la chaîne complète : Roof Understanding → Layout → Projection → rendu DP4/DP6 → Inspector → assemblage DP1 à DP8 → contrôle PDF final.

Si un défaut réel apparaît, il doit être converti en règle universelle et en test de régression avant toute correction du cas témoin.
