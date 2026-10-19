import { lazy, Suspense } from "react";

// three.js is large, so the shield scene is fetched only when a monitor screen actually shows it.
const ShieldCore = lazy(() => import("./ShieldCore"));

export default function LazyShieldCore(props) {
  return (
    <Suspense fallback={<div className="shield-core" aria-hidden="true" />}>
      <ShieldCore {...props} />
    </Suspense>
  );
}
