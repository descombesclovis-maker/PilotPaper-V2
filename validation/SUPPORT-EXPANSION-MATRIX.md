# PilotPaper - matrice d'extension du moteur d'insertion

Règle de publication : aucune famille de chantier ne devient générable parce qu'elle est simplement prise en charge par le schéma. Elle doit franchir le même protocole que la DP6 toiture.

| Famille | État | Preuve réelle requise | Benchmark requis | Garde géométrique |
|---|---|---:|---:|---|
| Toiture inclinée / toiture existante | VALIDÉE AU JALON DP6 V2 | >= 95 % | >= 95 % | pan vérifié + égout + cotes |
| Toiture plate | BLOQUÉE | >= 95 % | >= 95 % | plan de toit + acrotère + inclinaison châssis |
| Carport | BLOQUÉ | >= 95 % | >= 95 % | plan supérieur + poteaux/poutres + cotes |
| Ombrière | BLOQUÉE | >= 95 % | >= 95 % | plan supérieur + structure + cotes |
| Installation au sol | BLOQUÉE | >= 95 % | >= 95 % | terrain + rangées 3D + recul/hauteur |
| Façade | BLOQUÉE | >= 95 % | >= 95 % | plan de façade + horizontales/verticales + cotes |
| Multi-zones | BLOQUÉE | >= 95 % par zone | >= 95 % | masque et homographie indépendants par zone |

## Contrôles communs obligatoires

1. Géométrie/cotes provenant de preuves vérifiées et non d'une estimation visuelle isolée.
2. Perspective projetée depuis des repères physiques communs ou une géométrie 3D vérifiée.
3. Nombre exact de modules et calepinage exact.
4. Modification limitée à la zone autorisée pour la famille de chantier.
5. Éclairage, ombres, texture, occultations et contours contrôlés indépendamment.
6. Score visuel final >= 95 %.
7. Tout échec bloque l'export au lieu d'être corrigé silencieusement.
