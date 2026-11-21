import { useEffect, useRef } from 'react';
import { setFxRoot } from './dom';
import { fx } from './engine';

/**
 * Mount once at the app root: the front effects canvas, the overlay for stamped and
 * brushed callouts, and the SVG filter that roughens seal edges.
 */
export function FxStage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fx.attach('front', canvas.current);
    setFxRoot(dom.current);
    const onResize = () => fx.resize();
    const onVisibility = () => {
      if (document.hidden) fx.clear();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      fx.attach('front', null);
      setFxRoot(null);
    };
  }, []);

  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          {/* Uneven edges and a few pinholes, like ink pressed from a carved stone seal. */}
          <filter id="fx-rough" x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="4" result="warp" />
            <feDisplacementMap in="SourceGraphic" in2="warp" scale="5" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="11" result="grain" />
            <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -7 5.1" result="holes" />
            <feComposite in="rough" in2="holes" operator="in" />
          </filter>
        </defs>
      </svg>
      <canvas ref={canvas} className="fx-canvas front" aria-hidden="true" />
      <div ref={dom} className="fx-dom" aria-hidden="true" />
    </>
  );
}

/** The layer that sits on the felt, behind cards and seats (ink, brush strokes, dust). */
export function FxBackCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    fx.attach('back', canvas.current);
    return () => fx.attach('back', null);
  }, []);
  return <canvas ref={canvas} className="fx-canvas back" aria-hidden="true" />;
}
