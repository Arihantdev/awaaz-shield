/**
 * Slow colour-shifting background. Three soft blobs drift behind the workspace; their colour follows the risk
 * level on screen (brand orange while idle, then green / gold / orange / red) and eases between levels.
 * Decorative only (aria-hidden, no pointer events); it reads the level it is given and never computes a score.
 */
export default function Ambient({ level = null }) {
  return (
    <div className="ambient" data-level={level || "idle"} aria-hidden="true">
      <i /><i /><i />
    </div>
  );
}
