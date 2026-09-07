# PilotPaper — politique de correction universelle

Toute anomalie découverte pendant un test doit être corrigée au niveau d'une **classe générale d'erreur**.

Interdit : ajouter une exception fondée sur une adresse, une photo, un identifiant de dossier, une maison précise ou un chantier de benchmark.

Exemples de règles universelles autorisées :
- franchissement de faîtage ou de limite de pan ;
- ratio physique d'un module non respecté ;
- nombre/rangées/colonnes différents du formulaire ;
- obstacle réel recouvert ;
- mauvaise allocation multi-pans ;
- recul gouttière mal optimisé ;
- modification de pixels hors îlots panneaux ;
- perspective incohérente ;
- effet CGI/sticker, lumière, bruit ou netteté incompatibles avec la photo ;
- incohérence entre DP2, DP4, DP5 et DP6.

Chaque nouvelle règle doit être couverte par un test de régression générique avant intégration.
