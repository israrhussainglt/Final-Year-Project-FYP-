// Canonical list of Pakistan's provinces/administrative units, plus a
// best-effort city -> province lookup so existing hospitals (seeded with
// only a city) can be backfilled without a manual data-entry pass.
//
// This intentionally uses Pakistan's real administrative structure:
// four provinces, one federal territory, and two other areas that are
// routinely (and correctly) reported on their own in health/census data:
// Gilgit-Baltistan and Azad Jammu & Kashmir.
export const PROVINCES = [
  "Punjab",
  "Sindh",
  "Khyber Pakhtunkhwa",
  "Balochistan",
  "Gilgit-Baltistan",
  "Azad Jammu & Kashmir",
  "Islamabad Capital Territory",
] as const;

export type Province = (typeof PROVINCES)[number];

// Lowercased city name -> province. Extend as new hospital cities are added.
const CITY_TO_PROVINCE: Record<string, Province> = {
  // Punjab
  lahore: "Punjab",
  rawalpindi: "Punjab",
  faisalabad: "Punjab",
  multan: "Punjab",
  sialkot: "Punjab",
  gujranwala: "Punjab",
  bahawalpur: "Punjab",
  sargodha: "Punjab",

  // Sindh
  karachi: "Sindh",
  hyderabad: "Sindh",
  sukkur: "Sindh",
  larkana: "Sindh",

  // Khyber Pakhtunkhwa
  peshawar: "Khyber Pakhtunkhwa",
  abbottabad: "Khyber Pakhtunkhwa",
  mardan: "Khyber Pakhtunkhwa",
  swat: "Khyber Pakhtunkhwa",

  // Balochistan
  quetta: "Balochistan",
  gwadar: "Balochistan",
  turbat: "Balochistan",

  // Gilgit-Baltistan
  gilgit: "Gilgit-Baltistan",
  skardu: "Gilgit-Baltistan",
  hunza: "Gilgit-Baltistan",

  // Azad Jammu & Kashmir
  muzaffarabad: "Azad Jammu & Kashmir",
  mirpur: "Azad Jammu & Kashmir",

  // Islamabad Capital Territory
  islamabad: "Islamabad Capital Territory",
};

export function provinceForCity(city: string | null | undefined): Province | null {
  if (!city) return null;
  return CITY_TO_PROVINCE[city.trim().toLowerCase()] ?? null;
}
