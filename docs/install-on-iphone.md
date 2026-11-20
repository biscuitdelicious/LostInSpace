# Installing LIS on your own iPhone from Xcode (free Apple ID)

This builds the app itself (not Expo Go) and installs it on a phone that
talks to the backend on your Mac over Wi-Fi. Steps marked **You** cannot be
scripted: they need your Apple ID, your phone, or a tap on a system prompt.

## 1. Backend reachable over Wi-Fi

The phone and the Mac must be on the same Wi-Fi network.

1. Start the backend as usual from `backend/` (`npm run start:prod` after
   `npm run build`, or `npm run start:dev`). Do **not** set `HOST=127.0.0.1`:
   without `HOST` it listens on every interface, which is what the phone
   needs. PostgreSQL stays reachable from the Mac only.
2. **You:** the macOS firewall is on. The first time Node listens for
   incoming connections macOS asks "Do you want the application 'node' to
   accept incoming network connections?" — choose **Allow**. If you never
   see the prompt and the phone cannot connect, allow Node under
   System Settings → Network → Firewall → Options.
3. Find the address the phone should use:

   ```sh
   scutil --get LocalHostName     # e.g. Delinschiis-MacBook-Pro-2  -> add .local
   ipconfig getifaddr en0         # e.g. 192.168.1.150
   ```

4. **You:** check it from the phone before building anything. Open Safari on
   the iPhone and go to `http://<Mac name>.local:3000/products?q=milk`. You
   should see product text. If the name does not load, try the number
   address. If neither loads, the Wi-Fi blocks devices from seeing each
   other (common on guest and campus networks): turn on Personal Hotspot on
   the iPhone, join it from the Mac, and run step 3 again.

## 2. Settings in the root `.env`

Copy `.env.example` to `.env` if you have not, then set:

```sh
# The Mac's name is steadier than the number, which can change per network.
EXPO_PUBLIC_API_URL=http://Delinschiis-MacBook-Pro-2.local:3000
# Any identifier of your own; "app.lis.indoor" may be taken by someone else.
IOS_BUNDLE_ID=com.yourname.lis
# Optional, fill in after step 4 so the team survives the next prebuild.
APPLE_TEAM_ID=
```

The API address is built into the app. After changing it you must build and
install again (step 5); restarting the app is not enough.

## 3. Generate the Xcode project

```sh
npm install
npm run ios:xcode
```

This writes the `ios/` folder (ignored by git, safe to delete and
regenerate), installs the CocoaPods, and opens
`ios/LISIndoorIntelligence.xcworkspace`. Always open the `.xcworkspace`, not
the `.xcodeproj`. If CocoaPods complains about the terminal encoding, run
`export LANG=en_US.UTF-8` first.

## 4. Sign with your Apple ID — **You**

1. Xcode → Settings → Accounts → **+** → Apple Account, and sign in.
2. In the left sidebar click the blue **LISIndoorIntelligence** project,
   select the **LISIndoorIntelligence** target, open **Signing &
   Capabilities**.
3. Tick **Automatically manage signing** and pick **Team: Your Name
   (Personal Team)**.
4. If Xcode says the bundle identifier is not available, change
   `IOS_BUNDLE_ID` in `.env` to something else and run step 3 again.

Optional: your team id is shown in the build settings as `DEVELOPMENT_TEAM`
once a team is picked. Put it in `.env` as `APPLE_TEAM_ID` and Xcode keeps
the team the next time the project is regenerated.

## 5. Build and install

1. **You:** plug the iPhone into the Mac with a cable, unlock it, and tap
   **Trust** on "Trust This Computer?", then enter the passcode.
2. **You:** on the iPhone turn on Settings → Privacy & Security →
   **Developer Mode**, and restart when asked. (The switch appears once the
   phone has been connected to Xcode.)
3. In Xcode choose your iPhone in the device menu at the top.
4. Product → Scheme → Edit Scheme… → Run → Build Configuration →
   **Release**. A Release build carries its own JavaScript, so the app works
   without the Mac running Expo. (With Debug the phone also needs
   `npx expo start` running on the Mac.)
5. Press **Run** (▶). The first build takes about five minutes.
6. **You:** the first launch is refused with "Untrusted Developer". On the
   iPhone open Settings → General → **VPN & Device Management** → your Apple
   ID under Developer App → **Trust**. The phone needs internet for this.
   Then open the app from the home screen.
7. **You:** the app asks to "find and connect to devices on your local
   network" — tap **Allow**. Without it the app cannot reach the Mac. To
   change it later: Settings → Privacy & Security → Local Network.

The pill next to the search box reads **POSTGRES API** when the phone is
talking to your backend, and **SEED DATA** when it is not.

## Limits of a free Apple ID

- The installed app stops opening after **7 days**. Plug the phone in and
  press Run again; your shopping list on the phone is kept.
- At most three of your own apps on a phone, and ten new bundle identifiers
  per week.
- No push notifications or other paid capabilities. Bluetooth beacons do not
  need one: Core Bluetooth and iBeacon ranging only need a usage text in
  `app.json`, so they work with a free account.

## If something does not work

| What you see | What to do |
| --- | --- |
| Pill says SEED DATA | Repeat the Safari check in step 1. If Safari works but the app does not, check Local Network is allowed, and that `EXPO_PUBLIC_API_URL` was set before the build. |
| It worked yesterday, not today | The Mac's number address changed. Use the `.local` name, or update `.env` and build again. |
| "Unable to install" / "integrity could not be verified" | Trust the developer profile (step 5.6). |
| Signing error about Hotspot or Wi-Fi entitlements | The project predates this guide: delete `ios/` and run step 3 again. |
| `node: command not found` during the build | Delete `ios/` and run step 3 from a terminal where `node -v` works. |
