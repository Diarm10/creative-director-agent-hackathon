// NEW FOR HACKATHON. A tiny canvas runner to play while a run is in progress. No dependencies.
// The player is the user's own SAM cut-out once it arrives (a placeholder square before). Never
// starts on its own, which also covers prefers-reduced-motion: nothing moves until Start is pressed.
// Space, Up or a tap jumps. Pauses when the tab is hidden; cancels its frame on unmount.
import { useCallback, useEffect, useRef, useState } from 'react';

const W = 600, H = 150, GROUND = 130, PLAYER = 34, GRAVITY = 0.0024, JUMP = 0.62;

type Phase = 'idle' | 'playing' | 'paused' | 'over';
interface World { y: number; vy: number; obstacles: { x: number; w: number; h: number }[]; speed: number; score: number; nextGap: number }

const freshWorld = (): World => ({ y: GROUND - PLAYER, vy: 0, obstacles: [], speed: 0.28, score: 0, nextGap: 260 });

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export default function WaitGame({ spriteB64 }: { spriteB64: string | null }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [best, setBest] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spriteRef = useRef<HTMLImageElement | null>(null);
  const worldRef = useRef<World>(freshWorld());
  const frameRef = useRef(0);
  const lastRef = useRef(0);
  const phaseRef = useRef<Phase>('idle');

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  useEffect(() => {
    if (!spriteB64) return;
    const img = new Image();
    img.onload = () => { spriteRef.current = img; draw(); };
    img.src = `data:image/png;base64,${spriteB64}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spriteB64]);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const w = worldRef.current;
    ctx.fillStyle = cssVar('--cm-bg', '#090909');
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = cssVar('--cm-border-strong', 'rgba(255,255,255,0.13)');
    ctx.fillRect(0, GROUND, W, 1);
    ctx.fillStyle = cssVar('--cm-accent', '#E05A30');
    for (const o of w.obstacles) ctx.fillRect(o.x, GROUND - o.h, o.w, o.h);
    const sprite = spriteRef.current;
    if (sprite) {
      const scale = PLAYER / Math.max(sprite.width, sprite.height);
      const sw = sprite.width * scale, sh = sprite.height * scale;
      ctx.drawImage(sprite, 40 + (PLAYER - sw) / 2, w.y + (PLAYER - sh), sw, sh);
    } else {
      ctx.strokeStyle = cssVar('--cm-text-secondary', '#888880');
      ctx.strokeRect(40.5, w.y + 0.5, PLAYER - 1, PLAYER - 1);
    }
    ctx.fillStyle = cssVar('--cm-text-secondary', '#888880');
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText(`Score ${Math.floor(w.score)}`, W - 90, 20);
  }, []);

  const tick = useCallback((t: number) => {
    const dt = Math.min(32, t - (lastRef.current || t));
    lastRef.current = t;
    const w = worldRef.current;
    w.vy += GRAVITY * dt;
    w.y = Math.min(GROUND - PLAYER, w.y + w.vy * dt);
    if (w.y >= GROUND - PLAYER) w.vy = 0;
    w.speed = Math.min(0.6, w.speed + dt * 0.000004);
    w.score += dt / 100;
    for (const o of w.obstacles) o.x -= w.speed * dt;
    w.obstacles = w.obstacles.filter((o) => o.x + o.w > 0);
    const last = w.obstacles[w.obstacles.length - 1];
    if (!last || W - last.x > w.nextGap) {
      w.obstacles.push({ x: W, w: 14 + Math.random() * 14, h: 18 + Math.random() * 22 });
      w.nextGap = 220 + Math.random() * 220;
    }
    // Small inset so near-misses feel fair.
    const hit = w.obstacles.some((o) => 40 + 5 < o.x + o.w && 40 + PLAYER - 5 > o.x && w.y + PLAYER - 4 > GROUND - o.h);
    draw();
    if (hit) {
      setBest((b) => Math.max(b, Math.floor(w.score)));
      setPhaseBoth('over');
      return;
    }
    frameRef.current = requestAnimationFrame(tick);
  }, [draw]);

  const run = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    lastRef.current = 0;
    setPhaseBoth('playing');
    frameRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const press = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'idle' || p === 'over') { worldRef.current = freshWorld(); run(); return; }
    if (p === 'paused') { run(); return; }
    const w = worldRef.current;
    if (w.y >= GROUND - PLAYER - 0.5) w.vy = -JUMP;
  }, [run]);

  useEffect(() => {
    if (!open) return;
    draw();
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (phaseRef.current === 'idle') return; // Start is an explicit button press
      e.preventDefault();
      press();
    };
    const onVisibility = () => {
      if (document.hidden && phaseRef.current === 'playing') {
        cancelAnimationFrame(frameRef.current);
        setPhaseBoth('paused');
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(frameRef.current);
      if (phaseRef.current === 'playing') setPhaseBoth('paused');
    };
  }, [open, draw, press]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  return (
    <div className="rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between bg-transparent px-4 py-2.5 text-left text-[13px] text-[var(--cm-text-secondary)]">
        <span>Play while you wait</span>
        <span className="text-[11px] text-[var(--cm-text-muted)]">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <canvas ref={canvasRef} width={W} height={H} onPointerDown={() => phaseRef.current !== 'idle' && press()}
            className="block h-auto w-full touch-manipulation rounded-lg" aria-label="Runner game. Press Start, then Space, Up or tap to jump." />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--cm-text-muted)]">
            {phase !== 'playing' && (
              <button className="btn-ghost" onClick={press}>{phase === 'paused' ? 'Resume' : phase === 'over' ? 'Play again' : 'Start'}</button>
            )}
            <span>{phase === 'over' ? 'Game over.' : 'Space, Up or tap to jump.'}</span>
            {best > 0 && <span className="ml-auto">Best {best}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
