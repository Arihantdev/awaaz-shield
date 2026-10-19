// Android wrapper settings. Two ways to use it (see MOBILE.md):
//
//  A) RECOMMENDED: point the app at your deployed Awaaz Shield address, so the page, the API and the call sockets all
//     share one origin (sign-in cookie just works):   CAP_SERVER_URL=https://your-app.example.com npm run sync
//  B) Bundled: leave CAP_SERVER_URL unset. The page is packaged inside the app and talks to a separately hosted backend
//     (build the web app with VITE_API_BASE_URL set; the backend then needs CORS_ORIGINS to include https://localhost
//     and COOKIE_SAMESITE=none).
const serverUrl = (process.env.CAP_SERVER_URL || "").trim().replace(/\/+$/, "");
if (serverUrl && !/^https:\/\//.test(serverUrl)) {
  throw new Error("CAP_SERVER_URL must start with https:// (the microphone only works on a secure address).");
}

module.exports = {
  appId: "com.awaazshield.app",
  appName: "Awaaz Shield",
  webDir: "../frontend/dist",
  backgroundColor: "#131315",
  server: serverUrl
    ? { url: serverUrl, androidScheme: "https", cleartext: false, allowNavigation: [new URL(serverUrl).host] }
    : { androidScheme: "https", cleartext: false },
  android: { allowMixedContent: false },
};
