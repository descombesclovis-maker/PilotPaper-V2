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

`Roof Understanding Engine → PV Layout Engine → Projection Engine → Photorealistic Render Engine → PilotPaper Inspector → Régression`

Le calepinage et les dimensions restent déterministes. L'IA générative n'est utilisée que pour l'intégration visuelle lorsque la pièce l'exige.

## Critères de validation actuellement ouverts

### DP1 — Plan de situation

La DP1 actuelle localise correctement le terrain. Avant de la figer comme validée, PilotPaper doit aussi :

- récupérer la géométrie cadastrale officielle de la parcelle concernée ;
- dessiner son **contour réel** sur la vue de situation ;
- mettre en évidence uniquement la parcelle correspondant au projet ;
- conserver adresse, référence cadastrale, nord et source officielle ;
- ne jamais introduire de contour inventé si la géométrie officielle n'est pas disponible.

Cette amélioration doit fonctionner génériquement sur les parcelles françaises supportées, sans règle liée à une adresse de test.

### DP2 — Plan de masse

La DP2 doit utiliser le moteur réel, et notamment :

- la clé OpenAI locale doit être accessible au runtime Cloudflare/Vite ;
- le Roof Understanding Engine doit analyser la vue toiture réellement fournie ;
- aucun fallback silencieux ne doit remplacer l'analyse OpenAI quand elle est requise ;
- toute absence de clé ou indisponibilité fournisseur doit produire un blocage explicite et traçable ;
- la correction doit être générique pour toutes les installations locales PilotPaper.

## Mode de sécurité

Toute sortie de cet atelier porte le statut `test_unverified`.

- `DP_TEST_EXPORT=true`
- `DP_TEST_FAST=false`
- QA complète active
- aucune sortie V1 K-par-K ne peut devenir `verified`

Le passage en mode production/export strict est une opération distincte effectuée uniquement au jalon de livraison prévu.

## Application locale

- une seule instance Windows ;
- une seule fenêtre WebView2 ;
- moteur local sur `127.0.0.1:5174` ;
- aucune ouverture automatique dans le navigateur ;
- aucune mise à jour silencieuse au démarrage ;
- un bouton **Mettre à jour PilotPaper** vérifie volontairement la dernière V1 publiée ;
- le bouton compare l'identité de build installée à la release publiée ;
- l'installeur téléchargé est vérifié par SHA-256 avant exécution ;
- dossier d'installation isolé : `%LOCALAPPDATA%\PilotPaper\V1`.
