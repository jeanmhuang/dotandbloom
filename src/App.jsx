import React, { useEffect, useRef, useState, useMemo } from "react";

// Dot and Bloom — single-file React app (place in src/App.jsx)
// One default export (App). DotAndBloom is a named component used by App.

// ---------------------- Utilities ----------------------
function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

function seededRandom(seed) {
  // Mulberry32 PRNG
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function dailyPalette() {
  // Deterministic palette from today's date (YYYYMMDD)
  const today = new Date();
  const seed = parseInt(
    `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
      today.getDate()
    ).padStart(2, "0")}`,
    10
  );
  const rnd = seededRandom(seed);
  const pastel = () => {
    const h = Math.floor(rnd() * 360);
    const s = 60 + Math.floor(rnd() * 20); // 60–80
    const l = 80 + Math.floor(rnd() * 10); // 80–90
    return `hsl(${h}deg ${s}% ${l}%)`;
  };
  const bg = `hsl(${Math.floor(rnd() * 360)}deg 70% 97%)`;
  return {
    bg,
    blooms: [pastel(), pastel(), pastel(), pastel(), pastel()],
  };
}

// ---------------------- UI Shell ----------------------
const UI = ({ children }) => (
  <div
    className="w-full min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_20%_20%,_rgba(255,255,255,.9),_rgba(255,255,255,.7)),_var(--game-bg)]"
    style={{ background: "var(--game-bg, #fafafa)" }}
  >
    <div className="max-w-5xl w-full p-4 sm:p-6 md:p-8">{children}</div>
  </div>
);

// ---------------------- Game ----------------------
function DotAndBloom() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [running, setRunning] = useState(true);
  const [score, setScore] = useState(0);
  const [best, setBest] = useLocalStorage("dotbloom_best", 0);
  const [strikes, setStrikes] = useState(0);
  const [message, setMessage] = useState("Click to plant a bloom ✿");
  const [shake, setShake] = useState(false);

  const palette = useMemo(() => dailyPalette(), []);

  // Blooms state stored outside React for perf; React only mirrors counters/UI
  const simRef = useRef({
    blooms: /** @type {Array<{x:number,y:number,r:number,growing:boolean,color:string,pulse:number}>} */ ([]),
    width: 800,
    height: 600,
    lastTs: 0,
    speed: 60, // px per second
  });

  // Resize canvas to container
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = containerRef.current;
    if (!canvas || !box) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = box.getBoundingClientRect();
      const w = Math.max(360, Math.floor(rect.width));
      const h = Math.max(420, Math.floor(Math.min(rect.height, window.innerHeight * 0.8)));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      const sim = simRef.current;
      sim.width = canvas.width;
      sim.height = canvas.height;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Animation loop
  useEffect(() => {
    let raf;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (ts) => {
      const sim = simRef.current;
      const delta = sim.lastTs ? Math.min(0.05, (ts - sim.lastTs) / 1000) : 0;
      sim.lastTs = ts;

      // Update
      if (running) {
        for (let i = 0; i < sim.blooms.length; i++) {
          const b = sim.blooms[i];
          if (!b.growing) continue;
          const maxGrowth = availableGrowth(sim, i);
          const grow = Math.min(maxGrowth, sim.speed * delta);
          b.r += grow;
          b.pulse = (b.pulse + delta) % 1;
          if (grow < 0.001) {
            // locked
            b.growing = false;
            const base = Math.round(Math.max(1, b.r / 2));
            setScore((s) => s + base);
            setMessage("Nice placement! ✨ +" + base);
          }
        }
      }

      // Clear bg
      ctx.save();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--game-bg") || "#f9fafb";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Draw subtle grid
      drawSubtleGrid(ctx, canvas.width, canvas.height);

      // Draw blooms
      for (const b of sim.blooms) drawBloom(ctx, b);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // Click to plant
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const sim = simRef.current;

      // Prevent placing inside an existing bloom
      for (const b of sim.blooms) {
        const dx = x - b.x;
        const dy = y - b.y;
        if (Math.hypot(dx, dy) <= b.r + 1) {
          setStrikes((st) => st + 1);
          setMessage("Too close! Strike ✖");
          setShake(true);
          setTimeout(() => setShake(false), 180);
          return;
        }
      }

      // Create new bloom
      const color = pickBloomColor(palette);
      sim.blooms.push({ x, y, r: 1, growing: true, color, pulse: 0 });
      setMessage("Bloom planted ✿");
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [palette]);

  // End game on 3 strikes
  useEffect(() => {
    if (strikes >= 3) {
      setRunning(false);
      setMessage("Game over · 3 strikes");
      setBest((b) => (score > b ? score : b));
    }
  }, [strikes, score, setBest]);

  // Update best on any improvement
  useEffect(() => {
    setBest((b) => (score > b ? score : b));
  }, [score, setBest]);

  const reset = () => {
    simRef.current.blooms = [];
    simRef.current.lastTs = 0;
    setScore(0);
    setStrikes(0);
    setRunning(true);
    setMessage("New game — click to plant ✿");
  };

  const share = async () => {
    const text = `Dot and Bloom — I scored ${score} (best ${best}). Try to beat me! ✿`;
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setMessage("Copied a share message! ✨");
    } catch {}
  };

  // CSS var for bg
  useEffect(() => {
    document.documentElement.style.setProperty("--game-bg", palette.bg);
  }, [palette.bg]);

  return (
    <UI>
      <div className="grid gap-4">
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Dot and Bloom</h1>
            <p className="text-sm opacity-70">A minimalist growth game · Daily palette</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setRunning((r) => !r)} className="px-3 py-2 rounded-2xl shadow-sm border hover:shadow transition">
              {running ? "Pause" : "Resume"}
            </button>
            <button onClick={reset} className="px-3 py-2 rounded-2xl shadow-sm border hover:shadow transition">
              Reset
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Score" value={score} />
          <Stat label="Best" value={best} />
          <Stat label="Strikes" value={`${strikes}/3`} warn={strikes > 0} />
          <button onClick={share} className="px-3 py-2 rounded-2xl shadow-sm border hover:shadow transition">Share</button>
        </section>

        <div
          ref={containerRef}
          className={`rounded-3xl shadow-inner border overflow-hidden ${shake ? "animate-[shake_0.18s_ease-in-out]" : ""}`}
          style={{ borderRadius: 24 }}
        >
          <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
        </div>

        <footer className="flex items-center justify-between text-sm opacity-80">
          <span>{message}</span>
          <PaletteSwatch colors={palette.blooms} />
        </footer>
      </div>

      <style>{`
        @keyframes shake { 10%{ transform: translateX(-2px);} 30%{ transform: translateX(3px);} 50%{ transform: translateX(-2px);} 70%{ transform: translateX(2px);} 90%{ transform: translateX(-1px);} }
      `}</style>
    </UI>
  );
}

