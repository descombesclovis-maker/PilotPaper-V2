# PilotPaper V2 — Journal de transmission

Ce fichier est la source de continuité du chantier `release/v2`. Il doit être relu avant toute reprise dans un nouveau chat. La branche `release/v1` est gelée et ne doit jamais être modifiée.

## Objectif produit non négociable

PilotPaper doit produire un dossier photovoltaïque cohérent DP1→DP8 à partir d’un minimum d’informations utilisateur, avec une seule vérité physique du chantier réutilisée par toutes les pièces. L’IA peut comprendre et rendre visuellement, mais elle ne doit jamais être l’autorité finale sur le nombre de panneaux, leurs dimensions, le pan, les marges, les obstacles ou la perspective.

Architecture cible :

`Roof Understanding / OpenSolar / IGN / DSM / LiDAR -> Site Twin -> PV Layout déterministe -> Projection -> rendu Image-2 uniquement dans les zones autorisées -> Inspector -> DP1…DP8`

DP3 est une exception : elle doit être générée vectoriellement à partir du Site Twin, pas dessinée librement par l’IA.

## Branches

- `release/v1` : référence gelée, ne jamais modifier.
- `release/v2` : développement actif.
- canal de mise à jour Windows V2 : `pilotpaper-v2-latest`.

## Principes de conception validés

1. OpenSolar reste intégré comme source géométrique distante indépendante ; aucun nom de fournisseur externe ne doit apparaître dans l’UI.
2. Le moteur géométrique local reconstruit et contrôle la toiture à partir de DSM / IGN / LiDAR / nuages de points.
3. Le Site Twin est la seule vérité canonique utilisée ensuite par DP2→DP6.
4. Le PV Layout Engine calcule les panneaux avec dimensions fabricant, matrice exacte, marges dynamiques et exclusion des obstacles.
5. DP2 : projection géoréférencée déterministe.
6. DP3 : coupe vectorielle, idéalement perpendiculaire à un faîtage réellement détecté ; aucune cote architecturale inventée.
7. DP4 : composition avant/après déterministe ; seule la zone PV projetée peut être rendue par Image-2.
8. DP5/DP6 : Site Twin -> projection photo -> masque PV -> Image-2 dans le masque -> recomposition stricte avec photo source hors masque -> QA.
9. DP7/DP8 : photos originales, sans génération.
10. Les sorties mauvaises doivent rester visibles en mode diagnostic ; ne jamais masquer un échec par une fausse pièce réussie.

## État technique au 16/09/2026

Dernier HEAD connu au moment de la création de ce journal : `db903a284c0a8d991328ca3ca638d027e8408e20` (`Derive exact local-to-geographic transform from roof evidence`).

Déjà présent / branché :

- OpenSolar `advanced-roof-truth.ts`, avec facettes structurées (pente, azimut, surface) et comparaison au Site Twin.
- moteur Python embarqué dans l’EXE V2 et démarré automatiquement.
- entrées géométriques : DSM GeoTIFF, nuage de points LAS/LAZ, échantillons IGN, COPC LiDAR lorsque PDAL est disponible.
- segmentation RANSAC des pans.
- détection d’obstacles métriques et zones de sécurité.
- classification d’arêtes toiture (égout / faîtage / arêtier / noue lorsque démontrable).
- recalage photo OpenCV avec seuils : au moins 12 inliers, ratio >= 0,28, erreur de reprojection <= 8 px.
- Layout Engine déterministe avec recul gouttière préféré de 300 mm mais dynamique.
- route principale DP en cours de migration vers les générateurs Site Twin : DP2 déterministe, DP3 vectorielle, DP4 composition verrouillée, DP5/DP6 photographiques masquées.
- service Python de projection Site Twin -> photo ajouté et vérifié par le workflow Windows.
- `lib/site-twin-v2/localGeoTransform.ts` ajouté pour remplacer une approximation mètres/degrés par une transformation locale dérivée des sommets métriques + géoréférencés du pan.
- bouton de mise à jour V2 + canal `pilotpaper-v2-latest`, avec SHA-256 de l’installeur.

