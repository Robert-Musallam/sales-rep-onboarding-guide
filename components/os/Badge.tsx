import type React from "react";

/** RNB tone palette — shared across all modules' badges/accents. */
export const TONE_HEX: Record<string, string> = {
  red: "#d1495b",
  orange: "#e2703a",
  amber: "#e0992b",
  green: "#2e9e5b",
  slate: "#64788a",
  teal: "#1f7a8c",
  navy: "#2a5885",
};

export function toneHex(tone: string): string {
  return TONE_HEX[tone] ?? TONE_HEX.slate;
}

export function toneStyle(tone: string): React.CSSProperties {
  const hex = toneHex(tone);
  return { color: hex, background: `${hex}1a`, border: `1px solid ${hex}33` };
}

/**
 * Generic pill badge. Modules build domain badges (urgency, decision, …) on top
 * of this by mapping their own state → a tone + label.
 */
export function Badge({
  tone,
  label,
  dot = false,
  title,
}: {
  tone: string;
  label: string;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className="tag" style={toneStyle(tone)} title={title}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: toneHex(tone) }} />}
      {label}
    </span>
  );
}
