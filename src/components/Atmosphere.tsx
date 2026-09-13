"use client";

/**
 * Fixed ambience behind the desk: drifting aurora, a slow grid, film grain
 * and a faint CRT wash. Pure CSS so the live panels stay cheap to paint.
 */
export function Atmosphere() {
  return (
    <div className="fx-root" aria-hidden>
      <div className="fx-grid" />
      <div className="fx-orb fx-orb-a" />
      <div className="fx-orb fx-orb-b" />
      <div className="fx-orb fx-orb-c" />
      <div className="fx-vignette" />
      <div className="fx-grain" />
      <div className="fx-crt" />
    </div>
  );
}
