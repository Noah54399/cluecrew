import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  shape: 'rect' | 'circle';
}

const COLORS = ['#7C5CFF', '#FF4D9D', '#2DE1C7', '#FFC94D', '#4DD4FF', '#B95CFF'];

/** Lightweight canvas confetti — original implementation, no libraries. */
export function Confetti({ active, durationMs = 4500 }: { active: boolean; durationMs?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = [];
    const count = Math.min(160, Math.floor(window.innerWidth / 8));
    for (let index = 0; index < count; index += 1) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -Math.random() * canvas.height * 0.4,
        vx: (Math.random() - 0.5) * 3 * dpr,
        vy: (1.6 + Math.random() * 2.6) * dpr,
        size: (4 + Math.random() * 7) * dpr,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        shape: Math.random() > 0.4 ? 'rect' : 'circle',
      });
    }

    let raf = 0;
    const startedAt = performance.now();
    const frame = (time: number) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const elapsed = time - startedAt;
      const fade = elapsed > durationMs - 900 ? Math.max(0, (durationMs - elapsed) / 900) : 1;

      for (const particle of particles) {
        particle.x += particle.vx + Math.sin((time + particle.size) / 320) * 0.6 * dpr;
        particle.y += particle.vy;
        particle.rotation += particle.rotationSpeed;
        if (particle.y > canvas.height + 40) {
          particle.y = -30;
          particle.x = Math.random() * canvas.width;
        }
        context.save();
        context.globalAlpha = fade;
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        if (particle.shape === 'rect') {
          context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        } else {
          context.beginPath();
          context.arc(0, 0, particle.size / 2.4, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }

      if (elapsed < durationMs) {
        raf = requestAnimationFrame(frame);
      } else {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [active, durationMs]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden />;
}
