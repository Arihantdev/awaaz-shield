import { describe, expect, it } from "vitest";
import { deriveActivity, isHighRisk, levelForScore } from "./risk";
import { friendlyError } from "./errors";

describe("levelForScore (mirrors backend level_for_score)", () => {
  it.each([
    [0, "low"], [29, "low"], [30, "medium"], [54, "medium"],
    [55, "high"], [79, "high"], [80, "critical"], [100, "critical"],
  ])("%i -> %s", (score, level) => expect(levelForScore(score)).toBe(level));

  it("flags only high and critical as high risk", () => {
    expect(["low", "medium", "high", "critical"].map(isHighRisk)).toEqual([false, false, true, true]);
  });
});

describe("deriveActivity", () => {
  const calls = [
    {
      id: "a", label: "Call A", started_at: "2026-10-13T10:00:00Z", ended_at: null,
      alerts: [{ id: "x1", level: "high", ts: "2026-10-13T10:05:00Z", signals: ["otp_request"] }],
      actions: [{ id: "y1", type: "flagged", note: "", ts: "2026-10-13T10:07:00Z" }],
    },
    { id: "b", label: "Call B", started_at: "2026-10-13T10:06:00Z", ended_at: "2026-10-13T10:08:00Z", alerts: [], actions: [] },
  ];

  it("returns real events newest first", () => {
    expect(deriveActivity(calls).map((e) => e.id)).toEqual(["b:end", "action:y1", "b:start", "alert:x1", "a:start"]);
  });

  it("respects the limit", () => {
    expect(deriveActivity(calls, 2)).toHaveLength(2);
  });

  it("is empty when there are no calls (no invented events)", () => {
    expect(deriveActivity([])).toEqual([]);
    expect(deriveActivity(undefined)).toEqual([]);
  });
});

describe("friendlyError", () => {
  const t = (k) => k;
  it("maps network failures, auth and server faults to actionable keys", () => {
    expect(friendlyError(t, new TypeError("Failed to fetch"))).toBe("err.network");
    expect(friendlyError(t, Object.assign(new Error("x"), { status: 401 }))).toBe("err.session");
    expect(friendlyError(t, Object.assign(new Error("boom"), { status: 500 }))).toBe("err.server");
  });
  it("keeps the backend's own detail for validation-style errors", () => {
    expect(friendlyError(t, Object.assign(new Error("Call not active"), { status: 409 }))).toBe("Call not active");
  });
});
