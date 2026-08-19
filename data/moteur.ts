// COPIE — source de vérité : Paprika92/microcotiz src/core/moteur.ts
// Commit source : 2e3e789 — copié le 2026-08-19
// INTERDIT de modifier une valeur fiscale ici. Resync depuis l'app uniquement.

/**
 * moteur.ts — Moteur de calcul micro-entrepreneur
 * -----------------------------------------------
 * Module 100 % pur : aucune dépendance, aucun accès réseau/storage.
 * Toutes les fonctions prennent des données en entrée et rendent un résultat.
 * L'app (Zustand + SQLite) appelle ce module, jamais l'inverse.
 *
 * Convention : montants en euros (number), dates en ISO 'YYYY-MM-DD'.
 * Les arrondis sont faits UNIQUEMENT à l'affichage final (arrondiEuro),
 * jamais dans les calculs intermédiaires.
 */

import { BAREMES, type Activite, type PeriodeBareme } from './baremes';

// ————————————————————————————————————————————————————————————————
// Types
// ————————————————————————————————————————————————————————————————

/**
 * Mode de règlement d'un encaissement — mention exigée du livre des
 * recettes (distinction espèces / autres modes) : entreprendre.service-public.gouv.fr,
 * fiche F36018, vérifiée le 10/08/2026. Valeurs stockées en minuscules
 * sans accent.
 */
export type ModeReglement = 'virement' | 'cb' | 'especes' | 'cheque' | 'autre';

export interface Encaissement {
  id: string;
  /** Date d'ENCAISSEMENT (pas de facturation) — c'est elle qui compte en micro */
  date: string;
  montant: number;
  activite: Activite;
  note?: string;
  /** Identité du client (livre des recettes, F36018) — facultatif à la saisie */
  client?: string;
  /** Mode de règlement (livre des recettes, F36018) — facultatif à la saisie */
  modeReglement?: ModeReglement;
}

export interface ProfilFiscal {
  activites: Activite[];
  /** 'mensuelle' ou 'trimestrielle' */
  periodicite: 'mensuelle' | 'trimestrielle';
  versementLiberatoire: boolean;
  acre: boolean;
  /** Date de début d'activité (immatriculation), ISO */
  debutActivite: string;
  /**
   * Date d'installation de MicroCotiz, ISO — posée à la création du
   * profil (repli migration : date de la migration). Sert de borne aux
   * périodes « antérieures » : avant elle, l'app ne peut pas savoir si
   * une période a été déclarée. Optionnelle dans le type (fixtures,
   * anciens profils avant migration) ; la couche db/store la garantit.
   */
  installeLe?: string;
}

export interface DetailCotisations {
  base: number;
  cotisationsSociales: number;
  cfp: number;
  taxeConsulaire: number;
  versementLiberatoire: number;
  total: number;
  netEstime: number;
  /** true si l'ACRE a été appliquée sur au moins un encaissement */
  acreAppliquee: boolean;
}

export type StatutSeuil = 'ok' | 'attention' | 'tolerance' | 'depasse';

/**
 * Condition qui pilote le ratio (et donc le statut) d'une jauge.
 * En activité mixte, deux conditions s'appliquent simultanément
 * (CA global ≤ plafond vente ET part presta ≤ plafond presta,
 * source : service-public.fr, régime micro / franchise en base) ;
 * ce champ dit laquelle est la plus contraignante, pour que l'UI
 * puisse l'expliquer. À égalité de ratio, la condition globale l'emporte.
 */
export interface ConditionLimitante {
  source: 'global' | 'part_presta';
  /** CA comparé au seuil (global ou part presta selon la source) */
  montant: number;
  seuil: number;
}