// ---------------------- UI Bits ----------------------
function Stat({ label, value, warn }) {
  return (
    <div className={`px-3 py-2 rounded-2xl border shadow-sm ${warn ? "bg-red-50" : "bg-white/70"}`}>
      <div className="text-xs opacity-60">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function PaletteSwatch({ colors }) {
  return (
    <div className="flex items-center gap-1">
      {colors.map((c, i) => (
        <span key={i} title={c} className="inline-block w-5 h-5 rounded-full border" style={{ background: c }} />
      ))}
    </div>
  );
}

// ---------------------- Rendering Helpers ----------------------
function pickBloomColor(palette) {
  const list = palette.blooms;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

function drawSubtleGrid(ctx, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.08;
  const step = 32;
  ctx.beginPath();
  for (let x = 0; x < w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y < h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawBloom(ctx, b) {
  ctx.save();
  // Glow
  ctx.beginPath();
  ctx.arc(b.x, b.y, Math.max(0, b.r + 6 + Math.sin(b.pulse * Math.PI * 2) * 2), 0, Math.PI * 2);
  ctx.fillStyle = b.color;
  ctx.globalAlpha = 0.18;
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.arc(b.x, b.y, Math.max(0, b.r), 0, Math.PI * 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = b.color;
  ctx.fill();

  // Outline
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.stroke();
  ctx.restore();
}

function availableGrowth(sim, idx) {
  // How much this bloom can grow before touching something
  const b = sim.blooms[idx];
  // Distance to walls (convert to CSS px; transform set to dpr in resize)
  const toLeft = b.x - 1;
  const toRight = sim.width / (window.devicePixelRatio || 1) - b.x - 1;
  const toTop = b.y - 1;
  const toBottom = sim.height / (window.devicePixelRatio || 1) - b.y - 1;
  let limit = Math.max(0, Math.min(toLeft, toRight, toTop, toBottom) - b.r);

  // Distance to other blooms
  for (let j = 0; j < sim.blooms.length; j++) {
    if (j === idx) continue;
    const o = sim.blooms[j];
    const dx = b.x - o.x;
    const dy = b.y - o.y;
    const d = Math.hypot(dx, dy);
    const gap = d - (b.r + o.r) - 0.5; // small epsilon
    if (gap < limit) limit = Math.max(0, gap);
  }
  return limit;
}

// ---------------------- App Root ----------------------
export default function App() {
  return <DotAndBloom />;
}
