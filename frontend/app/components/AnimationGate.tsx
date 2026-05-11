"use client";

import { useEffect } from "react";

export function AnimationGate() {
  useEffect(() => {
    const root = document.documentElement;
    const start = () => root.setAttribute("data-ready", "");
    if (document.fonts?.ready) {
      let done = false;
      const fire = () => {
        if (done) return;
        done = true;
        start();
      };
      document.fonts.ready.then(fire);
      // Fallback so we never strand the page if fonts stall.
      setTimeout(fire, 600);
    } else {
      start();
    }
  }, []);
  return null;
}
