export interface PointerPoint {
  x: number;
  y: number;
  time: number;
}

export interface FluidSplat {
  x: number;
  y: number;
  dx: number;
  dy: number;
  radius: number;
  amount: number;
}

export function strokeSplats(
  previous: PointerPoint | null,
  current: PointerPoint,
  width: number,
  height: number,
): FluidSplat[] {
  if (!previous || width <= 0 || height <= 0) return [];
  if (current.x < 0 || current.y < 0 || current.x > width || current.y > height) return [];
  const elapsed = current.time - previous.time;
  if (elapsed > 350) return [];
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) return [];
  const speed = Math.min(distance / Math.max(elapsed, 8), 3);
  const radius = 0.021 + Math.min(speed, 2) * 0.007;
  const count = Math.min(64, Math.ceil(distance / Math.max(6, height * 0.025)));
  const force = (0.15 + speed * 0.3) / distance;
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / count;
    return {
      x: (previous.x + dx * t) / width,
      y: 1 - (previous.y + dy * t) / height,
      dx: dx * force,
      dy: -dy * force,
      radius,
      amount: 0.14 + speed * 0.065,
    };
  });
}
