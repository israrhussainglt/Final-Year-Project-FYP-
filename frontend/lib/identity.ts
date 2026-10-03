// Shared helpers for the CNIC / B-Form distinction. NADRA issues a 13-digit
// CNIC (#####-#######-#) at 18, and the same-format B-Form number to
// children under 18 — so the only reliable way to tell them apart is date
// of birth, not the digits themselves.

// Whole-years-old calculation that's correct on the person's birthday (not
// just year subtraction, which is wrong for anyone who hasn't had this
// year's birthday yet). Mirrors backend/src/server.ts's ageInYears — kept
// in sync manually since frontend and backend are independent packages.
export function ageInYears(dateOfBirth: string, atDate: Date = new Date()): number {
  const dob = new Date(dateOfBirth);
  let age = atDate.getFullYear() - dob.getFullYear();
  const beforeBirthdayThisYear =
    atDate.getMonth() < dob.getMonth() ||
    (atDate.getMonth() === dob.getMonth() && atDate.getDate() < dob.getDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

export function isMinorDob(dateOfBirth: string): boolean {
  if (!dateOfBirth || Number.isNaN(Date.parse(dateOfBirth))) return false;
  return ageInYears(dateOfBirth) < 18;
}

export function idLabel(isMinor: boolean): string {
  return isMinor ? "B-Form Number" : "CNIC";
}
