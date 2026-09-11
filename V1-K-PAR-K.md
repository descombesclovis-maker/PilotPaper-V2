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
- aucune auto-mise-à-jour pendant les tests V1 ;
- dossier d'installation isolé : `%LOCALAPPDATA%\PilotPaper\V1`.