export interface EtatSeuils {
  caVente: number;
  caPresta: number;
  caTotal: number;
  micro: {
    plafond: number;
    ratio: number; // 0..1+ (peut dépasser 1)
    statut: StatutSeuil;
    limitant: ConditionLimitante;
  };
  tva: {
    seuilBase: number;
    seuilMajore: number;
    ratio: number;
    statut: StatutSeuil;
    limitant: ConditionLimitante;
    /**
     * Seuil majoré de la MÊME assiette que `limitant` (vente : 93 500 €,
     * presta : 41 250 €). L'UI doit comparer et afficher le même couple :
     * un chip « TVA applicable » se justifie par CE seuil, pas par le base.
     * Source : service-public.fr, franchise en base de TVA.
     */
    seuilMajoreLimitant: number;
    /** Message d'explication prêt à afficher */
    message: string;
  };
}

export interface Echeance {
  type: 'urssaf' | 'cfe' | 'impots';
  label: string;
  /** Fin de la période couverte (pour l'URSSAF) */
  periodeFin?: string;
  /** Date limite indicative, ISO */
  dateLimite: string;
}

// ————————————————————————————————————————————————————————————————
// Utilitaires dates (pas de lib externe, pas de timezone : ISO string only)
// ————————————————————————————————————————————————————————————————

const cmp = (a: string, b: string): number => a.localeCompare(b);

