/*
 * RÉGLAGES DE L'ADMINISTRATEUR
 * ----------------------------
 * Ce fichier est écrit par la page admin.html (bouton « Publier sur GitHub », ou « Télécharger »
 * puis tu remplaces ce fichier dans ton dépôt). Tu n'as normalement pas besoin de le modifier à la main.
 * Ces réglages sont PRIORITAIRES sur js/animes.js et js/genres.js.
 *
 *   animes         : { "slug-de-l-anime": { tier: "easy" | "medium" | "hard",
 *                                           opsById: { "idOpening": "easy" | "medium" | "hard" } } }
 *                    tier = difficulté de l'anime ; opsById = difficulté d'un opening précis
 *                    (l'identifiant est celui d'AnimeThemes : il ne change jamais, contrairement au numéro)
 *   added          : animes ajoutés à la liste : { title, slug, tier, query, aliases, prefix, keep }
 *   removed        : slugs retirés de la liste d'animes.js (ils retombent en « difficile »)
 *   excluded       : identifiants d'openings à ne jamais proposer (musique cassée, mauvais anime…)
 *   excludedAnimes : slugs d'animes à ne jamais proposer
 *   genres         : { "slug-de-l-anime": ["comedy", "romance"] } remplace les genres de js/genres.js
 */
window.OVERRIDES = {
  "version": 1,
  "animes": {},
  "added": [],
  "removed": [],
  "excluded": [],
  "excludedAnimes": [],
  "genres": {}
};
