"""Measure the risk scorer on the labelled calls in eval/risk_cases.py.

    python eval_risk.py                 # dev + holdout, summary and every failure
    python eval_risk.py --set dev       # one set
    python eval_risk.py --verbose       # also print every case

The scorer is fed the call line by line, exactly as the live app does, and the FINAL score is judged
against the band for the case's kind. Also reported: how many scams raised a high-risk alert at all and on
which line, whether any score ever went DOWN while a call progressed, and how many benign or ambiguous
calls raised a false high-risk alert.
"""
import argparse
import os

os.environ.setdefault("FIREBASE_ENABLED", "false")
os.environ["ANTHROPIC_API_KEY"] = ""  # always measure the offline scorer

from app.models import TranscriptChunk  # noqa: E402
from app.risk import heuristic  # noqa: E402
from eval.risk_cases import BANDS, DEV, FRESH, HOLDOUT, REALISTIC, REALISTIC2  # noqa: E402


def run_call(turns):
    """Score progressively, like the live pipeline. Returns the list of scores after each line."""
    scores, seen = [], set()
    chunks = []
    for speaker, text in turns:
        chunks.append(TranscriptChunk(speaker=speaker, text=text))
        if hasattr(heuristic, "score_turns"):
            a = heuristic.score_turns(chunks, seen)
        else:  # baseline: what the app did before (everything joined, no speakers)
            a = heuristic.score_transcript(" ".join(c.text for c in chunks), seen)
        seen |= set(a.matched_patterns)
        scores.append(a.score)
    return scores


def evaluate(cases, verbose=False):
    rows, fails = [], []
    for cid, kind, turns in cases:
        scores = run_call(turns)
        final = scores[-1]
        lo, hi = BANDS[kind]
        ok = lo <= final <= hi
        first_alert = next((i + 1 for i, s in enumerate(scores) if s >= 55), None)
        went_down = any(b < a for a, b in zip(scores, scores[1:]))
        rows.append((cid, kind, final, ok, first_alert, went_down, scores))
        if not ok:
            fails.append((cid, kind, final, f"{lo}-{hi}", scores))
        if verbose:
            print(f"  {'ok  ' if ok else 'FAIL'} {cid:34s} {kind:9s} final={final:3d} band={lo}-{hi} path={scores}")
    return rows, fails


def summarize(name, cases, rows, fails):
    scam = [r for r in rows if r[1] == "scam"]
    quiet = [r for r in rows if r[1] != "scam"]
    caught = sum(1 for r in scam if r[2] >= 55)
    false_alerts = sum(1 for r in quiet if r[2] >= 55)
    passed = sum(1 for r in rows if r[3])
    print(f"\n== {name}: {passed}/{len(rows)} calls land in their expected band ==")
    print(f"   scams raising a high-risk alert : {caught}/{len(scam)}")
    print(f"   benign/ambiguous false alerts   : {false_alerts}/{len(quiet)}")
    print(f"   calls where the score dropped   : {sum(1 for r in rows if r[5])}")
    for cid, kind, final, band, scores in fails:
        print(f"   FAIL {cid:34s} {kind:9s} final={final:3d} wanted {band:6s} path={scores}")
    return passed, len(rows), caught, len(scam), false_alerts, len(quiet)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=["dev", "holdout", "fresh", "realistic", "realistic2", "all"], default="all")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    failed = 0
    for name, cases in (("DEV (tuned on)", DEV), ("HOLDOUT (seen while fixing)", HOLDOUT), ("FRESH (run once, untuned)", FRESH), ("REALISTIC (STT-style, tuned after first run)", REALISTIC), ("REALISTIC2 (STT-style; first untuned run was 13/20, 4/10 scams, then tuned)", REALISTIC2)):
        if args.set == "dev" and not name.startswith("DEV"):
            continue
        if args.set == "holdout" and not name.startswith("HOLD"):
            continue
        if args.set == "fresh" and not name.startswith("FRESH"):
            continue
        if args.set == "realistic" and not name.startswith("REALISTIC ("):
            continue
        if args.set == "realistic2" and not name.startswith("REALISTIC2"):
            continue
        rows, fails = evaluate(cases, args.verbose)
        summarize(name, cases, rows, fails)
        failed += len(fails)
    raise SystemExit(1 if failed else 0)
