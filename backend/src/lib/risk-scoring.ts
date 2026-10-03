// Deterministic, rule-based clinical risk scorer — not a trained ML model.
// This is intentional: a transparent, auditable set of threshold checks is
// a better fit for a medical-record product than an opaque classifier,
// since every score this produces can be explained to a doctor (or a
// patient) in plain language via `factors`. The threshold set mirrors
// standard adult vital-sign reference ranges (WHO/AHA blood-pressure
// bands, ADA fasting-glucose bands, standard fever/tachycardia cutoffs),
// with an additional maternal-context pass for pregnancy-related risk
// factors (pre-eclampsia-range blood pressure, extremes of maternal age).
//
// This never replaces clinical judgement — it only flags patterns worth a
// doctor's attention. RISK_DISCLAIMER below is surfaced alongside every
// score returned by the API so that never gets lost in transit.

export type RiskLevel = "low" | "mid" | "high";
export type RiskContext = "general" | "maternal";

export const RISK_DISCLAIMER =
  "Automated, rule-based flag from recorded vitals only — not a diagnosis. Always use clinical judgement.";

export interface RiskInput {
  ageYears: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  bloodSugarMmol: number | null;
  bodyTempC: number | null;
  heartRateBpm: number | null;
  context: RiskContext;
}

export interface RiskAssessmentResult {
  level: RiskLevel;
  score: number; // 0-100
  factors: string[];
}

// True only when every vital field is null — used by callers to decide
// whether there's anything to score at all before writing a row.
export function hasAnyVitals(input: Omit<RiskInput, "context" | "ageYears">): boolean {
  return (
    input.systolicBp !== null ||
    input.diastolicBp !== null ||
    input.bloodSugarMmol !== null ||
    input.bodyTempC !== null ||
    input.heartRateBpm !== null
  );
}

export function computeRiskAssessment(input: RiskInput): RiskAssessmentResult {
  let score = 0;
  const factors: string[] = [];
  const { ageYears, systolicBp, diastolicBp, bloodSugarMmol, bodyTempC, heartRateBpm, context } = input;

  // --- Blood pressure ---
  if (systolicBp !== null || diastolicBp !== null) {
    const sys = systolicBp ?? 0;
    const dia = diastolicBp ?? 0;
    const severeThreshold = context === "maternal" ? 160 : 180;
    const severeDiaThreshold = context === "maternal" ? 110 : 120;
    const highThreshold = context === "maternal" ? 140 : 140;
    const highDiaThreshold = context === "maternal" ? 90 : 90;

    if (sys >= severeThreshold || dia >= severeDiaThreshold) {
      score += context === "maternal" ? 50 : 40;
      factors.push(
        context === "maternal"
          ? `Severely elevated blood pressure (${sys}/${dia} mmHg) — in the pre-eclampsia/eclampsia risk range.`
          : `Severely elevated blood pressure (${sys}/${dia} mmHg) — hypertensive crisis range.`
      );
    } else if (sys >= highThreshold || dia >= highDiaThreshold) {
      score += context === "maternal" ? 30 : 20;
      factors.push(`Elevated blood pressure (${sys}/${dia} mmHg).`);
    } else if (sys > 0 && sys < 90) {
      score += 15;
      factors.push(`Low blood pressure (${sys}/${dia} mmHg).`);
    }
  }

  // --- Blood sugar (mmol/L, fasting-equivalent thresholds) ---
  if (bloodSugarMmol !== null) {
    if (bloodSugarMmol >= 11.1) {
      score += 30;
      factors.push(`High blood sugar (${bloodSugarMmol} mmol/L) — in the diabetic range.`);
    } else if (bloodSugarMmol >= 7.0) {
      score += context === "maternal" ? 25 : 15;
      factors.push(`Elevated blood sugar (${bloodSugarMmol} mmol/L).`);
    } else if (bloodSugarMmol < 4.0) {
      score += 20;
      factors.push(`Low blood sugar (${bloodSugarMmol} mmol/L) — hypoglycaemic range.`);
    }
  }

  // --- Body temperature ---
  if (bodyTempC !== null) {
    if (bodyTempC >= 39.5) {
      score += 25;
      factors.push(`High fever (${bodyTempC}°C).`);
    } else if (bodyTempC >= 38.0) {
      score += 12;
      factors.push(`Fever (${bodyTempC}°C).`);
    } else if (bodyTempC < 35.5) {
      score += 20;
      factors.push(`Low body temperature (${bodyTempC}°C) — hypothermia range.`);
    }
  }

  // --- Heart rate ---
  if (heartRateBpm !== null) {
    if (heartRateBpm > 120 || heartRateBpm < 45) {
      score += 20;
      factors.push(`Heart rate significantly out of normal range (${heartRateBpm} bpm).`);
    } else if (heartRateBpm > 100 || heartRateBpm < 50) {
      score += 10;
      factors.push(`Heart rate outside normal resting range (${heartRateBpm} bpm).`);
    }
  }

  // --- Age ---
  if (ageYears !== null) {
    if (context === "maternal" && (ageYears < 18 || ageYears > 35)) {
      score += 10;
      factors.push(`Maternal age (${ageYears}) is outside the lowest-risk 18–35 range.`);
    } else if (context === "general" && ageYears >= 65) {
      score += 10;
      factors.push(`Age ${ageYears} — general vulnerability factor.`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  const level: RiskLevel = score >= 60 ? "high" : score >= 30 ? "mid" : "low";

  if (factors.length === 0) {
    factors.push("No risk factors flagged from the vitals provided.");
  }

  return { level, score, factors };
}
