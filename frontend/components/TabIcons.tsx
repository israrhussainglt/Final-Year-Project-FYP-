// Small, consistent 22x22 stroke icons for the bottom tab bar. Kept as
// inline SVG (no icon package dependency) to match how PulseMark and the
// rest of the app's iconography are already hand-drawn in this codebase.

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {children}
    </svg>
  );
}

export function HomeIcon() {
  return (
    <Svg>
      <path
        d="M3.5 9.5L11 3.5l7.5 6M5.5 8v9.5a1 1 0 001 1h3.25v-5.5h2.5v5.5H15.5a1 1 0 001-1V8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function RecordsIcon() {
  return (
    <Svg>
      <path
        d="M6 3.5h7l3.5 3.5V18a1 1 0 01-1 1H6a1 1 0 01-1-1V4.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M13 3.5V7h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 11h7M7.5 14h7M7.5 8h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  );
}

export function CalendarIcon() {
  return (
    <Svg>
      <rect x="3.5" y="4.5" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 8.5h15M7 3v3M15 3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7.5" cy="12" r="1" fill="currentColor" />
      <circle cx="11" cy="12" r="1" fill="currentColor" />
      <circle cx="14.5" cy="12" r="1" fill="currentColor" />
    </Svg>
  );
}

export function ScanIcon() {
  return (
    <Svg>
      <path
        d="M3.5 7.5V5.5a2 2 0 012-2h2M18.5 7.5V5.5a2 2 0 00-2-2h-2M3.5 14.5v2a2 2 0 002 2h2M18.5 14.5v2a2 2 0 01-2 2h-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M4.5 11h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

export function ShieldIcon() {
  return (
    <Svg>
      <path
        d="M11 3l6.5 2.5V10c0 4.5-2.8 7.2-6.5 8.5C7.3 17.2 4.5 14.5 4.5 10V5.5L11 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8.2 11l2 2 3.6-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function UsersIcon() {
  return (
    <Svg>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 17c.6-2.7 2.2-4 4.5-4s3.9 1.3 4.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="15" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 13.2c1.9.2 3.1 1.4 3.6 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function GridIcon() {
  return (
    <Svg>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="12.5" y="3.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="12.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="12.5" y="12.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
    </Svg>
  );
}
