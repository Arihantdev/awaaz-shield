import { lazy, Suspense } from "react";

const WaveBackdrop = lazy(() => import("./WaveBackdrop"));

export default function LazyWaveBackdrop(props) {
  return (
    <Suspense fallback={null}>
      <WaveBackdrop {...props} />
    </Suspense>
  );
}
