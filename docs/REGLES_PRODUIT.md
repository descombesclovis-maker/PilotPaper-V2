# Règles produit obligatoires

La politique exécutable et la matrice DP1 à DP8 sont versionnées dans `docs/REGLES_CONFORMITE_AUTONOME.md`. Toute divergence est résolue en faveur de la règle la plus bloquante.

## 1. Fiabilité documentaire

- DP1 à DP8 doivent être réalisables lorsque la configuration les exige.
- Chaque pièce est évaluée indépendamment.
- Les plans doivent être de qualité architecturale : géométrie exacte, cotes, échelle, nord, légende, sources, implantation, obstacles et cohérence avant/après.
- Les valeurs critiques proviennent de preuves identifiées : source officielle, mesure, photographie originale, document fabricant ou validation humaine qualifiée.
- L’accord de plusieurs modèles IA n’est pas une preuve.
- L’IA peut analyser, proposer et signaler. Les contrôles géométriques, réglementaires et électriques déterministes décident si la pièce franchit son verrou.
- Une prévisualisation de travail doit être marquée comme telle. Aucun export final n’est créé tant que tous les verrous applicables ne sont pas levés.
- La chaîne finale est obligatoirement : génération de travail, préflight déterministe, audit visuel local, contre-audit par un second modèle, postflight PDF. Une erreur relance uniquement les étapes qui peuvent réellement la corriger ; une donnée source absente bloque le dossier au lieu de provoquer une boucle fictive.
- Une tentative échouée ne laisse aucun PDF final dans le stockage. Le dossier reste à l’état bloqué avec la liste des preuves ou corrections attendues.
- Le nombre de tentatives automatiques est borné. Une boucle infinie ne rend pas un résultat plus conforme et peut masquer une absence de preuve.
- Le logiciel ne promet jamais une décision future de la mairie ni un visa du CONSUEL.
- Aucun corpus d'entraînement ne peut contenir une DP web non licenciée, non anonymisée, non rattachée à une décision positive ou non revue par une personne qualifiée.
- Le moindre faux positif bloquant sur le jeu de contrôle indépendant interdit la spécialisation des poids et le déploiement du modèle candidat.

## 2. Saisie minimale

Avant d’ajouter un champ utilisateur :

1. vérifier s’il influence réellement une obligation, un calcul, une pièce ou un contrôle ;
2. chercher s’il existe déjà dans le dossier ;
3. chercher une source automatique officielle ou fabricant ;
4. vérifier s’il peut être extrait d’un document ou d’une image avec un seuil de confiance mesuré ;
5. préférer une confirmation simple à une saisie complète ;
6. supprimer le champ si l’absence de la donnée ne bloque aucun résultat.

Décisions possibles :

- inutile : supprimer ;
- automatique et fiable : préremplir ;
- automatique mais incertain : proposer et demander confirmation ;
- indispensable et introuvable : poser uniquement cette question ;
- contradictoire : bloquer l’export jusqu’à résolution.

Une donnée déjà fournie ne doit jamais être redemandée.

## 3. Priorités

1. Fiabilité, conformité et traçabilité.
2. Automatisation vérifiable et réduction des saisies.
3. Simplicité du parcours.
4. Esthétique, animations et effets 3D.

Une priorité inférieure ne peut jamais affaiblir une priorité supérieure.
