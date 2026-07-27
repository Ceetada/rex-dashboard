/**
 * Progress ring for account setup.
 *
 * SVG rather than a CSS conic-gradient so the value is available to assistive
 * technology as a real progressmeter, not just as a coloured wedge.
 */
export function VerificationRing({ score }: { score: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;

  return (
    <div
      role="progressbar"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Account setup progress"
      className="relative shrink-0"
    >
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <circle
          cx="32" cy="32" r={radius} fill="none" strokeWidth="5"
          className="stroke-[var(--color-bg-subtle)]"
        />
        <circle
          cx="32" cy="32" r={radius} fill="none" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 32 32)"
          className="stroke-[var(--color-bg-primary)] transition-[stroke-dashoffset] duration-slow ease-standard"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-body-sm font-semibold text-content tabular-nums"
        aria-hidden
      >
        {score}%
      </span>
    </div>
  );
}
