import torveMarkPng from '../../../assets/torve-mark.png';
import torveWordmarkPng from '../../../assets/torve-wordmark.png';

type Props = {
  size?: number;
  className?: string;
  alt?: string;
};

/** Official Torve 3D isometric emblem (assets/torve-mark.png). */
export function TorveMark({ size = 28, className, alt }: Props) {
  return (
    <img
      src={torveMarkPng}
      width={size}
      height={size}
      alt={alt ?? ''}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        display: 'block',
        flexShrink: 0,
        filter: 'drop-shadow(0 2px 8px rgba(216, 255, 10, 0.16))',
      }}
    />
  );
}

/** Official TorveAI wordmark lockup (assets/torve-wordmark.png). */
export function TorveWordmark({ height = 24, className, alt = 'TorveAI' }: { height?: number; className?: string; alt?: string }) {
  return (
    <img
      src={torveWordmarkPng}
      height={height}
      alt={alt}
      draggable={false}
      className={className}
      style={{
        height,
        width: 'auto',
        objectFit: 'contain',
        display: 'block',
        flexShrink: 0,
      }}
    />
  );
}
