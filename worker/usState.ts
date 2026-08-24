/**
 * ZIP → USPS state code.
 *
 * The rep-info form captures street, city and ZIP but never a state, and the
 * Microsoft 365 contact card wants one. Deriving it from the ZIP beats deriving
 * it from the rep's territory: a Las Vegas rep can live in St George, UT, and a
 * Tampa rep in Georgia. Ranges are on the ZIP's first three digits, which map
 * to states unambiguously — no network call, no drift.
 *
 * Returns null for anything unrecognised (military/territory ZIPs, garbage
 * input); callers just leave the state blank rather than guessing.
 */
// [firstZip3, lastZip3, state] — inclusive, ordered by prefix.
const ZIP3: Array<[number, number, string]> = [
  [5, 5, "NY"],   // Fishers Island
  [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"],
  [60, 69, "CT"], [70, 89, "NJ"],
  [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"],
  [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"],
  [270, 289, "NC"], [290, 299, "SC"],
  [300, 319, "GA"], [320, 339, "FL"], [341, 342, "FL"], [344, 344, "FL"],
  [346, 347, "FL"], [349, 349, "FL"],
  [350, 352, "AL"], [354, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"],
  [398, 399, "GA"],
  [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"],
  [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"], [569, 569, "DC"],
  [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"],
  [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"],
  [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"],
  [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"],
  [850, 853, "AZ"], [855, 857, "AZ"], [859, 860, "AZ"], [863, 865, "AZ"],
  [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"],
  [900, 908, "CA"], [910, 928, "CA"], [930, 961, "CA"],
  [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

export function stateFromZip(zip: string | null | undefined): string | null {
  const digits = (zip ?? "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  const p = Number(digits.slice(0, 3));
  for (const [lo, hi, st] of ZIP3) if (p >= lo && p <= hi) return st;
  return null;
}
