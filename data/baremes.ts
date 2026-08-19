// COPIE — source de vérité : Paprika92/microcotiz src/core/baremes.ts
// Commit source : 2e3e789 — copié le 2026-08-19
// INTERDIT de modifier une valeur fiscale ici. Resync depuis l'app uniquement.

/**
 * baremes.ts — Barèmes micro-entrepreneur (France)
 * ------------------------------------------------
 * Source de vérité UNIQUE pour tous les taux et seuils.
 * Structuré par PÉRIODE D'APPLICATION (pas par année) car les taux
 * peuvent changer en cours d'année (ex: BNC au 01/07/2024, ACRE au 01/07/2026).
 *
 * Sources (vérifiées août 2026) :
 * - urssaf.fr — Évolution des taux de cotisations des auto-entrepreneurs
 * - Décret n°2025-943 du 8 septembre 2025 (BNC 25,6 % au lieu de 26,1 %)
 * - service-public.fr — seuils micro et franchise en base de TVA
 * - entreprendre.service-public.gouv.fr (actualité A18813, fiche F23267) :
 *   plafonds micro revalorisés pour 2026-2028 (revalorisation triennale) —
 *   ventes 203 100 €, prestations/BNC 83 600 €. Les périodes 2025 gardent
 *   188 700 / 77 700 (valeurs en vigueur à l'époque, calculs passés).
 *
 * ⚠️ À re-vérifier à chaque loi de finances (décembre/janvier).
 * ⚠️ Taxes consulaires : taux métropole standard. Alsace-Moselle = taux
 *    majorés non gérés ici (hors périmètre v1, à documenter dans l'app).
 */

export type Activite =
  | 'vente_bic'            // Achat-revente, vente de denrées, hébergement (hors meublé classé)
  | 'presta_bic_commerciale'
  | 'presta_bic_artisanale'
  | 'liberal_bnc'          // Professions libérales non réglementées (SSI / régime général)
  | 'liberal_cipav'        // Professions libérales réglementées affiliées Cipav
  | 'meuble_tourisme_classe';

export interface TauxActivite {
  /** Cotisations sociales URSSAF (part principale) */
  cotisationsSociales: number;
  /** Contribution à la Formation Professionnelle */
  cfp: number;
  /** Taxe pour frais de chambre consulaire (CCI ou CMA), métropole standard */
  taxeConsulaire: number;
  /** Taux additionnel si option versement libératoire de l'IR */
  versementLiberatoire: number;
  /** Abattement forfaitaire IR (si PAS de versement libératoire) */
  abattementIR: number;
}

export interface PeriodeBareme {
  /** Inclus, format ISO YYYY-MM-DD */
  debut: string;
  /** Inclus. null = toujours en vigueur */
  fin: string | null;
  taux: Record<Activite, TauxActivite>;
  /** Part des cotisations sociales exonérée avec ACRE (0.5 = -50 %) */
  acreExoneration: number;
  seuils: {
    /** Plafond micro — ventes (CA HT annuel) */
    microVente: number;
    /** Plafond micro — prestations de services et BNC */
    microPresta: number;
    /** Franchise en base de TVA — ventes : seuil de base */
    tvaVenteBase: number;
    /** Franchise en base de TVA — ventes : seuil majoré (tolérance) */
    tvaVenteMajore: number;
    /** Franchise en base de TVA — services : seuil de base */
    tvaPrestaBase: number;
    /** Franchise en base de TVA — services : seuil majoré (tolérance) */
    tvaPrestaMajore: number;
  };
}

