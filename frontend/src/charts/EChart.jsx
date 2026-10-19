import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Tree-shaken ECharts: only what the Insights view uses.
echarts.use([BarChart, LineChart, PieChart, AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

export const COLORS = {
  low: "#5fb98a",
  medium: "#d9b04c",
  high: "#f0913f",
  critical: "#f0606a",
  text: "#aaa7a2",
  faint: "#8a8782",
  line: "#2e2e33",
  signal: "#ff6a3d",
  surface: "#1e1e21",
};

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function EChart({ option, height = 240, label, onClick }) {
  const el = useRef(null);
  const chart = useRef(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const c = echarts.init(el.current, null, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (p) => clickRef.current?.(p));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(
      {
        animation: !reduced(),
        textStyle: { fontFamily: "Instrument Sans Variable, system-ui, sans-serif", color: COLORS.text },
        aria: { enabled: true },
        tooltip: { backgroundColor: "#1e1e21", borderColor: "#3d3d43", textStyle: { color: "#f2efeb" } },
        ...option,
      },
      true
    );
  }, [option]);

  return <div ref={el} role="img" aria-label={label} style={{ width: "100%", height, cursor: onClick ? "pointer" : "default" }} />;
}
