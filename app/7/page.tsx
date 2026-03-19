"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
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

interface BlobConfig {
  color: string;
  x: number;
  y: number;
  size: number;
  dx: number;
  dy: number;
  opacity: number;
}

export default function GradientMeshBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobsRef = useRef<BlobConfig[]>([]);
  const animRef = useRef<number>(0);

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

    // Initialize blobs
    blobsRef.current = EMBER.map((color, i) => ({
      color,
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: 200 + Math.random() * 300,
      dx: (Math.random() - 0.5) * 0.5,
      dy: (Math.random() - 0.5) * 0.5,
      opacity: 0.15 + Math.random() * 0.15,
    }));

    const animate = () => {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const blob of blobsRef.current) {
        blob.x += blob.dx;
        blob.y += blob.dy;

        // Bounce off edges with padding
        if (blob.x < -100 || blob.x > canvas.width + 100) blob.dx *= -1;
        if (blob.y < -100 || blob.y > canvas.height + 100) blob.dy *= -1;

        const gradient = ctx.createRadialGradient(
          blob.x,
          blob.y,
          0,
          blob.x,
          blob.y,
          blob.size
        );
        gradient.addColorStop(0, blob.color + Math.round(blob.opacity * 255).toString(16).padStart(2, "0"));
        gradient.addColorStop(1, blob.color + "00");

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center"
      style={{ fontFamily: "var(--font-geist-sans)" }}
    >
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" style={{ zIndex: 0 }} />

      <div className="relative z-10 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /7
        </p>
        <h1
          className="text-6xl font-bold"
          style={{
            fontFamily: "var(--font-display)",
            color: "#f0e8e0",
            textShadow: "0 0 60px rgba(255,72,0,0.3)",
          }}
        >
          Gradient Mesh
        </h1>
        <p className="mt-4 text-lg" style={{ color: "#f0e8e0a0" }}>
          Living canvas of drifting ember radials
        </p>

        <div
          className="mx-auto mt-8 max-w-md rounded-2xl border p-6 backdrop-blur-xl"
          style={{
            borderColor: "#ffffff10",
            background: "#00000040",
          }}
        >
          <p className="text-sm leading-relaxed" style={{ color: "#f0e8e0b0" }}>
            Ten overlapping radial gradients from the ember palette drift across the canvas.
            Each blob moves independently, creating an organic, ambient background.
          </p>
        </div>
      </div>

      <nav
        className="relative z-10 mt-20 flex items-center gap-6 text-sm"
        style={{ color: "#f0e8e060" }}
      >
        <Link href="/6" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/8" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
