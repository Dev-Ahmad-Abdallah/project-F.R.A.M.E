import { useState, useEffect, useRef } from 'react';

export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = () => {
      // Debounce resize events to prevent flickering on mobile
      // (keyboard open/close, orientation change fire rapid resize events)
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setIsMobile(window.innerWidth < breakpoint);
      }, 100);
    };
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('resize', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [breakpoint]);

  return isMobile;
}
