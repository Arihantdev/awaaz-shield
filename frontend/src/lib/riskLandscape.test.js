import { describe, expect, it } from "vitest";
import { buildLandscape, COLS, resampleSeries, RIDGES } from "./riskLandscape";

describe("resampleSeries", () => {
  it("keeps endpoints and interpolates between them", () => {
    const r = resampleSeries([0, 1], 5);
    expect(Array.from(r)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it("fills a single reading flat and an empty series with zeros", () => {
    expect(Array.from(resampleSeries([0.4], 3))).toEqual([expect.closeTo(0.4), expect.closeTo(0.4), expect.closeTo(0.4)]);
    expect(Array.from(resampleSeries([], 3))).toEqual([0, 0, 0]);
  });
});

describe("buildLandscape", () => {
  const calls = [
    { id: "b", started_at: "2026-01-01T10:10:00Z", current_level: "high", risk_history: [{ score: 20 }, { score: 90 }] },
    { id: "a", started_at: "2026-01-01T10:00:00Z", current_level: "low", risk_history: [], current_score: 10 },
  ];
  it("puts the newest call in the front row and pads empty rows at the back", () => {
    const l = buildLandscape(calls, "b");
    expect(l.count).toBe(2);
    expect(l.levels[RIDGES - 1]).toBe("high");
    expect(l.levels[RIDGES - 2]).toBe("low");
    expect(l.levels[0]).toBeNull();
    expect(l.selectedRow).toBe(RIDGES - 1);
    expect(l.heights[(RIDGES - 1) * COLS + COLS - 1]).toBeCloseTo(0.9);
    expect(l.heights[(RIDGES - 2) * COLS]).toBeCloseTo(0.1);
  });
  it("has no selection without a selected id and handles no calls", () => {
    expect(buildLandscape(calls, null).selectedRow).toBe(-1);
    expect(buildLandscape([], null).count).toBe(0);
  });
});
