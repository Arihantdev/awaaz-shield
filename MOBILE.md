# Awaaz Shield on phones

Awaaz Shield runs on phones in two ways: an **installable Android app (APK)** and an **iPhone web app (PWA)** that you add to the Home Screen. Both talk to the same backend.

## What can and cannot be monitored

| Way to bring a call in | Android app | iPhone web app | Notes |
|---|---|---|---|
| **In-app call** between two Awaaz Shield users (create a session, share the 6-character code or link, the other person joins) | Yes | Yes | Both people accept a notice first. Each phone sends only its own microphone, so caller and agent are cleanly separated. |
| **Speakerphone call**: one phone takes the call on speaker, a second device (laptop or another phone) runs Awaaz Shield and listens with its microphone | Yes | Yes | Tick "Two voices on this audio". Accuracy depends on the room. The phone taking the call must be a different device from the one listening. |
| **Ordinary mobile-network call** (SIM call, phone 1 to phone 2) | **No** | **No** | Android and iOS do not let any app record or tap those calls. Only a telephony provider that carries the call (Twilio, Exotel...) can, and that is paid. Awaaz Shield never claims to monitor such a call. |
| WhatsApp or other app calls | No | No | Same restriction: the app cannot reach another app's call audio. |

Other limits to know:
- **The screen must stay on.** The microphone usually stops when the screen locks or the app goes to the background (iPhone, and in most browsers). The call screen asks the phone to keep the screen awake where the phone allows it (iOS 16.4 and later, Android Chrome); keep the app open during a call.
- **A secure address (https) is required** for the microphone on any phone. See DEPLOYMENT.md.
- The microphone is requested only when you start or join a call and accept the notice, never at install time.

## Android app (APK)

The Android app is the web app inside a small native shell (Capacitor). The native project is in `mobile/android`.

**You need:** Node 22 or newer, and [Android Studio](https://developer.android.com/studio) (it brings the JDK and the Android SDK). An Android phone with USB debugging, or an emulator.

**1. Deploy the backend** so the phone can reach it over https (see DEPLOYMENT.md). Note its address, for example `https://awaaz-shield.onrender.com`.

**2. Build the app pointing at that address** (from the project folder):

```bash
npm run android:install                                   # once: installs the Capacitor tools
CAP_SERVER_URL=https://awaaz-shield.onrender.com npm run android:sync
```

In this mode the app opens your deployed site, so the page, the API and the call sockets share one address and sign-in just works. (On Windows PowerShell: `$env:CAP_SERVER_URL="https://..."; npm run android:sync`.) The address must start with `https://`.

**3a. Run it from Android Studio:** `npm run android:open`, wait for Gradle to finish, pick your phone and press Run.

**3b. Or make an APK file:** make sure Android Studio has installed an Android SDK, then

```bash
npm run android:apk
```

The file is `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. If the build says it cannot find the SDK, create `mobile/android/local.properties` with `sdk.dir=/path/to/Android/sdk` (Android Studio shows the path under Settings > Android SDK).

**4. Install the APK on a phone:** copy it to the phone (USB, Drive, email), open it, and allow "Install unknown apps" for the app you opened it from. Or with USB debugging on: `adb install -r app-debug.apk`.

On first call, Android asks for microphone permission. A debug APK is fine for testing and sharing with friends. For the Play Store you need a signed release build (Android Studio: Build > Generate Signed Bundle).

*Other mode:* without `CAP_SERVER_URL` the page is packaged inside the app and talks to a separately hosted backend. Build the web app with `VITE_API_BASE_URL=https://your-backend` and give the backend `CORS_ORIGINS=https://localhost` and `COOKIE_SAMESITE=none`. Use this only if you have a reason to; the default mode is simpler and more reliable.

## iPhone (web app on the Home Screen)

1. Open your deployed https address in **Safari** (not inside another app).
2. Tap the **Share** button, choose **Add to Home Screen**, tap **Add**.
3. Open Awaaz Shield from the Home Screen. It opens full screen with its own icon and launch screen, and keeps you signed in for 12 hours at a time.

Settings > Install the app in the app shows the same steps. If the microphone prompt does not appear in the installed app, open the same address in Safari instead and tell me, so we can look at it.

## Testing on a phone before deploying

`npm run dev:share` starts everything on your network with the page, API and sockets on one port. Put a free https tunnel (cloudflared or ngrok) in front of port 5173 and open that address on the phone. The README section "Two phones" has the details.

## Two interfaces

The web app picks its layout by screen size: a phone layout (bottom tabs, one task per screen) on narrow screens, and the laptop layout (side rail and panels) on wide ones. Settings → Layout can force either one on a device. The Android app and the iPhone home-screen app both use the phone layout.
