// Seven scripted demo calls (all names, numbers and amounts are fictional; same scripts as backend/seed_firestore.py).
// They are replayed through the real API, so every score, level and alert comes from the backend's scoring engine.
export const SAMPLE_PREFIX = "Sample · ";

export const SAMPLE_CALLS = [
  { label: "Fake bank official, KYC + OTP", disposition: "escalated", note: "Sent to fraud desk; customer told to block card.", lines: [
    ["agent", "Hello?"],
    ["caller", "Sir this is from the bank, your account will be blocked today. This is a KYC update, it is urgent."],
    ["agent", "I did my KYC last year."],
    ["caller", "System shows pending. Please share the otp sent to your phone right now, do not disconnect the call."],
  ] },
  { label: "Digital arrest, police impersonation", disposition: "escalated", note: "Classic digital-arrest script. Advised caller to hang up and call 1930.", lines: [
    ["caller", "This is the cyber crime department. You are under investigation and there is a non-bailable warrant in your name."],
    ["agent", "What? I haven't done anything."],
    ["caller", "This is your last warning. Do not tell anyone about this call. You must stay on video call, this is digital arrest."],
    ["caller", "To clear your name transfer the amount to the safe account immediately."],
  ] },
  { label: "Bank verification, asks for OTP", disposition: "flagged", note: "Caller named a bank and asked for the OTP. Worth a callback.", lines: [
    ["caller", "Hi, this is from HDFC bank. Please tell me the OTP which has come on your mobile."],
  ] },
  { label: "Refund via UPI PIN", disposition: "", note: "", lines: [
    ["caller", "Hello, I am calling from Amazon about a refund of five thousand rupees, please enter your UPI PIN to receive the money."],
    ["agent", "Which order is this for?"],
  ] },
  { label: "Hinglish KYC, early warning", disposition: "", note: "", lines: [
    ["caller", "Sir mujhe bank se bol raha hoon, aapka kyc pending hai."],
    ["agent", "Main branch jaake karunga."],
  ] },
  { label: "Courier parcel, customs threat", disposition: "flagged", note: "Customer did not pay. Number blocked.", lines: [
    ["caller", "Your parcel has been seized at the customs department. Act immediately."],
    ["agent", "I did not send any parcel."],
  ] },
  { label: "Genuine bank call, no sensitive asks", disposition: "dismissed", note: "Legitimate call. False-positive check passed.", lines: [
    ["caller", "Good afternoon, this is a service call from your branch about your new cheque book."],
    ["agent", "Okay, when will it arrive?"],
    ["caller", "It will be delivered in three working days. You can verify this by calling the number on the back of your card."],
  ] },
];

/** Replays the samples through the real API, one call at a time. `api` is the app's api object. */
export async function loadSampleCalls(api, existingLabels = []) {
  const have = new Set(existingLabels);
  let created = 0;
  const order = [...SAMPLE_CALLS].sort(() => Math.random() - 0.5); // different mix of levels in the list each time
  for (const s of order) {
    const label = SAMPLE_PREFIX + s.label;
    if (have.has(label)) continue;
    const call = await api.createCall(label, "simulated");
    for (const [speaker, text] of s.lines) await api.ingest(call.id, text, speaker);
    await api.endCall(call.id);
    if (s.disposition) await api.recordAction(call.id, s.disposition, s.note);
    created += 1;
  }
  return created;
}
