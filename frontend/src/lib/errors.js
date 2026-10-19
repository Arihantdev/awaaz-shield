/**
 * Turns whatever a failed request threw into one actionable sentence for the operator.
 * `t` is the i18n translate function. The raw technical message is never shown for network/server faults.
 */
export function friendlyError(t, err) {
  const status = err?.status;
  if (status === 401) return t("err.session");
  if (status === 404) return t("err.notFound");
  if (typeof status === "number" && status >= 500) return t("err.server");
  // fetch() rejects with a TypeError when the server cannot be reached at all
  if (err instanceof TypeError) return t("err.network");
  return err?.message ? String(err.message) : t("err.unknown");
}
