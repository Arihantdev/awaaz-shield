"""Seed Firestore with realistic sample calls for Awaaz Shield.

Run from the backend folder (venv active):
    python seed_firestore.py --dry-run          # just print what would be written
    python seed_firestore.py                    # write to Firestore (needs Firestore enabled in the console)
    python seed_firestore.py --json seed.json   # also dump everything to a JSON file

Every transcript is run through the app's REAL scorer (heuristic, or Claude if ANTHROPIC_API_KEY is set),
so scores / levels / alerts / matched patterns are consistent with what the live app produces.
Document IDs are fixed (seed-01 ... seed-07), so re-running overwrites instead of duplicating.
All names, numbers and amounts below are fictional.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.models import TranscriptChunk
from app.store import CallStore

# Building the sample calls goes through the app's store, which would otherwise ALSO save them to Firestore
# under random IDs. Turn that off - this script writes the (fixed-ID) documents itself.
settings.FIRESTORE_ENABLED = False

OWNER_UID = "seed-operator"
OWNER_EMAIL = "demo.operator@example.com"

# (id, label, source, hours_ago, [(speaker, text)...], disposition, operator note)
SAMPLES = [
    ("seed-01", "Fake bank official - KYC + OTP", "simulated", 2, [
        ("agent", "Hello?"),
        ("caller", "Sir this is from the bank, your account will be blocked today. This is a KYC update, it is urgent."),
        ("agent", "I did my KYC last year."),
        ("caller", "System shows pending. Please share the otp sent to your phone right now, do not disconnect the call."),
    ], "escalated", "Sent to fraud desk; customer told to block card."),
    ("seed-02", "Digital arrest - police impersonation", "simulated", 5, [
        ("caller", "This is the cyber crime department. You are under investigation and there is a non-bailable warrant in your name."),
        ("agent", "What? I haven't done anything."),
        ("caller", "This is your last warning. Do not tell anyone about this call. You must stay on video call, this is digital arrest."),
        ("caller", "To clear your name transfer the amount to the safe account immediately."),
    ], "escalated", "Classic digital-arrest script. Advised caller to hang up and call 1930."),
    ("seed-03", "Courier / customs parcel scam", "simulated", 26, [
        ("caller", "This is FedEx customs department. Your parcel has been seized, there are illegal items in your parcel."),
        ("agent", "I did not send any parcel."),
        ("caller", "Pay the processing fee today or police will act. Act immediately."),
    ], "flagged", "Customer did not pay. Number blocked."),
    ("seed-04", "Hinglish KYC - OTP bata do", "simulated", 30, [
        ("caller", "Sir mujhe bank se bol raha hoon, aapka kyc pending hai."),
        ("caller", "Nahi kiya toh account block ho jayega, abhi otp bata do."),
        ("agent", "Main branch jaake karunga."),
        ("caller", "Kisi ko mat batana, call mat kaato."),
    ], "escalated", "Hindi/Hinglish pattern hit. OTP not shared."),
    ("seed-05", "Lottery prize + remote access", "simulated", 52, [
        ("caller", "Congratulations you have won a prize. Please claim your prize today."),
        ("agent", "Which lottery is this?"),
        ("caller", "Just install anydesk and I will help you claim, then pay the processing fee."),
    ], "flagged", ""),
    ("seed-06", "Genuine bank call - no sensitive asks", "simulated", 70, [
        ("caller", "Good afternoon, this is a service call from your branch about your new cheque book."),
        ("agent", "Okay, when will it arrive?"),
        ("caller", "It will be delivered in three working days. You can verify this by calling the number on the back of your card."),
    ], "dismissed", "Legitimate call. False-positive check passed (score stayed low)."),
    ("seed-07", "Ambiguous - KYC mention only", "simulated", 96, [
        ("caller", "Hi, this is a reminder that your kyc update is due next month."),
        ("agent", "Thanks, I will visit the branch."),
    ], "", ""),
]


def build_calls():
    """Run every sample through the real pipeline and return plain dicts ready for Firestore."""
    now = datetime.now(timezone.utc)
    out = []
    for cid, label, source, hours_ago, lines, disposition, note in SAMPLES:
        store = CallStore()
        call = store.create_call(label, source)
        start = now - timedelta(hours=hours_ago)
        call.started_at = start.isoformat()
        alert_seen = 0
        for i, (speaker, text) in enumerate(lines):
            ts = (start + timedelta(seconds=25 * (i + 1))).isoformat()
            store.add_transcript_and_score(call.id, TranscriptChunk(speaker=speaker, text=text, ts=ts))
            call.risk_history[-1].ts = ts
            for a in call.alerts[alert_seen:]:
                a.ts = ts
            alert_seen = len(call.alerts)
        end = start + timedelta(seconds=25 * (len(lines) + 2))
        call.status, call.ended_at = "ended", end.isoformat()
        if disposition:
            store.record_action(call.id, disposition, note)
            call.actions[-1].ts = (end + timedelta(minutes=2)).isoformat()
            call.actions[-1].call_id = cid

        patterns = sorted({p for a in call.alerts for p in a.matched_patterns} | set(_all_patterns(call)))
        doc = {
            "label": call.label, "source": call.source, "status": "ended",
            "started_at": start, "ended_at": end,
            "owner_uid": OWNER_UID, "owner_email": OWNER_EMAIL,
            "current_score": call.current_score,
            "max_score": max(p.score for p in call.risk_history),
            "current_level": call.current_level.value,
            "scorer": call.scorer,
            "last_explanation": call.last_explanation,
            "matched_patterns": patterns,
            "alert_count": len(call.alerts),
            "disposition": disposition or None,
            "is_seed": True,
        }
        out.append({
            "id": cid, "doc": doc,
            "transcript": [{"id": t.id, "speaker": t.speaker.value, "text": t.text, "ts": _dt(t.ts)} for t in call.transcript],
            "alerts": [{"id": a.id, "level": a.level.value, "message": a.message,
                        "matched_patterns": a.matched_patterns, "ts": _dt(a.ts)} for a in call.alerts],
            "actions": [{"id": a.id, "type": a.type, "note": a.note, "by_uid": OWNER_UID, "ts": _dt(a.ts)} for a in call.actions],
            "risk_history": [{"id": f"p{i:02d}", "score": p.score, "ts": _dt(p.ts)} for i, p in enumerate(call.risk_history)],
        })
    return out


def _all_patterns(call):
    from app.risk.heuristic import score_transcript
    return score_transcript(" ".join(t.text for t in call.transcript)).matched_patterns


def _dt(iso):
    return datetime.fromisoformat(iso)


def _jsonable(o):
    if isinstance(o, datetime):
        return o.isoformat()
    raise TypeError(type(o))


def write_to_firestore(calls):
    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.api_core import exceptions as gexc

    path = settings.FIREBASE_SERVICE_ACCOUNT_PATH
    if not os.path.exists(path):
        sys.exit(f"[!!] service account not found at {path}")
    app = firebase_admin.initialize_app(credentials.Certificate(path))
    db = firestore.client(app)
    project = app.project_id

    def commit_with_retry(batch, call_id):
        """A cold gRPC connection often fails once (UNAVAILABLE) and works on the next try. Writes are
        idempotent (fixed doc IDs), so retrying is safe. 5 attempts, 20s each, backing off 2/4/6/8s."""
        for attempt in range(1, 6):
            try:
                batch.commit(retry=None, timeout=20)
                return
            except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
                if attempt == 5:
                    raise
                wait = 2 * attempt
                print(f"[..] calls/{call_id}: attempt {attempt} failed ({type(e).__name__}), retrying in {wait}s...")
                time.sleep(wait)

    try:
        for c in calls:
            ref = db.collection("calls").document(c["id"])
            batch = db.batch()
            batch.set(ref, c["doc"])
            for sub in ("transcript", "alerts", "actions", "risk_history"):
                for item in c[sub]:
                    data = {k: v for k, v in item.items() if k != "id"}
                    batch.set(ref.collection(sub).document(item["id"]), data)
            commit_with_retry(batch, c["id"])
            print(f"[ok] wrote calls/{c['id']}  ({c['doc']['current_level']}, score {c['doc']['current_score']})")
    except gexc.NotFound:
        sys.exit(f"\n[!!] Firestore database not found for project '{project}'.\n"
                 "     Firebase console -> Build -> Firestore Database -> Create database (then re-run).")
    except gexc.PermissionDenied as e:
        sys.exit(f"\n[!!] Permission denied: {e.message}\n"
                 "     Enable the 'Cloud Firestore API' for this project (Google Cloud console -> APIs & Services),\n"
                 "     and make sure the Firestore database exists.")
    except (gexc.DeadlineExceeded, gexc.ServiceUnavailable) as e:
        sys.exit(f"\n[!!] Could not reach Firestore after 5 attempts ({type(e).__name__}).\n"
                 f"     Details: {getattr(e, 'message', e)}\n"
                 "     Check your internet/VPN/firewall (firestore.googleapis.com), then re-run. Calls already\n"
                 "     written are kept; re-running is safe.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print only, do not write")
    ap.add_argument("--json", metavar="FILE", help="also dump the data to a JSON file")
    args = ap.parse_args()

    calls = build_calls()
    print(f"Scorer: {settings.status()['scoring_backend']}\n")
    print(f"{'id':<9}{'level':<10}{'score':<7}{'alerts':<8}{'disposition':<12}label")
    for c in calls:
        d = c["doc"]
        print(f"{c['id']:<9}{d['current_level']:<10}{d['current_score']:<7}{d['alert_count']:<8}{(d['disposition'] or '-'):<12}{d['label']}")

    if args.json:
        with open(args.json, "w") as f:
            json.dump(calls, f, indent=2, default=_jsonable, ensure_ascii=False)
        print(f"\n[ok] wrote {args.json}")
    if args.dry_run:
        print("\n(dry run - nothing written to Firestore)")
        return
    print()
    write_to_firestore(calls)
    print("\nDone. Open Firebase console -> Firestore Database -> calls.")


if __name__ == "__main__":
    main()
