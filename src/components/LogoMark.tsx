"use client";

import clsx from "clsx";

/** The desk mark — a tick that just printed a green close. */
export function LogoMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg
      className={clsx("logo-mark", className)}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
    >
      <rect width="32" height="32" rx="7" fill="#0e1017" />
      <path
        d="M5 22 L11 13 L16 18 L21 8 L27 20"
        fill="none"
        stroke="var(--series-1-glow)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="logo-tip" cx="27" cy="20" r="2.8" fill="var(--pos-glow)" />
    </svg>
  );
}
