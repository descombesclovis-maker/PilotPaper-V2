# PilotPaper DP-AI-FIRST v0.4.3 — état de validation

## Validé automatiquement
- 25 tests de régression du moteur : PASS.
- 5 000 répartitions aléatoires de pans couvertes par le stress-test.
- Calepinage fixe 2×6 conservé s'il tient réellement.
- Réduction dynamique du recul gouttière avant rejet.
- Répartition multi-pans déterministe du surplus.
- Faîtage / limites de pans infranchissables.
- Bac acier : nervures non interprétées comme faîtages.
- Toiture terrasse / carport : aucun faîtage inventé.
- Masque GPT Image : îlots exacts des modules.
- Recomposition stricte : pixels hors îlots repris de la photo source.
- Critères de photoréalisme séparés des critères géométriques.
- Cohérence croisée DP4 / DP6.
- DP7 / DP8 conservées comme photographies réelles.
- Analyse syntaxique de tous les fichiers TypeScript/TSX : 0 diagnostic de syntaxe.

## À valider chez l'utilisateur
Cet environnement n'avait pas d'accès sortant vers api.openai.com. Le premier vrai test GPT Image doit donc être réalisé sur votre PC connecté à Internet.

Commencez par une maison individuelle simple, toiture nette et trois photographies distinctes. Si une erreur apparaît, elle doit être transformée en règle de correction universelle avant de passer aux bâtiments complexes.