export function arrondiEuro(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Retourne le barème applicable à une date donnée. Throw si aucune période. */
export function getBareme(date: string): PeriodeBareme {
  const p = BAREMES.find(
    (b) => cmp(date, b.debut) >= 0 && (b.fin === null || cmp(date, b.fin) <= 0)
  );
  if (!p) throw new Error(`Aucun barème pour la date ${date}`);
  return p;
}

/**
 * Fin d'éligibilité ACRE : fin du 3e trimestre civil suivant celui
 * du début d'activité. Ex : début le 12/05/2025 (T2) → éligible
 * jusqu'au 31/03/2026 (fin de T1 2026).
 */
export function finEligibiliteAcre(debutActivite: string): string {
  const [y, m] = debutActivite.split('-').map(Number);
  const trimestre = Math.ceil(m / 3); // 1..4
  // Fin du trimestre de début + 3 trimestres
  let finTrim = trimestre + 3; // trimestre absolu
  let annee = y;
  while (finTrim > 4) {
    finTrim -= 4;
    annee += 1;
  }
  const dernierMois = finTrim * 3; // 3, 6, 9, 12
  const dernierJour = [3, 12].includes(dernierMois) ? 31 : 30;
  return `${annee}-${String(dernierMois).padStart(2, '0')}-${dernierJour}`;
}

/**
 * Taux de cotisations sociales sous ACRE : taux plein × (1 − exonération).
 * SEULES les cotisations sociales sont exonérées — la CFP, la taxe
 * consulaire et le versement libératoire restent dus en entier (même
 * règle que calcCotisations, qui appelle ce helper).
 * Source : urssaf.fr, « L'Acre : l'aide pour les créateurs et repreneurs ».
 */
export function tauxSocialAcre(tauxPlein: number, exoneration: number): number {
  return tauxPlein * (1 - exoneration);
}

// ————————————————————————————————————————————————————————————————
// Cotisations
// ————————————————————————————————————————————————————————————————

/**
 * Calcule les cotisations dues sur un ensemble d'encaissements.
 * Chaque encaissement est taxé au barème EN VIGUEUR À SA DATE
 * (crucial : un CA de juin et un CA de décembre peuvent différer).
 */
export function calcCotisations(
  encaissements: Encaissement[],
  profil: ProfilFiscal
): DetailCotisations {
  const finAcre = finEligibiliteAcre(profil.debutActivite);
  let base = 0;
  let social = 0;
  let cfp = 0;
  let consulaire = 0;
  let vl = 0;
  let acreAppliquee = false;

  for (const e of encaissements) {
    const bareme = getBareme(e.date);
    const t = bareme.taux[e.activite];

    let tauxSocial = t.cotisationsSociales;
    if (profil.acre && cmp(e.date, finAcre) <= 0) {
      tauxSocial = tauxSocialAcre(tauxSocial, bareme.acreExoneration);
      acreAppliquee = true;
    }

    base += e.montant;
    social += e.montant * tauxSocial;
    cfp += e.montant * t.cfp;
    consulaire += e.montant * t.taxeConsulaire;
    if (profil.versementLiberatoire) {
      vl += e.montant * t.versementLiberatoire;
    }
  }

  const total = social + cfp + consulaire + vl;
  return {
    base: arrondiEuro(base),
    cotisationsSociales: arrondiEuro(social),
    cfp: arrondiEuro(cfp),
    taxeConsulaire: arrondiEuro(consulaire),
    versementLiberatoire: arrondiEuro(vl),
    total: arrondiEuro(total),
    netEstime: arrondiEuro(base - total),
    acreAppliquee,
  };
}

// ————————————————————————————————————————————————————————————————
// Seuils (micro + TVA)
// ————————————————————————————————————————————————————————————————

/** Famille d'assiette « vente » (le reste = prestations). Exporté :
 *  conseils.ts s'en sert pour la catégorie dominante d'un profil mixte. */
export const estVente = (a: Activite): boolean =>
  a === 'vente_bic' || a === 'meuble_tourisme_classe';

/**
 * Ventile un ensemble d'encaissements par famille d'assiette
 * (vente = vente_bic + meublé classé ; tout le reste = prestations).
 * SEULE implémentation de cette sommation : le store ne la réécrit pas.
 */
export function ventilationCa(encaissements: Encaissement[]): {
  caVente: number;
  caPresta: number;
} {
  let caVente = 0;
  let caPresta = 0;
  for (const e of encaissements) {
    if (estVente(e.activite)) caVente += e.montant;
    else caPresta += e.montant;
  }
  return { caVente: arrondiEuro(caVente), caPresta: arrondiEuro(caPresta) };
}

/**
 * Années civiles distinctes présentes dans les encaissements, triées de
 * la plus récente à la plus ancienne (sélecteur d'export du livre des
 * recettes : un document annuel ne doit contenir que son année).
 */
export function anneesAvecEncaissements(encaissements: Encaissement[]): number[] {
  return [...new Set(encaissements.map((e) => Number(e.date.slice(0, 4))))].sort(
    (a, b) => b - a
  );
}

/** Encaissements dont la date tombe dans l'année civile donnée. */
export function encaissementsDeLAnnee(
  encaissements: Encaissement[],
  annee: number
): Encaissement[] {
  return encaissements.filter((e) => Number(e.date.slice(0, 4)) === annee);
}

/**
 * État des jauges pour une année civile.
 * Règle mixte (vente + presta) :
 *  - micro : total ≤ plafond vente ET presta ≤ plafond presta
 *  - TVA   : total ≤ seuil vente ET presta ≤ seuil presta
 * Statuts : ok (<80 %), attention (80-100 %), tolerance (entre base et majoré), depasse.
 *
 * Classification vente/presta : d'après les encaissements de l'année ;
 * si l'année est vide, d'après les activités du profil (sinon un profil
 * vente verrait les seuils presta tant qu'il n'a rien encaissé).
 */
export function etatSeuils(
  encaissementsAnnee: Encaissement[],
  dateReference: string,
  activitesProfil: Activite[] = []
): EtatSeuils {
  const bareme = getBareme(dateReference);
  const s = bareme.seuils;

  const caVente = encaissementsAnnee
    .filter((e) => estVente(e.activite))
    .reduce((sum, e) => sum + e.montant, 0);
  const caPresta = encaissementsAnnee
    .filter((e) => !estVente(e.activite))
    .reduce((sum, e) => sum + e.montant, 0);
  const caTotal = caVente + caPresta;

  const activitesEffectives: Activite[] =
    caTotal > 0
      ? [...new Set(encaissementsAnnee.map((e) => e.activite))]
      : activitesProfil;
  const aVente = activitesEffectives.some(estVente);
  const aPresta = activitesEffectives.some((a) => !estVente(a));
  const mixte = aVente && aPresta;
  const queVente = aVente && !aPresta;

  const limitantEntre = (
    rGlobal: number,
    rPresta: number,
    seuilGlobal: number,
    seuilPresta: number
  ): ConditionLimitante =>
    // Strict : à égalité de ratio, la condition globale l'emporte
    rPresta > rGlobal
      ? { source: 'part_presta', montant: arrondiEuro(caPresta), seuil: seuilPresta }
      : { source: 'global', montant: arrondiEuro(caTotal), seuil: seuilGlobal };

  // ——— Plafond micro ———
  let plafondMicro: number;
  let ratioMicro: number;
  let limitantMicro: ConditionLimitante;
  if (mixte) {
    plafondMicro = s.microVente;
    ratioMicro = Math.max(caTotal / s.microVente, caPresta / s.microPresta);
    limitantMicro = limitantEntre(
      caTotal / s.microVente,
      caPresta / s.microPresta,
      s.microVente,
      s.microPresta
    );
  } else if (queVente) {
    plafondMicro = s.microVente;
    ratioMicro = caTotal / s.microVente;
    limitantMicro = { source: 'global', montant: arrondiEuro(caTotal), seuil: s.microVente };
  } else {
    plafondMicro = s.microPresta;
    ratioMicro = caTotal / s.microPresta;
    limitantMicro = { source: 'global', montant: arrondiEuro(caTotal), seuil: s.microPresta };
  }
  const statutMicro: StatutSeuil =
    ratioMicro > 1 ? 'depasse' : ratioMicro >= 0.8 ? 'attention' : 'ok';

  // ——— Franchise en base de TVA ———
  let seuilBase: number;
  let seuilMajore: number;
  let ratioTva: number;
  let statutTva: StatutSeuil;
  let limitantTva: ConditionLimitante;

  const statutPour = (ca: number, base: number, majore: number): StatutSeuil =>
    ca > majore ? 'depasse' : ca > base ? 'tolerance' : ca >= base * 0.8 ? 'attention' : 'ok';

  // Cohérence statut/limitant en mixte : statutTva est calculé sur les
  // seuils de base ET majorés, limitantTva sur les seuils de base seuls.
  // C'est équivalent uniquement parce que vente et presta partagent la
  // même tolérance de +10 % (93 500/85 000 = 41 250/37 500 = 1,10) : les
  // paliers de statut tombent aux mêmes ratios pour les deux familles.
  // Si ces marges divergent un jour dans baremes.ts, calculer le
  // limitant à partir des statuts, pas des ratios de base.
  if (mixte) {
    seuilBase = s.tvaVenteBase;
    seuilMajore = s.tvaVenteMajore;
    const stTotal = statutPour(caTotal, s.tvaVenteBase, s.tvaVenteMajore);
    const stPresta = statutPour(caPresta, s.tvaPrestaBase, s.tvaPrestaMajore);
    const ordre: StatutSeuil[] = ['ok', 'attention', 'tolerance', 'depasse'];
    statutTva = ordre[Math.max(ordre.indexOf(stTotal), ordre.indexOf(stPresta))];
    ratioTva = Math.max(caTotal / s.tvaVenteBase, caPresta / s.tvaPrestaBase);
    limitantTva = limitantEntre(
      caTotal / s.tvaVenteBase,
      caPresta / s.tvaPrestaBase,
      s.tvaVenteBase,
      s.tvaPrestaBase
    );
  } else if (queVente) {
    seuilBase = s.tvaVenteBase;
    seuilMajore = s.tvaVenteMajore;
    statutTva = statutPour(caTotal, seuilBase, seuilMajore);
    ratioTva = caTotal / seuilBase;
    limitantTva = { source: 'global', montant: arrondiEuro(caTotal), seuil: seuilBase };
  } else {
    seuilBase = s.tvaPrestaBase;
    seuilMajore = s.tvaPrestaMajore;
    statutTva = statutPour(caTotal, seuilBase, seuilMajore);
    ratioTva = caTotal / seuilBase;
    limitantTva = { source: 'global', montant: arrondiEuro(caTotal), seuil: seuilBase };
  }

  const messagesTva: Record<StatutSeuil, string> = {
    ok: 'Tu es en franchise en base : facturation sans TVA (art. 293 B du CGI).',
    attention:
      'Tu approches du seuil de franchise de TVA. Anticipe un éventuel passage à la TVA.',
    tolerance:
      'Seuil de base dépassé mais sous le seuil majoré : franchise maintenue jusqu’au 31 décembre, TVA applicable au 1er janvier suivant.',
    depasse:
      'Seuil majoré dépassé : la TVA s’applique dès le 1er jour du mois de dépassement. Facturez la TVA et demandez un n° de TVA intracommunautaire.',
  };

  return {
    caVente: arrondiEuro(caVente),
    caPresta: arrondiEuro(caPresta),
    caTotal: arrondiEuro(caTotal),
    micro: {
      plafond: plafondMicro,
      ratio: ratioMicro,
      statut: statutMicro,
      limitant: limitantMicro,
    },
    tva: {
      seuilBase,
      seuilMajore,
      ratio: ratioTva,
      statut: statutTva,
      limitant: limitantTva,
      // Majoré de l'assiette limitante. « global » désigne l'assiette
      // APPLICABLE (presta en profil presta pur, vente sinon) : c'est
      // `seuilMajore`, déjà résolu par branche, qui la porte — jamais un
      // remappage global→vente (régression corrigée le 27/07/2026).
      seuilMajoreLimitant:
        limitantTva.source === 'part_presta' ? s.tvaPrestaMajore : seuilMajore,
      message: messagesTva[statutTva],
    },
  };
}

// ————————————————————————————————————————————————————————————————
// Projection fin d'année
// ————————————————————————————————————————————————————————————————

/**
 * Projection linéaire du CA annuel : CA cumulé / jours écoulés × 365.
 * Volontairement simple et lisible ; l'app peut afficher "projection
 * indicative" — ne pas survendre la précision.
 */
export function projectionFinAnnee(
  encaissementsAnnee: Encaissement[],
  dateReference: string
): number {
  const annee = dateReference.slice(0, 4);
  const debut = new Date(`${annee}-01-01T00:00:00Z`).getTime();
  const ref = new Date(`${dateReference}T00:00:00Z`).getTime();
  const joursEcoules = Math.max(1, Math.floor((ref - debut) / 86_400_000) + 1);
  const ca = encaissementsAnnee.reduce((s, e) => s + e.montant, 0);
  return arrondiEuro((ca / joursEcoules) * 365);
}

// ————————————————————————————————————————————————————————————————
// Échéances
// ————————————————————————————————————————————————————————————————

/**
 * Prochaine échéance de déclaration URSSAF.
 * Règle : la déclaration d'une période est exigible à la fin du mois
 * suivant la période (mensuel : CA de mars → 30 avril ;
 * trimestriel : T1 → 30 avril, T2 → 31 juillet, T3 → 31 octobre, T4 → 31 janvier).
 */
export function prochaineDeclarationUrssaf(
  periodicite: 'mensuelle' | 'trimestrielle',
  dateReference: string
): Echeance {
  const [y, m] = dateReference.split('-').map(Number);
  const finMois = (yy: number, mm: number): string => {
    const d = new Date(Date.UTC(yy, mm, 0)); // jour 0 du mois suivant = dernier jour
    return d.toISOString().slice(0, 10);
  };

  if (periodicite === 'mensuelle') {
    // Période en cours de déclaration : le mois précédent
    const perM = m === 1 ? 12 : m - 1;
    const perY = m === 1 ? y - 1 : y;
    return {
      type: 'urssaf',
      label: `Déclaration URSSAF — CA de ${String(perM).padStart(2, '0')}/${perY}`,
      periodeFin: finMois(perY, perM),
      dateLimite: finMois(y, m),
    };
  }

  // Trimestriel : trouver la prochaine date limite (31/01, 30/04, 31/07, 31/10)
  const limites = [
    { mois: 1, trim: 'T4', anneeTrim: y - 1 },
    { mois: 4, trim: 'T1', anneeTrim: y },
    { mois: 7, trim: 'T2', anneeTrim: y },
    { mois: 10, trim: 'T3', anneeTrim: y },
    { mois: 13, trim: 'T4', anneeTrim: y }, // janvier année suivante
  ];
  for (const l of limites) {
    const yy = l.mois === 13 ? y + 1 : y;
    const mm = l.mois === 13 ? 1 : l.mois;
    const limite = finMois(yy, mm);
    if (cmp(dateReference, limite) <= 0) {
      return {
        type: 'urssaf',
        label: `Déclaration URSSAF — ${l.trim} ${l.anneeTrim}`,
        dateLimite: limite,
      };
    }
  }
  /* istanbul ignore next */
  throw new Error('unreachable');
}

/**
 * Identifiant + bornes de la période couverte par la PROCHAINE déclaration.
 * Mensuel : le mois précédent ('2026-03'). Trimestriel : '2026-T1', etc.
 * (Déplacé depuis store.ts : fonction pure, testée ici.)
 */
export function periodeADeclarer(
  periodicite: ProfilFiscal['periodicite'],
  ref: string
): { id: string; debut: string; fin: string } {
  const [y, m] = ref.split('-').map(Number);
  const finMois = (yy: number, mm: number): string =>
    new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);

  if (periodicite === 'mensuelle') {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const mm = String(pm).padStart(2, '0');
    return { id: `${py}-${mm}`, debut: `${py}-${mm}-01`, fin: finMois(py, pm) };
  }

  const trimCourant = Math.ceil(m / 3);
  const trimPrec = trimCourant === 1 ? 4 : trimCourant - 1;
  const py = trimCourant === 1 ? y - 1 : y;
  const moisDebut = (trimPrec - 1) * 3 + 1;
  const moisFin = trimPrec * 3;
  return {
    id: `${py}-T${trimPrec}`,
    debut: `${py}-${String(moisDebut).padStart(2, '0')}-01`,
    fin: finMois(py, moisFin),
  };
}

