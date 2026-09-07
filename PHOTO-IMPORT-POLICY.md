# Politique d’import photo — PilotPaper v0.4.3

Principe : accepter la photographie tant que son utilisation ne compromet pas la fiabilité de la génération.

- Aucun rejet basé uniquement sur le poids du fichier original.
- Sélecteur : tout format image proposé par le navigateur, y compris extensions HEIC/HEIF/AVIF/WebP/BMP/GIF/TIFF lorsque le poste sait les décoder.
- Orientation EXIF respectée.
- Aucun recadrage automatique.
- Aucun upscale artificiel.
- Normalisation PNG automatique pour l’édition GPT Image avec masque strict.
- Réduction progressive de résolution uniquement si nécessaire pour le transfert.
- Ratio d’origine toujours conservé.
- Blocage précoce uniquement si l’image est indécodable ou si sa résolution native est manifestement trop faible pour un contrôle fiable.
- Après import, le moteur IA reste autorisé à rejeter une photo dont le contenu ne démontre pas assez clairement le pan, les obstacles ou l’environnement requis pour DP6/DP7/DP8.
