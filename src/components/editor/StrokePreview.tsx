import { useEffect, useRef } from 'react';
import { drawStroke } from '../../lib/renderer';
import type { InkPoint, PenVariant, Stroke } from '../../lib/types';

interface StrokePreviewProps {
  variant: PenVariant;
  color: string;
  size: number;
  tool?: 'pen' | 'highlighter';
  className?: string;
}

function previewSeed(value: string): number {
  let seed = 17;
  for (let index = 0; index < value.length; index += 1) seed = (seed * 31 + value.charCodeAt(index)) >>> 0;
  return seed;
}

/**
 * Live ink sample for the brush picker. It deliberately goes through the same
 * drawStroke renderer as the canvas, so pencil grain, crayon texture and brush
 * taper are honest previews rather than colour swatches.
 */
export function StrokePreview({ variant, color, size, tool = 'pen', className }: StrokePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;

    const paint = (): void => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(32, rect.width || canvas.clientWidth || 54);
      const height = Math.max(24, rect.height || canvas.clientHeight || 54);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const points: InkPoint[] = [];
      const steps = 38;
      const amplitude = height * 0.26;
      for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const pressure = tool === 'highlighter' ? 0.55 : 0.22 + Math.sin(t * Math.PI) * 0.72;
        points.push({
          x: 7 + t * (width - 14),
          y: height / 2 + Math.sin(t * Math.PI * 2) * amplitude,
          p: pressure,
        });
      }
      const previewSize = tool === 'highlighter' ? Math.min(15, Math.max(8, size * 0.48)) : Math.min(11, Math.max(3.4, size * 0.9));
      const stroke: Stroke = {
        id: 'preview',
        tool,
        variant: tool === 'highlighter' ? 'highlighter' : variant,
        color,
        size: previewSize,
        opacity: tool === 'highlighter' ? 0.4 : 1,
        points,
        seed: previewSeed(`${variant}-${tool}-${color}`),
        createdAt: 1,
      };
      drawStroke(ctx, stroke);
    };

    const schedule = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(paint);
    };
    schedule();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(canvas);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [color, size, tool, variant]);

  return <canvas ref={canvasRef} className={className ? `stroke-preview ${className}` : 'stroke-preview'} aria-hidden="true" />;
}
