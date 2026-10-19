import { LinearSRGBColorSpace, SRGBColorSpace } from "three";
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from "postprocessing";

/**
 * Subtle glow for the login shield. Owned by useScene (single render loop, single resize path,
 * single dispose). Pure visual: reads nothing, writes nothing, never touches risk values.
 * Users can switch it off for comparison with: localStorage.setItem("awaaz.bloom", "off")
 */
export function bloomEnabled() {
  try {
    return localStorage.getItem("awaaz.bloom") !== "off";
  } catch {
    return true;
  }
}

function forced() {
  try {
    return localStorage.getItem("awaaz.bloom") === "force"; // skip the adaptive fallback (testing)
  } catch {
    return false;
  }
}

export function createBloom(renderer, scene, camera) {
  if (!bloomEnabled()) return null;
  // The orb shaders write display-ready colours, so keep the final pass from re-encoding them.
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // glow does not need 2x pixels
  const composer = new EffectComposer(renderer, { alpha: true, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({
    intensity: 0.2,
    luminanceThreshold: 0.45,
    luminanceSmoothing: 0.3,
    mipmapBlur: true,
    radius: 0.55,
    resolutionScale: 0.5, // blur at half resolution: the glow is soft anyway
  });
  composer.addPass(new EffectPass(camera, bloom));
  // Adaptive safety net: if the first ~90 frames average slower than ~30 fps (weak/software GPU),
  // drop the glow and render plainly. useScene checks `active` every frame.
  const state = { active: true, frames: 0, total: 0, last: 0 };
  return {
    get active() {
      return state.active;
    },
    render(dt) {
      composer.render(dt);
      if (forced() || state.frames >= 90) return;
      const now = performance.now();
      if (state.last) {
        state.total += now - state.last;
        state.frames += 1;
        if (state.frames === 90 && state.total / 90 > 34) {
          state.active = false;
          renderer.outputColorSpace = SRGBColorSpace;
        }
      }
      state.last = now;
    },
    setSize: (w, h) => composer.setSize(w, h, false),
    dispose: () => composer.dispose(), // disposes passes, effects and render targets
  };
}
