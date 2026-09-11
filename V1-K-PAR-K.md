# PilotPaper V1 — validation K-par-K

Cette branche est un **banc de validation local**. Elle ne remplace pas la feuille de route universelle de PilotPaper ; elle sert à la sécuriser avant V2.

## Règle de travail

1. Tester DP1 séparément sur plusieurs cas réels.
2. Corriger uniquement par règles générales + tests de régression.
3. Figer DP1 lorsque les cas V1 passent.
4. Répéter exactement la même méthode pour DP2, DP3, DP4, DP5, DP6, DP7 puis DP8.
5. Rejouer le corpus V1 complet après toute correction du moteur.
6. Lorsque DP1 à DP8 sont validées individuellement, figer/taguer V1.
7. Reconstituer ensuite le parcours automatique complet pour V2.

## Architecture non négociable

`Official Parcel Context → Cross-View Surface Identity → Roof/Surface Understanding → SurfaceSupport → PV Layout Engine → Projection Engine → Photorealistic Render Engine → PilotPaper Inspector → Régression`

Le calepinage et les dimensions restent déterministes. L'IA générative n'est utilisée que pour l'intégration visuelle lorsque la pièce l'exige.

### Règle de promotion obligatoire

Le K-par-K est un laboratoire, pas l'architecture finale. Toute règle découverte pendant la validation d'une pièce doit être classée avant gel de la pièce :

- **document-specific** : rendu, légende, composition ou données propres à DP1/DP2/etc. ; elle reste dans le moteur de la pièce ;
- **engine-level** : parcelle, identité bâtiment/pan, géométrie, obstacle, métrique, layout, projection, contrôle qualité ; elle doit être extraite dans une brique commune avant de figer la pièce.

Une pièce ne peut pas être déclarée validée si elle contient encore une copie privée d'une règle engine-level déjà nécessaire ailleurs.

### Briques communes déjà promues pendant DP1/DP2

- `context/officialParcel.ts` : adresse → parcelle IGN → géométrie vectorielle APICARTO ;
- `context/ignRaster.ts` : accès WMS IGN, couches séparées et fallbacks ;
- `identity/crossViewSurfaceIdentity.ts` : même bâtiment / même surface entre vue métrique et photo réelle, avec réconciliation fail-closed ;
- `geometry/metricSurfaceFromIdentity.ts` : conversion de l'identité prouvée en géométrie métrique et reprojection des obstacles ;
- `geometry/projectLayout.ts` : calepinage déterministe ;
- `geometry/panelProjection.ts` : projection homographique.

DP1 et DP2 doivent consommer ces briques au lieu de réimplémenter leur propre vérité cadastrale ou géométrique.

## Critères de validation actuellement ouverts

### DP1 — Plan de situation

La DP1 actuelle localise correctement le terrain. Avant de la figer comme validée, PilotPaper doit aussi :

- récupérer la géométrie cadastrale officielle de la parcelle concernée ;
- dessiner son **contour réel** sur la vue de situation ;
- mettre en évidence uniquement la parcelle correspondant au projet ;
- conserver adresse, référence cadastrale, nord et source officielle ;
- ne jamais introduire de contour inventé si la géométrie officielle n'est pas disponible ;
- confirmer le rendu sur plusieurs parcelles réelles différentes.

### DP2 — Plan de masse

La DP2 doit utiliser le moteur réel, et notamment :

- la clé OpenAI locale doit être accessible au runtime Cloudflare/Vite ;
- une seule vue toiture utilisateur doit suffire au parcours isolé DP2 lorsque la preuve IGN/cadastrale est disponible ;
- la parcelle officielle doit être résolue **avant** l'identité de toiture ;
- le même bâtiment et le même pan physique doivent être démontrés entre IGN et photo avant le Layout Engine ;
- l'identité doit être étayée par plusieurs indices indépendants et non par un simple ID A/B/C produit par le modèle ;
- les obstacles visibles doivent rester des exclusions métriques ;
- aucun fallback silencieux ne doit remplacer l'analyse OpenAI quand elle est requise ;
- toute absence de clé ou indisponibilité fournisseur doit produire un blocage explicite et traçable ;
- une correction n'est validée qu'après réussite sur plusieurs maisons V1 simples, pas sur une seule adresse.

## Critère de changement de stratégie

Le prochain cycle réel DP2 sert de verdict à l'architecture actuelle.

On **ne change pas de stratégie** pour une erreur locale clairement diagnostiquée et couverte par une règle générale.

On **change de stratégie** si, après la nouvelle chaîne `parcelle → identité cross-view → métrique → layout`, plusieurs cas V1 simples et exploitables échouent encore au même stade sans gain mesurable, ou si le moteur exige de plus en plus de correctifs spécifiques pour reconnaître un bâtiment/pan évident.

Dans ce cas, on arrête les patchs du pipeline actuel et on réévalue le Roof Understanding Engine lui-même (modèle, découpage en étapes, sources géométriques et stratégie de calibration) avant de poursuivre DP3.

## Gel des sujets périphériques

Jusqu'à validation DP1/DP2 et progression K-par-K :

- aucune amélioration esthétique du launcher ;
- aucune nouvelle fonction updater ;
- aucun travail de packaging sauf si le build/test local est bloqué ;
- aucune refonte UI sans impact direct sur la validation des pièces.

La priorité est le moteur.

## Mode de sécurité

Toute sortie de cet atelier porte le statut `test_unverified`.

- `DP_TEST_EXPORT=true`
- `DP_TEST_FAST=false`
- QA complète active
- aucune sortie V1 K-par-K ne peut devenir `verified`

Le passage en mode production/export strict est une opération distincte effectuée uniquement au jalon de livraison prévu.

## Application locale

La couche locale est désormais considérée comme **suffisamment stable pour les tests** :

- une seule instance Windows ;
- une seule fenêtre WebView2 ;
- moteur local sur `127.0.0.1:5174` ;
- aucune ouverture automatique dans le navigateur ;
- aucune mise à jour silencieuse au démarrage ;
- un bouton **Mettre à jour PilotPaper** vérifie volontairement la dernière V1 publiée ;
- le bouton compare l'identité de build installée à la release publiée ;
- l'installeur téléchargé est vérifié par SHA-256 avant exécution ;
- dossier d'installation isolé : `%LOCALAPPDATA%\PilotPaper\V1`.
