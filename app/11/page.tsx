"use client";

import { useEffect, useRef, useCallback } from "react";
import Link from "next/link";

const EMBER = [
  "#ff4800",
  "#ff5400",
  "#ff6000",
  "#ff6d00",
  "#ff7900",
  "#ff8500",
  "#ff9100",
  "#ff9e00",
  "#ffaa00",
  "#ffb600",
] as const;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  colorIndex: number;
}

export default function EmberCursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -100, y: -100 });
  const prevMouseRef = useRef({ x: -100, y: -100 });
  const animRef = useRef<number>(0);

  const hexToRgb = useCallback((hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const handleMouseMove = (e: MouseEvent) => {
      prevMouseRef.current = { ...mouseRef.current };
      mouseRef.current = { x: e.clientX, y: e.clientY };

      // Spawn particles based on mouse speed
      const dx = mouseRef.current.x - prevMouseRef.current.x;
      const dy = mouseRef.current.y - prevMouseRef.current.y;
      const speed = Math.sqrt(dx * dx + dy * dy);
      const count = Math.min(Math.floor(speed / 3) + 1, 8);

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 2 + 0.5;
        particlesRef.current.push({
          x: mouseRef.current.x + (Math.random() - 0.5) * 10,
          y: mouseRef.current.y + (Math.random() - 0.5) * 10,
          vx: Math.cos(angle) * velocity + dx * 0.1,
          vy: Math.sin(angle) * velocity + dy * 0.1 - Math.random() * 1.5,
          life: 1,
          maxLife: 0.6 + Math.random() * 0.8,
          size: 2 + Math.random() * 4,
          colorIndex: Math.floor(Math.random() * EMBER.length),
        });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);

    const animate = () => {
      ctx.fillStyle = "rgba(10, 10, 10, 0.15)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02; // slight gravity
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.life -= 0.016 / p.maxLife;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        const { r, g, b } = hexToRgb(EMBER[p.colorIndex]);
        const alpha = p.life * 0.8;
        const size = p.size * p.life;

        // Glow
        ctx.beginPath();
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 3);
        glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`);
        glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = glow;
        ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [hexToRgb]);

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" style={{ zIndex: 1 }} />

      <div className="pointer-events-none relative z-10 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /11
        </p>
        <h1
          className="text-6xl font-bold"
          style={{
            fontFamily: "var(--font-display)",
            color: "#f0e8e0",
            textShadow: "0 0 40px rgba(255,72,0,0.2)",
          }}
        >
          Ember Cursor Trail
        </h1>
        <p className="mt-4 text-lg" style={{ color: "#f0e8e0a0" }}>
          Move your cursor to leave a warm, fading trail
        </p>
        <p className="mt-2 text-sm" style={{ color: "#f0e8e060" }}>
          Faster movement = more particles
        </p>
      </div>

      <nav
        className="relative z-20 mt-20 flex items-center gap-6 text-sm"
        style={{ color: "#f0e8e060" }}
      >
        <Link href="/10" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/12" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
