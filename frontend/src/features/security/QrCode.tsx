import { encode } from 'uqr';

// Whole pixels per module keep the edges sharp enough for any camera.
const MODULE_PX = 4;

// Drawn in the browser so the key inside the otpauth link never leaves it.
export default function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: 'M', border: 2 });
  let path = '';
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    });
  });
  return (
    <svg
      className="security-qr"
      width={size * MODULE_PX}
      height={size * MODULE_PX}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#111" />
    </svg>
  );
}
