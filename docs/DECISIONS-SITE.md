# Journal de décisions — microcotiz-site

## 2026-08-19 — Simulateur cotisations v1 sans barème IR progressif

**Décision.** Le simulateur v1 couvre les cotisations sociales et la comparaison avec le versement libératoire uniquement. Pas de calcul d'impôt sur le revenu au barème progressif.

**Pourquoi.** Le barème IR n'existe pas dans les données de l'app (`baremes.ts` ne contient que taux de cotisations, versement libératoire, abattements et seuils). L'ajouter serait une nouvelle donnée fiscale à vérifier et maintenir à chaque loi de finances. Ajout différé après preuve de trafic sur le simulateur.

**Écarté.** Calcul IR complet en v1.

## 2026-08-19 — Direction design : glass sur fond clair vert-de-gris

**Décision.** Cartes translucides avec `backdrop-filter`, sur fond clair vert-de-gris. Tokens typo repris de l'app : Plus Jakarta Sans (texte) + JetBrains Mono (chiffres). CSS pur, sans lib.

**Écart assumé.** La règle « aucun flou/dégradé » du DESIGN.md de l'app vaut pour les écrans de l'app, pas pour le site. Le site assume une direction glass distincte.
