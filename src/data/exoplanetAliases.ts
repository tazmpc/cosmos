/**
 * Curated cross-match between NASA Exoplanet Archive hostnames (as published — often a Bayer/
 * Flamsteed-style designation, e.g. "51 Peg") and this project's star catalog's proper names
 * (HYG v4.1's `proper` column, as baked into public/starnames.json by scripts/build-catalog.ts —
 * often a different, IAU-approved proper name, e.g. "Helvetios").
 *
 * Every entry here was verified two ways before being added: the archive hostname string
 * actually appears as a `hosts` key in public/exoplanets.json (scripts/build-exoplanets.ts,
 * NASA Exoplanet Archive TAP snapshot fetched 2026-08-18), AND the catalog name actually appears
 * as a key in public/starnames.json (checked directly against the built file, not from memory).
 *
 * A few plausible candidates from the seed list did NOT survive verification and were dropped
 * rather than guessed at: Fomalhaut and Pollux both have famous claimed planets, but neither
 * appears as a hostname (under any designation this project checked) in the Archive's current
 * default_flag=1 snapshot — Fomalhaut b in particular was later shown to likely be a transient
 * dust cloud rather than a real planet, consistent with its absence from the Archive's own
 * recommended parameter set. Kepler-90 has the same problem from the other direction: it's a
 * real, well-matched star in nobody's catalog at its ~V14 brightness, and the Archive itself only
 * carries ONE of its eight known planets ("Kepler-90 i") under `default_flag=1`, filed under the
 * host name "KOI-351" rather than "Kepler-90" — handled in src/main.ts as a card-only search
 * entry with a display-name override, not as a catalog alias (Kepler-90 is nowhere near this
 * catalog's magnitude cut, so there is no star name to alias it to).
 */
export const EXOPLANET_HOST_ALIASES: Record<string, string> = {
  '51 Peg': 'Helvetios',    // 51 Pegasi — the first exoplanet discovered around a Sun-like star
  'tau Cet': '52Tau Cet',   // tau Ceti (catalog's own odd-but-verified bayer-designation key)
  'eps Eri': 'Ran',         // epsilon Eridani
  'gam Cep': 'Errai',       // gamma Cephei
  'ups And': 'Titawin',     // upsilon Andromedae
  '47 UMa': 'Chalawan',     // 47 Ursae Majoris
  '55 Cnc': 'Copernicus',   // 55 Cancri
  'alf Tau': 'Aldebaran',   // Aldebaran
  'Proxima Cen': 'Proxima Centauri',
}

/** Reverse of EXOPLANET_HOST_ALIASES, built once at module load — catalog star name -> Archive
 *  hostname. Every value is unique by construction (EXOPLANET_HOST_ALIASES is an injective map,
 *  hand-curated to stay that way), so this reversal never loses an entry to a collision. */
export const CATALOG_NAME_TO_ARCHIVE_HOST: Record<string, string> = Object.fromEntries(
  Object.entries(EXOPLANET_HOST_ALIASES).map(([archiveHost, catalogName]) => [catalogName, archiveHost]),
)