/** Ordre chronologique obligatoire, sans chevauchement. */
export const BAREMES: PeriodeBareme[] = [
  // ————————————————— 2025 —————————————————
  {
    debut: '2025-01-01',
    fin: '2025-12-31',
    acreExoneration: 0.5,
    taux: {
      vente_bic: {
        cotisationsSociales: 0.123,
        cfp: 0.001,
        taxeConsulaire: 0.00015, // CCI vente
        versementLiberatoire: 0.01,
        abattementIR: 0.71,
      },
      presta_bic_commerciale: {
        cotisationsSociales: 0.212,
        cfp: 0.001,
        taxeConsulaire: 0.00044, // CCI prestations
        versementLiberatoire: 0.017,
        abattementIR: 0.5,
      },
      presta_bic_artisanale: {
        cotisationsSociales: 0.212,
        cfp: 0.003,
        taxeConsulaire: 0.0048, // CMA prestations artisanales
        versementLiberatoire: 0.017,
        abattementIR: 0.5,
      },
      liberal_bnc: {
        cotisationsSociales: 0.246, // palier 2025 de la réforme BNC
        cfp: 0.002,
        taxeConsulaire: 0,
        versementLiberatoire: 0.022,
        abattementIR: 0.34,
      },
      liberal_cipav: {
        cotisationsSociales: 0.232,
        cfp: 0.002,
        taxeConsulaire: 0,
        versementLiberatoire: 0.022,
        abattementIR: 0.34,
      },
      meuble_tourisme_classe: {
        cotisationsSociales: 0.06,
        cfp: 0.001,
        taxeConsulaire: 0.00015,
        versementLiberatoire: 0.01,
        abattementIR: 0.71,
      },
    },
    seuils: {
      microVente: 188_700,
      microPresta: 77_700,
      tvaVenteBase: 85_000,
      tvaVenteMajore: 93_500,
      tvaPrestaBase: 37_500,
      tvaPrestaMajore: 41_250,
    },
  },

  // ——————————— 01/01/2026 → 30/06/2026 (ACRE encore à 50 %) ———————————
  {
    debut: '2026-01-01',
    fin: '2026-06-30',
    acreExoneration: 0.5,
    taux: {
      vente_bic: {
        cotisationsSociales: 0.123,
        cfp: 0.001,
        taxeConsulaire: 0.00015,
        versementLiberatoire: 0.01,
        abattementIR: 0.71,
      },
      presta_bic_commerciale: {
        cotisationsSociales: 0.212,
        cfp: 0.001,
        taxeConsulaire: 0.00044,
        versementLiberatoire: 0.017,
        abattementIR: 0.5,
      },
      presta_bic_artisanale: {
        cotisationsSociales: 0.212,
        cfp: 0.003,
        taxeConsulaire: 0.0048,
        versementLiberatoire: 0.017,
        abattementIR: 0.5,
      },
      liberal_bnc: {
        cotisationsSociales: 0.256, // décret 2025-943 : 25,6 % (et non 26,1 %)
        cfp: 0.002,
        taxeConsulaire: 0,
        versementLiberatoire: 0.022,
        abattementIR: 0.34,
      },
      liberal_cipav: {
        cotisationsSociales: 0.232,
        cfp: 0.002,
        taxeConsulaire: 0,
        versementLiberatoire: 0.022,
        abattementIR: 0.34,
      },
      meuble_tourisme_classe: {
        cotisationsSociales: 0.06,
        cfp: 0.001,
        taxeConsulaire: 0.00015,
        versementLiberatoire: 0.01,
        abattementIR: 0.71,
      },
    },
    seuils: {
      // Revalorisation triennale 2026-2028 (entreprendre.service-public.gouv.fr, A18813 / F23267)
      microVente: 203_100,
      microPresta: 83_600,
      tvaVenteBase: 85_000,
      tvaVenteMajore: 93_500,
      tvaPrestaBase: 37_500,
      tvaPrestaMajore: 41_250,
    },
  },

  // ——————————— depuis le 01/07/2026 (ACRE ramenée à 25 %) ———————————
  {
    debut: '2026-07-01',
    fin: null,
    acreExoneration: 0.25,
    taux: {
      vente_bic: {
        cotisationsSociales: 0.123,
        cfp: 0.001,
        taxeConsulaire: 0.00015,
        versementLiberatoire: 0.01,
        abattementIR: 0.71,
      },
      presta_bic_commerciale: {
        cotisationsSociales: 0.212,
        cfp: 0.001,
        taxeConsulaire: 0.00044,
        versementLiberatoire: 0.017,
        abattementIR: 0.5,
      },
      presta_bic_artisanale: {
        cotisationsSociales: 0.212,
        cfp: 0.003,
        taxeConsulaire: 0.0048,
        versementLiberatoire: 0.017,
        abattementIR: 0.5,
      },
      liberal_bnc: {
        cotisationsSociales: 0.256,
        cfp: 0.002,
        taxeConsulaire: 0,
        versementLiberatoire: 0.022,
        abattementIR: 0.34,
      },
      liberal_cipav: {
        cotisationsSociales: 0.232,
        cfp: 0.002,
        taxeConsulaire: 0,
        versementLiberatoire: 0.022,
        abattementIR: 0.34,
      },
      meuble_tourisme_classe: {
        cotisationsSociales: 0.06,
        cfp: 0.001,
        taxeConsulaire: 0.00015,
        versementLiberatoire: 0.01,
        abattementIR: 0.71,
      },
    },
    seuils: {
      // Revalorisation triennale 2026-2028 (entreprendre.service-public.gouv.fr, A18813 / F23267)
      microVente: 203_100,
      microPresta: 83_600,
      tvaVenteBase: 85_000,
      tvaVenteMajore: 93_500,
      tvaPrestaBase: 37_500,
      tvaPrestaMajore: 41_250,
    },
  },
];
