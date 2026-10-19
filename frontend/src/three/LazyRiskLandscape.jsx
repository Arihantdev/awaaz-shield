import { lazy, Suspense } from "react";

// three.js is large; the landscape is fetched only when the Command center is opened.
const RiskLandscape = lazy(() => import("./RiskLandscape"));

export default function LazyRiskLandscape(props) {
  return (
    <Suspense fallback={<div className="cc-3d" aria-hidden="true" />}>
      <RiskLandscape {...props} />
    </Suspense>
  );
}
