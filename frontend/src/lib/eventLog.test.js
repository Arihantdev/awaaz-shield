import { describe, expect, it } from "vitest";
import { buildEventLog } from "./eventLog";

const call = {
  id: "c1", label: "Call A", source: "voice", started_at: "2026-01-01T10:00:00Z", ended_at: "2026-01-01T10:05:00Z", current_score: 80,
  transcript: [{ id: "t1", speaker: "caller", text: "share your OTP", ts: "2026-01-01T10:01:00Z" }],
  alerts: [{ id: "a1", level: "critical", ts: "2026-01-01T10:02:00Z", signals: ["otp_request"], message: "Critical" }],
  actions: [{ id: "x1", type: "flagged", note: "", ts: "2026-01-01T10:03:00Z" }],
};

describe("buildEventLog", () => {
  it("orders every kind of event by time", () => {
    expect(buildEventLog([call]).map((e) => e.type)).toEqual(["call_started", "transcript", "alert", "operator_action", "call_ended"]);
  });
  it("maps alert level to log level and keeps signals", () => {
    const a = buildEventLog([call]).find((e) => e.type === "alert");
    expect(a.level).toBe("critical");
    expect(a.signals).toEqual(["otp_request"]);
  });
  it("returns an empty list for no calls and tolerates missing arrays", () => {
    expect(buildEventLog([])).toEqual([]);
    expect(buildEventLog(null)).toEqual([]);
    expect(buildEventLog([{ id: "c2", label: "B", started_at: "2026-01-01T10:00:00Z" }])).toHaveLength(1);
  });
  it("keeps only the newest events when over the limit", () => {
    const calls = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, label: `L${i}`, started_at: `2026-01-01T10:0${i}:00Z` }));
    expect(buildEventLog(calls, 2).map((e) => e.call)).toEqual(["L3", "L4"]);
  });
});
