import { Logo } from "./Logo";

interface AICoreProps {
  size?: number;
  /** True while the AI is generating: glow pulses faster, ring spins. */
  active?: boolean;
  /** Float gently (empty state). */
  float?: boolean;
  className?: string;
}

/**
 * AI Core orb. Only transform/opacity are animated, so it stays cheap on the compositor.
 * Idle: slow breathing glow. Active: faster pulse + orbiting ring.
 */
export function AICore({ size = 120, active = false, float = false, className = "" }: AICoreProps) {
  const logoSize = Math.round(size * 0.36);
  return (
    <div
      className={`relative shrink-0 ${float ? "animate-float" : ""} ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={active ? "Aliftzy Codes AI is generating" : "Aliftzy Codes AI"}
    >
      {/* outer glow */}
      <div
        className={`absolute inset-[-18%] rounded-full blur-2xl will-change-transform ${active ? "animate-pulseFast" : "animate-breathe"}`}
        style={{ background: "radial-gradient(circle, rgb(var(--violet) / 0.55), rgb(var(--sky) / 0.25) 55%, transparent 72%)" }}
      />
      {/* orbiting ring */}
      <div
        className={`absolute inset-0 rounded-full will-change-transform ${active ? "animate-spinSlow [animation-duration:3s]" : "animate-spinSlow"}`}
        style={{
          background: "conic-gradient(from 0deg, transparent 0 55%, rgb(var(--cyan) / 0.75) 80%, rgb(var(--violet) / 0.9) 100%)",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1px))",
          opacity: active ? 1 : 0.5,
          transition: "opacity 0.5s",
        }}
      />
      {/* body */}
      <div
        className="absolute inset-[10%] flex items-center justify-center rounded-full border border-line"
        style={{
          background:
            "radial-gradient(circle at 32% 26%, rgb(var(--raised)), rgb(var(--bg)) 72%), rgb(var(--surface))",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.06), inset 0 -10px 24px rgb(var(--violet) / 0.12)",
        }}
      >
        <Logo size={logoSize} />
      </div>
    </div>
  );
}
