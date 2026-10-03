"use client";

// app/error.tsx only catches errors thrown by pages *inside* the root
// layout — if the root layout itself throws (or something above it does),
// Next.js falls back to this file instead. It has to render its own
// <html>/<body> since it's replacing the layout that failed, and it can't
// depend on globals.css having loaded reliably, so styling is inline.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#F6F8F8",
          color: "#0B2027",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ color: "#0E7C7B", fontWeight: 700, fontSize: 20, marginBottom: 24 }}>PulseID</div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: "#4C6663", maxWidth: 380, marginBottom: 24 }}>
          The application hit an unexpected error loading. Your data is safe — please try again.
        </p>
        <button
          onClick={reset}
          style={{
            background: "#0B2027",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
