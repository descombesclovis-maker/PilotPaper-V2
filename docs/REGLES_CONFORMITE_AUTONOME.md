# Règles de génération autonome DP-AI-FIRST v0.4.3

1. Le nombre de modules demandé par l'utilisateur est invariant.
2. Les dimensions fabricant du module sont obligatoires et invariantes.
3. Un calepinage fixe (ex. 2×6) est conservé s'il tient réellement.
4. Le recul gouttière de 300 mm est préféré, puis réduit si nécessaire avant rejet.
5. Aucun module ne peut franchir un faîtage, arêtier, rive ou limite réelle de pan.
6. Si un pan ne suffit pas et que la répartition est autorisée, seul le surplus est envoyé sur les autres pans.
7. En mode pan prioritaire, le pan choisi est rempli en premier.
8. Les obstacles réels détectés sont des zones d'exclusion ; ils ne peuvent pas être effacés pour faire tenir le champ.
9. Les nervures de bac acier ne sont pas des faîtages.
10. Une toiture monopente, terrasse, carport ou ombrière ne reçoit pas de faîtage inventé.
11. DP2, DP4, DP5 et DP6 partagent exactement la même allocation photovoltaïque canonique.
12. DP7 et DP8 conservent les photographies réelles proche et lointaine ; le moteur ne fabrique pas un environnement de remplacement.
13. GPT Image ne décide jamais de la position des panneaux. Les polygones de modules calculés sont autoritaires.
14. Les pixels hors îlots panneaux/halo minimal sont repris de la photographie originale.
15. Une sortie géométriquement correcte mais visuellement CGI/sticker est rejetée.
16. La qualité photographique locale (netteté, bruit, exposition, balance des blancs, ombres, reflets) doit être cohérente avec la photo source.
17. Les pièces visuelles sont régénérées automatiquement après rejet jusqu'à la limite configurée.
18. Les corrections issues des tests doivent être universelles : aucune exception par adresse, maison, image ou dossier n'est autorisée.
19. Le PDF n'est enregistré que si les contrôles structurels finaux passent.
20. PilotPaper ne prétend pas remplacer l'instruction administrative locale ou une décision d'autorité patrimoniale.
