# PilotPaper V1 — validation K-par-K

Cette branche est un **banc de validation local**. Elle sécurise les briques qui serviront ensuite à V2/V3/V4.

## Règle de travail

1. Tester chaque DP séparément sur plusieurs cas réels.
2. Corriger uniquement par règles générales + tests de régression.
3. Ne jamais masquer une incertitude géométrique derrière une génération IA.
4. Figer une pièce seulement lorsque sa géométrie est traçable et reproductible.
5. Rejouer le corpus V1 complet après toute correction du moteur.

## Architecture V1 de référence

`Official Parcel Context → Roof Designer revu → SurfaceSupport → Keepouts → PV Layout Engine → Projection Engine → Photorealistic Render Engine → PilotPaper Inspector → Régression`

Le principe central est désormais celui des logiciels solaires matures : **le modèle du site est validé avant de générer les plans**.

### Ce qui est déterministe

- parcelle et contexte IGN/APICARTO ;
- échelle de l'orthophoto ;
- géométrie métrique issue du Roof Designer ;
- dimensions fabricant des modules ;
- keepouts ;
- calepinage ;
- projection ;
- contrôles de cohérence.

### Ce qui peut demander une validation humaine

Pour la V1, l'utilisateur peut valider le pan dans le **Roof Designer** :

1. coin gauche de la gouttière ;
2. coin droit de la gouttière ;
3. coin droit du faîtage ;
4. coin gauche du faîtage ;
5. pente du pan ;
6. obstacles/keepouts éventuels.

L'orthophoto IGN fournit déjà l'échelle planimétrique. Aucune largeur de toiture n'est demandée à l'utilisateur pour la DP2.

Cette intervention courte est volontaire : elle remplace une chaîne automatique fragile par une géométrie explicitement revue, comme dans les outils professionnels de conception solaire.

## Fournisseurs automatiques : optionnels, jamais bloquants

### Google Solar API

Google Solar API est la première piste d'automatisation premium à brancher autour du Roof Designer. Elle peut fournir notamment segments de toiture, pente, azimut, hauteur de plan et informations de panneaux. Elle pourra préremplir ou suggérer des valeurs, mais **ne doit jamais bloquer** la génération si elle est indisponible.

### LiDAR HD IGN / BD TOPO

Les briques LiDAR HD IGN, BD TOPO, segmentation de pans et détection géométrique d'obstacles restent dans le dépôt comme moteur expérimental et futur fournisseur automatique. Le LiDAR est **optionnel** dans la V1 fiable et ne doit jamais bloquer DP2.

### Vision / IA générative

La vision peut servir de contrôle ou de classification. Elle n'est pas une source métrique officielle pour DP2. L'IA générative reste réservée aux pièces où un rendu visuel est réellement utile, notamment l'insertion paysagère.

## Règle de promotion obligatoire

Le K-par-K est un laboratoire, pas l'architecture finale. Toute règle découverte pendant la validation d'une pièce doit être classée avant gel de la pièce :

- **document-specific** : rendu, légende, composition ou données propres à DP1/DP2/etc. ;
- **engine-level** : parcelle, géométrie, obstacle, métrique, layout, projection, contrôle qualité ; elle doit être extraite dans une brique commune.

Une pièce ne peut pas être déclarée validée si elle contient encore une copie privée d'une règle engine-level déjà nécessaire ailleurs.

## Briques communes actuelles

- `context/officialParcel.ts` : adresse → parcelle IGN → géométrie vectorielle APICARTO ;
- `context/ignRaster.ts` : accès WMS IGN et fallbacks ;
- `site-model/manualRoofDesigner.ts` : pan revu → géométrie métrique + keepouts ;
- `geometry/projectLayout.ts` : calepinage déterministe ;
- `geometry/panelProjection.ts` : projection homographique ;
- `site-model/siteModelEngine.ts` : expérimentation automatique, hors chemin critique DP2 ;
- `site-model/lidarAltimetry.ts` et `site-model/roofGeometryEngine.ts` : fournisseurs automatiques expérimentaux et optionnels.

## DP1 — Plan de situation

DP1 doit :

- récupérer la géométrie cadastrale officielle ;
- dessiner le contour réel de la parcelle ;
- conserver adresse, référence cadastrale, nord et source ;
- ne jamais inventer de contour ;
- être confirmé sur plusieurs parcelles réelles.

## DP2 — Plan de masse

DP2 suit désormais un flux fiable et simple :

`adresse → parcelle officielle → orthophoto IGN métrée → Roof Designer → keepouts → Layout Engine → projection → DP2`

Contraintes :

- aucune photo utilisateur obligatoire ;
- aucun OpenAI requis ;
- aucun LiDAR requis ;
- le pan doit être explicitement validé ;
- la pente doit être connue/validée ;
- les obstacles doivent être tracés ou l'absence d'obstacle explicitement confirmée ;
- le Layout Engine ne peut jamais placer un module hors du pan ou dans un keepout ;
- la DP2 finale utilise un cadrage plus large montrant la maison et les parcelles environnantes ;
- un simple point repère l'accès/adresse du projet.

## Stratégie d'automatisation future

L'automatisation complète reviendra **au-dessus** du Roof Designer, jamais à sa place :

1. Google Solar API / LiDAR / autre fournisseur propose une géométrie ;
2. PilotPaper affiche cette proposition ;
3. l'utilisateur accepte ou corrige en quelques secondes ;
4. le modèle validé devient la source unique des DP.

Ainsi, une panne fournisseur ou une maison difficile n'empêche jamais l'utilisateur de terminer le dossier.

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
