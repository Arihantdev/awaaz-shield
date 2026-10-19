import gsap from "gsap";

/** Threat-detected choreography: border pulse, staggered card edge flash, warning panel reveal. */
export function playThreatFx({ frame, cards = [], panel }) {
  const tl = gsap.timeline();
  if (frame) {
    tl.fromTo(frame, { opacity: 0 }, { opacity: 0.8, duration: 0.18, repeat: 3, yoyo: true, ease: "sine.inOut" }, 0)
      .to(frame, { opacity: 0, duration: 0.8, ease: "sine.inOut" });
  }
  if (cards.length) {
    tl.fromTo(cards, { opacity: 0 }, { opacity: 1, duration: 0.25, stagger: 0.1, yoyo: true, repeat: 1, ease: "power1.inOut" }, 0.15)
      .set(cards, { opacity: 0 });
  }
  if (panel) {
    tl.fromTo(panel, { scale: 0.985, transformOrigin: "50% 0%" }, { scale: 1, duration: 0.5, ease: "power3.out" }, 0);
    // The warning content mounts a moment after the alert arrives, so look it up when this step runs.
    tl.call(() => {
      const items = panel.querySelectorAll("[data-fx]");
      if (items.length) gsap.fromTo(items, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.06, ease: "power2.out" });
    }, null, 0.3);
  }
  return tl;
}

/** Staggered entrance for freshly appended event lines. */
export function animateNewLines(els) {
  if (!els.length) return;
  gsap.fromTo(
    els,
    { opacity: 0, x: -8, backgroundColor: "rgba(255,106,61,0.12)" },
    { opacity: 1, x: 0, backgroundColor: "rgba(255,106,61,0)", duration: 0.5, stagger: 0.06, ease: "power3.out", overwrite: "auto" },
  );
}
