type Props = {
  size?: number;
  className?: string;
};

/** Crisp Torve "T" geometric emblem matching the dark #0A0A0A / neon lime #D8FF0A palette. */
export function TorveMark({ size = 28, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="10" fill="#111111" stroke="#27272A" strokeWidth="1.5" />
      <path
        d="M8.5 11.25H27.5V15.5H20.25V27.5H15.75V15.5H8.5V11.25Z"
        fill="#D8FF0A"
      />
      <rect x="23" y="23" width="4.5" height="4.5" rx="1.25" fill="#14FF73" />
    </svg>
  );
}
