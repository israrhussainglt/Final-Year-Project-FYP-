export function PulseMark({ className = "", tone = "teal" }: { className?: string; tone?: "teal" | "alert" | "ink" }) {
  const stroke = tone === "alert" ? "#D64550" : tone === "ink" ? "#0B2027" : "#0E7C7B";
  return (
    <svg viewBox="0 0 120 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M0 12 H30 L38 2 L48 22 L56 12 L64 18 L70 6 L76 12 H120"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="240"
        className="animate-pulse-line"
      />
    </svg>
  );
}
