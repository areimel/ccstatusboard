import { useId } from "react";

export interface InstrumentGraphicProps {
  className?: string;
  variant?: "radar" | "wave" | "grid";
  palette?: "paper" | "orange" | "dark";
  seed?: number;
  /** Detail density, clamped to 0–100. */
  complexity?: number;
  /** Set to an empty string (or use decorative) to hide from assistive technology. */
  title?: string;
  decorative?: boolean;
}

const palettes = {
  paper: { background: "#eee9db", ink: "#191a17", accent: "#ff4d00" },
  orange: { background: "#ff4d00", ink: "#191a17", accent: "#eee9db" },
  dark: { background: "#191a17", ink: "#eee9db", accent: "#ff4d00" },
};

// Stateless integer hashing keeps every mark identical on server and client.
function sample(seed: number, index: number) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

function Cross({ x, y, size = 5 }: { x: number; y: number; size?: number }) {
  return (
    <path
      d={`M${x - size} ${y}h${size * 2}M${x} ${y - size}v${size * 2}`}
      fill="none"
      stroke="currentColor"
    />
  );
}

/** Original native-SVG instrument plate. No effects, browser APIs, or external assets. */
export function InstrumentGraphic({
  className,
  variant = "radar",
  palette = "orange",
  seed = 932598536,
  complexity = 75,
  title,
  decorative = false,
}: InstrumentGraphicProps) {
  const id = `instrument-${useId().replace(/:/g, "")}`;
  const colors = palettes[palette];
  const normalizedSeed = Number.isFinite(seed) ? seed >>> 0 : 932598536;
  const density = Math.max(
    0,
    Math.min(100, Number.isFinite(complexity) ? complexity : 75),
  );
  const ticks = 48 + Math.round((density / 100) * 96);
  const bars = 32 + Math.round((density / 100) * 48);
  const label =
    title ??
    `${variant === "radar" ? "Sonar" : variant === "wave" ? "Waveform" : "Signal matrix"} instrument study, edition ${normalizedSeed}`;
  const hidden = decorative || label === "";
  const points = Array.from({ length: 161 }, (_, i) => {
    const envelope = Math.sin((i / 160) * Math.PI) ** 2;
    const y =
      285 +
      Math.sin(i * (0.22 + sample(normalizedSeed, 1) * 0.12)) * envelope * 115 +
      Math.sin(i * 0.93) * envelope * 24;
    return `${68 + i * 2.9},${y.toFixed(3)}`;
  }).join(" ");

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 600 660"
      width="600"
      height="660"
      className={className}
      style={{
        display: "block",
        width: "100%",
        height: "auto",
        color: colors.ink,
      }}
      role={hidden ? undefined : "img"}
      aria-hidden={hidden ? true : undefined}
      aria-labelledby={hidden ? undefined : `${id}-title`}
      focusable="false"
      data-variant={variant}
      data-palette={palette}
    >
      {!hidden && <title id={`${id}-title`}>{label}</title>}
      <defs>
        <pattern
          id={`${id}-grid`}
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M24 0H0V24"
            fill="none"
            stroke={colors.ink}
            strokeWidth="0.6"
            opacity="0.24"
          />
        </pattern>
        <pattern
          id={`${id}-hatch`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path d="M0 0V6" stroke={colors.ink} strokeWidth="1.2" />
        </pattern>
        <clipPath id={`${id}-field`}>
          <rect x="36" y="94" width="528" height="366" />
        </clipPath>
        <clipPath id={`${id}-disc`}>
          <circle cx="245" cy="277" r="156" />
        </clipPath>
      </defs>
      <rect width="600" height="660" fill={colors.background} />
      <g fill="none" stroke={colors.ink}>
        <rect x="18" y="18" width="564" height="624" strokeWidth="1.4" />
        <path d="M18 78H582M18 482H582M18 596H582M36 94H564V460H36Z" />
      </g>
      <g
        fill={colors.ink}
        fontFamily="'Courier New', monospace"
        fontSize="9"
        letterSpacing="1"
      >
        <text x="36" y="39">
          KOJIMA / SIGNAL RESEARCH BUREAU
        </text>
        <text x="564" y="39" textAnchor="end">
          PLATE 025
        </text>
        <text x="36" y="64" fontSize="20" fontWeight="700" letterSpacing="-1">
          {variant === "radar"
            ? "SONAR—25"
            : variant === "wave"
              ? "PHASE—08"
              : "ARRAY—64"}
        </text>
        <text x="564" y="62" textAnchor="end">
          {String(normalizedSeed).padStart(10, "0")} / {Math.round(density)}%
        </text>
      </g>
      <g clipPath={`url(#${id}-field)`}>
        <rect
          x="36"
          y="94"
          width="528"
          height="366"
          fill={`url(#${id}-grid)`}
        />
        {variant === "radar" && (
          <>
            <path
              d="M245 277L144 126A182 182 0 0 1 412 204Z"
              fill={colors.accent}
            />
            <circle
              cx="245"
              cy="277"
              r="174"
              fill="none"
              stroke={colors.ink}
              strokeWidth="1.5"
            />
            {[156, 130, 104, 78, 52, 26].map((r, i) => (
              <circle
                key={r}
                cx="245"
                cy="277"
                r={r}
                fill="none"
                stroke={colors.ink}
                strokeWidth={i === 0 ? 2.5 : 0.8}
              />
            ))}
            <g clipPath={`url(#${id}-disc)`}>
              <rect
                x="245"
                y="110"
                width="170"
                height="336"
                fill={`url(#${id}-hatch)`}
                opacity="0.27"
              />
              {Array.from({ length: 6 + Math.round(density / 8) }, (_, i) => (
                <circle
                  key={i}
                  cx={105 + sample(normalizedSeed, i) * 280}
                  cy={135 + sample(normalizedSeed, i + 70) * 280}
                  r={2 + sample(normalizedSeed, i + 30) * 4}
                  fill={colors.ink}
                />
              ))}
            </g>
            {Array.from({ length: ticks }, (_, i) => (
              <path
                key={i}
                d={`M245 103v${i % 6 === 0 ? 14 : 6}`}
                transform={`rotate(${(i * 360) / ticks} 245 277)`}
                stroke={colors.ink}
                strokeWidth={i % 6 === 0 ? 1.4 : 0.7}
              />
            ))}
            <path
              d="M54 277H436M245 102V453M122 154L368 400M122 400L368 154"
              stroke={colors.ink}
              strokeWidth="0.75"
              fill="none"
            />
            <path d="M245 277L379 174" stroke={colors.ink} strokeWidth="3" />
            <circle
              cx="245"
              cy="277"
              r="8"
              fill={colors.background}
              stroke={colors.ink}
              strokeWidth="2"
            />
            <circle cx="245" cy="277" r="2" fill={colors.ink} />
            <rect
              x="442"
              y="94"
              width="122"
              height="366"
              fill={colors.background}
              stroke={colors.ink}
            />
            {Array.from({ length: 28 }, (_, i) => (
              <Cross
                key={i}
                x={458 + (i % 4) * 29}
                y={111 + Math.floor(i / 4) * 49}
                size={3.5}
              />
            ))}
            <circle
              cx="502"
              cy="277"
              r="36"
              fill={colors.accent}
              stroke={colors.ink}
            />
            <Cross x={502} y={277} size={49} />
            <circle cx="502" cy="277" r="18" fill="none" stroke={colors.ink} />
            <path d="M442 413H564" stroke={colors.ink} />
          </>
        )}
        {variant === "wave" && (
          <>
            <rect x="220" y="94" width="98" height="366" fill={colors.accent} />
            {[157, 221, 285, 349, 413].map((y) => (
              <path
                key={y}
                d={`M36 ${y}H564`}
                stroke={colors.ink}
                strokeDasharray="3 5"
                opacity="0.5"
              />
            ))}
            <polyline
              points={points}
              fill="none"
              stroke={colors.ink}
              strokeWidth="3"
            />
            <polyline
              points={points}
              transform="translate(0 570) scale(1 -1)"
              fill="none"
              stroke={colors.ink}
              strokeWidth="0.8"
            />
            <path d="M36 285H564M269 94V460" stroke={colors.ink} />
            {[100, 180, 360, 470].map((x) => (
              <Cross key={x} x={x} y={285} size={12} />
            ))}
            <circle
              cx="269"
              cy="285"
              r="132"
              fill="none"
              stroke={colors.ink}
              strokeDasharray="2 7"
            />
          </>
        )}
        {variant === "grid" && (
          <>
            {Array.from({ length: 96 }, (_, i) => {
              const value = sample(normalizedSeed, i);
              const x = 51 + (i % 12) * 42;
              const y = 111 + Math.floor(i / 12) * 42;
              return value > 0.52 ? (
                <rect
                  key={i}
                  x={x}
                  y={y}
                  width="30"
                  height="30"
                  fill={value > 0.78 ? colors.accent : colors.ink}
                />
              ) : (
                <Cross key={i} x={x + 15} y={y + 15} size={4 + density / 20} />
              );
            })}
            <circle
              cx="300"
              cy="277"
              r="144"
              fill="none"
              stroke={colors.ink}
              strokeWidth="2"
            />
            <circle
              cx="300"
              cy="277"
              r="152"
              fill="none"
              stroke={colors.ink}
              strokeDasharray="2 5"
            />
            <path d="M36 277H564M300 94V460" stroke={colors.ink} />
          </>
        )}
      </g>
      <g
        fill={colors.ink}
        fontFamily="'Courier New', monospace"
        fontSize="7"
        letterSpacing="0.7"
      >
        <text x="42" y="472">
          FIG. 01 / {variant.toUpperCase()} TELEMETRY
        </text>
        <text x="558" y="472" textAnchor="end">
          SCAN 360° / SYSTEM ACTIVE
        </text>
      </g>
      <text
        x="30"
        y="578"
        fill={colors.ink}
        fontFamily="'Arial Black', Arial, sans-serif"
        fontSize="100"
        fontWeight="900"
      >
        {variant === "wave" ? "SIGNAL" : "KOJIMA"}
      </text>
      <g fill={colors.ink}>
        {Array.from({ length: bars }, (_, i) => {
          const height = 5 + sample(normalizedSeed, i + 200) * 24;
          return (
            <rect
              key={i}
              x={36 + (i * 294) / bars}
              y={632 - height}
              width={Math.max(1, 294 / bars - 1.6)}
              height={height}
            />
          );
        })}
      </g>
      <g
        fill={colors.ink}
        fontFamily="'Courier New', monospace"
        fontSize="8"
        letterSpacing="0.6"
      >
        <text x="352" y="613">
          EXPERIMENTAL INSTRUMENTS
        </text>
        <text x="352" y="630">
          NO. 025 / FORM + FREQUENCY
        </text>
      </g>
      {[
        [18, 18],
        [582, 18],
        [18, 642],
        [582, 642],
      ].map(([x, y], i) => (
        <Cross key={i} x={x} y={y} size={8} />
      ))}
    </svg>
  );
}

export default InstrumentGraphic;