/**
 * Première période NON déclarée à partir de `ref`, avec son échéance.
 * Itère d'échéance en échéance (période dérivée de la DATE LIMITE, pas
 * de la date du jour — trou d'août, cf. periodesARappeler) : libellé,
 * bornes et date limite sortent tous de la même période.
 * `horizon` borne l'itération : jamais de boucle infinie si tout est
 * déclaré — on retourne alors la dernière période sondée.
 */
export function prochaineNonDeclaree(
  periodicite: ProfilFiscal['periodicite'],
  ref: string,
  estDeclaree: (periodeId: string) => boolean,
  horizon = 8
): { echeance: Echeance; periode: { id: string; debut: string; fin: string } } {
  let refCourante = ref;
  let echeance = prochaineDeclarationUrssaf(periodicite, refCourante);
  let periode = periodeADeclarer(periodicite, echeance.dateLimite);
  for (let i = 0; i < horizon && estDeclaree(periode.id); i++) {
    const [y, m, d] = echeance.dateLimite.split('-').map(Number);
    refCourante = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    echeance = prochaineDeclarationUrssaf(periodicite, refCourante);
    periode = periodeADeclarer(periodicite, echeance.dateLimite);
  }
  return { echeance, periode };
}

export interface PeriodeEchue {
  periodeId: string;
  debut: string;
  fin: string;
  dateLimite: string;
  /** Jours écoulés depuis la date limite (≥ 1) */
  joursRetard: number;
  /**
   * true : l'échéance est tombée AVANT (ou le jour de) l'installation de
   * l'app — l'app ne peut pas savoir si la période a été déclarée, elle
   * ne l'affiche jamais en retard. Présent uniquement quand installeLe
   * est fourni dans les options.
   */
  anterieure?: boolean;
}