## Problèmes récemment détectés et corrigés / en cours

- L’ancienne V2 affichait parfois la photo source comme DP lorsque la génération visuelle échouait. Le diagnostic doit désormais être explicitement non validé.
- OpenSolar était présent mais partiellement dormant ; il doit alimenter le Site Twin et servir de contrôle indépendant.
- IGN/COPC devait être réellement consommé par le runtime Python, pas seulement annoncé côté TypeScript.
- Les obstacles étaient initialement absents du modèle (`obstacles: []`) ; ils sont maintenant détectés et doivent être respectés par le Layout Engine.
- Les arêtes communes étaient auparavant `unknown`, insuffisant pour DP3 ; elles sont désormais classifiées lorsque possible.
- Le premier pont Site Twin -> GPS utilisait une approximation locale ; elle est en cours de remplacement par `localGeoTransform.ts` dérivé des preuves réelles du pan.
- Trois anciens tests exigeaient encore les générateurs IA historiques (`generatePreventiveDp`, `generateSpecializedDp3`, `generateSpecializedDp4`) alors que la route a été migrée vers Site Twin. Ces tests doivent tester la nouvelle architecture, pas forcer les anciens générateurs.

## Travail immédiat à terminer AVANT le prochain test utilisateur

1. Brancher `localGeoTransform.ts` dans toute projection DP4/DP5/DP6 et supprimer l’ancienne approximation métrique->GPS.
2. Ajouter tests numériques de round-trip / résidu maximum sur la transformation locale ; rejeter une transformation insuffisamment précise.
3. Vérifier que DP2, DP3, DP4, DP5 et DP6 utilisent la même révision / identifiant de Site Twin.
4. Vérifier que chaque panneau projeté garde exactement le même identifiant / ordre / quantité d’une pièce à l’autre.
5. Durcir la génération masquée : masque dur pour la géométrie + petite zone de fusion uniquement pour anti-aliasing / ombre / reflet, sans permettre de déplacer les panneaux.
6. Pré-rendre si possible une texture photovoltaïque haute résolution selon la perspective, puis utiliser Image-2 seulement pour harmonisation photoréaliste ; préserver la résolution source.
7. Renforcer l’Inspector : compte exact, matrice, corners dans le pan, aucune intersection avec obstacles/keepouts, cohérence DP2↔DP3↔DP4↔DP5↔DP6, aucune modification hors masque.
8. Ajouter une batterie de cas synthétiques déterministes : toit 2 pans, 4 pans, L, pente faible/forte, obstacles, vue oblique, 1/2/3/4 colonnes, marges réduites.
9. Faire passer : `npm run build`, `npm test`, py_compile, build PyInstaller, smoke test moteur, .NET launcher, Inno Setup, artefact Windows, canal update.
10. Ne donner un nouvel EXE à l’utilisateur qu’une fois ces gates verts. Un build vert ne prouve pas encore une qualité universelle sur chantier réel : le prochain test terrain servira à mesurer cela.

## Critères de réussite à ne pas assouplir

- jamais modifier silencieusement le nombre de panneaux ou la matrice demandée ;
- jamais équiper le mauvais bâtiment / mauvais pan ;
- panneaux physiquement contenus dans le pan utile ;
- marges et obstacles respectés ;
- même implantation physique sur toutes les pièces ;
- photo hors zones PV inchangée pixel pour pixel après recomposition ;
- DP3 lisible comme une vraie planche technique, vectorielle et cohérente avec le Site Twin ;
- aucune sortie refusée par l’Inspector ne doit être présentée comme validée ;
- la V1 reste intacte.

## Phrase de reprise pour un nouveau chat

`Reprends PilotPaper V2 depuis docs/PILOTPAPER-V2-HANDOFF.md sur la branche release/v2, vérifie le HEAD et les derniers workflows, puis continue les tâches immédiates sans toucher release/v1.`