/**
 * [debut, fin] est-il ENTIÈREMENT couvert par l'union des intervalles ?
 * Les intervalles adjacents fusionnent (le lendemain de la fin de l'un
 * est le début de l'autre) : trois mois classés couvrent leur trimestre.
 * Sert au classement « déjà déclarée » : robuste au changement de
 * périodicité, la vérité est dans les bornes, jamais dans l'identifiant.
 */
export function estCouverte(
  debut: string,
  fin: string,
  intervalles: Array<{ debut: string; fin: string }>
): boolean {
  const lendemain = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };
  const tries = [...intervalles].sort((a, b) => cmp(a.debut, b.debut));
  let curseur = debut; // premier jour pas encore couvert
  for (const i of tries) {
    if (cmp(i.debut, curseur) > 0) break; // trou avant cet intervalle
    if (cmp(i.fin, curseur) >= 0) curseur = lendemain(i.fin);
    if (cmp(curseur, fin) > 0) return true;
  }
  return cmp(curseur, fin) > 0;
}

/**
 * Périodes CLOSES depuis le début d'activité dont l'échéance est passée
 * et qui ne sont pas déclarées — de la plus ancienne à la plus récente.
 * Complément de prochaineNonDeclaree (qui ne regarde que le futur) :
 * sans cette liste, une période échue non déclarée est invisible.
 * Première période = celle qui CONTIENT le début d'activité (jamais de
 * période antérieure). Fonction pure : le CA de chaque période se
 * calcule côté store (les encaissements sont en base).
 *
 * options.installeLe : pose le flag `anterieure` — dateLimite <= installeLe
 *   → antérieure (le jour de l'installation, l'app ne sait rien de la
 *   période écoulée ; en cas de doute, elle ne soupçonne pas).
 * options.classees : intervalles « déjà déclarée hors app » — une période
 *   entièrement couverte (estCouverte) est exclue au même titre qu'une
 *   période déclarée.
 */
export function periodesEchuesNonDeclarees(
  periodicite: ProfilFiscal['periodicite'],
  debutActivite: string,
  dateReference: string,
  estDeclaree: (periodeId: string) => boolean,
  options?: {
    installeLe?: string;
    classees?: Array<{ debut: string; fin: string }>;
  }
): PeriodeEchue[] {
  const finMois = (yy: number, mm: number): string =>
    new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const joursDepuis = (limite: string): number =>
    Math.round(
      (new Date(`${dateReference}T00:00:00Z`).getTime() -
        new Date(`${limite}T00:00:00Z`).getTime()) /
        86_400_000
    );

  const res: PeriodeEchue[] = [];
  const ajouter = (id: string, debut: string, fin: string, dateLimite: string) => {
    if (estDeclaree(id)) return;
    if (options?.classees && estCouverte(debut, fin, options.classees)) return;
    const entree: PeriodeEchue = {
      periodeId: id,
      debut,
      fin,
      dateLimite,
      joursRetard: joursDepuis(dateLimite),
    };
    if (options?.installeLe !== undefined) {
      entree.anterieure = cmp(dateLimite, options.installeLe) <= 0;
    }
    res.push(entree);
  };

  const [y0, m0] = debutActivite.split('-').map(Number);

  if (periodicite === 'mensuelle') {
    let y = y0;
    let m = m0;
    for (;;) {
      // Échéance : fin du mois suivant la période
      const dateLimite = finMois(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
      if (cmp(dateLimite, dateReference) >= 0) break;
      const mm = String(m).padStart(2, '0');
      ajouter(`${y}-${mm}`, `${y}-${mm}-01`, finMois(y, m), dateLimite);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return res;
  }

  let y = y0;
  let t = Math.ceil(m0 / 3); // trimestre contenant le début d'activité
  for (;;) {
    const moisFin = t * 3;
    const dateLimite = finMois(
      moisFin === 12 ? y + 1 : y,
      moisFin === 12 ? 1 : moisFin + 1
    );
    if (cmp(dateLimite, dateReference) >= 0) break;
    ajouter(
      `${y}-T${t}`,
      `${y}-${String((t - 1) * 3 + 1).padStart(2, '0')}-01`,
      finMois(y, moisFin),
      dateLimite
    );
    t += 1;
    if (t > 4) {
      t = 1;
      y += 1;
    }
  }
  return res;
}

/** Bornes civiles d'un identifiant de période (« 2026-T2 » | « 2026-06 »). */
export function bornesPeriode(periodeId: string): { debut: string; fin: string } {
  const finMois = (yy: number, mm: number): string =>
    new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const [annee, reste] = periodeId.split('-');
  const y = Number(annee);
  if (reste.startsWith('T')) {
    const t = Number(reste.slice(1));
    return {
      debut: `${annee}-${String((t - 1) * 3 + 1).padStart(2, '0')}-01`,
      fin: finMois(y, t * 3),
    };
  }
  return { debut: `${annee}-${reste}-01`, fin: finMois(y, Number(reste)) };
}

/**
 * Total des CA déclarés dont la PÉRIODE tombe dans les 12 derniers mois
 * glissants — jamais la date de dépôt : rattraper des années d'arriérés
 * aujourd'hui ne doit pas gonfler le total. Convention de borne : une
 * période est incluse EN TOTALITÉ si sa FIN est dans la fenêtre, exclue
 * sinon — pas de prorata, un CA déclaré est un fait atomique par
 * période (un prorata afficherait un montant jamais déclaré tel quel).
 */
export function totalDeclare12Mois(
  declarations: Array<{ periode: string; caDeclare: number }>,
  dateReference: string
): number {
  const seuil = new Date(`${dateReference}T00:00:00Z`);
  seuil.setUTCFullYear(seuil.getUTCFullYear() - 1);
  const cutoff = seuil.toISOString().slice(0, 10);
  return arrondiEuro(
    declarations
      .filter((d) => cmp(bornesPeriode(d.periode).fin, cutoff) >= 0)
      .reduce((t, d) => t + d.caDeclare, 0)
  );
}

export interface RappelEcheance {
  periodeId: string;
  /** Bornes de la période (pour calculer le CA à 0) */
  debut: string;
  fin: string;
  dateLimite: string;
}

/**
 * Les 2 prochaines échéances à rappeler, en EXCLUANT les périodes déjà
 * marquées déclarées (pas de « dernier jour demain » pour une
 * déclaration déjà faite).
 *
 * La période couverte par une échéance est dérivée de sa DATE LIMITE
 * (`periodeADeclarer(dateLimite)`), pas de la date du jour : entre deux
 * échéances (ex. août en trimestriel), `periodeADeclarer(aujourd'hui)`
 * renvoie encore la période fermée, ce qui faisait entrer deux fois la
 * même période — et les identifiants de notification identiques
 * s'écrasaient entre eux.
 */
export function periodesARappeler(
  periodicite: ProfilFiscal['periodicite'],
  ref: string,
  estDeclaree: (periodeId: string) => boolean
): RappelEcheance[] {
  const rappels: RappelEcheance[] = [];
  let refCourante = ref;

  for (let i = 0; i < 2; i++) {
    const e = prochaineDeclarationUrssaf(periodicite, refCourante);
    const p = periodeADeclarer(periodicite, e.dateLimite);
    if (!estDeclaree(p.id)) {
      rappels.push({ periodeId: p.id, debut: p.debut, fin: p.fin, dateLimite: e.dateLimite });
    }
    // Échéance suivante : lendemain de la date limite
    const [y, m, d] = e.dateLimite.split('-').map(Number);
    refCourante = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }

  return rappels;
}

/** Échéances fixes annuelles (indicatives). */
export function echeancesAnnuelles(annee: number): Echeance[] {
  return [
    {
      type: 'impots',
      label: 'Déclaration de revenus 2042-C-PRO (dates par zone, mai-juin)',
      dateLimite: `${annee}-05-31`,
    },
    {
      type: 'cfe',
      label: 'Paiement de la CFE',
      dateLimite: `${annee}-12-15`,
    },
  ];
}
