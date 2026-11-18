# Native keyboard regression (Expo Go + Maestro)

Browser phone viewports do not create an iOS keyboard. These tests run on an
already-booted iPhone simulator with Expo Go installed and the shopper build open.
They never clear app data or change the saved shopping list.

Start the API and Metro using the project's normal scripts, e.g.:

```sh
# backend/ (PostgreSQL must be available)
HOST=127.0.0.1 PORT=3000 npm run start:prod

# repo root, another terminal
EXPO_PUBLIC_STAFF=0 EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 npx expo start --host localhost --port 8081
xcrun simctl openurl booted exp://127.0.0.1:8081
```

With [Maestro](https://docs.maestro.dev/) installed, from the repo root:

```sh
maestro test e2e/native/search-keyboard.yaml
maestro hierarchy > "$TMPDIR/lis-search-keyboard.json"
python3 e2e/native/assert-search-above-keyboard.py "$TMPDIR/lis-search-keyboard.json"
maestro test e2e/native/select-search-result.yaml
```

Use `maestro --device <simulator-udid>` and `simctl <command> <simulator-udid>`
when more than one simulator is booted. Use your assigned ports if applicable.

The first flow taps the **actual lowercase software keys**, not just a text
paste, to catch accidental capitalization. The geometry check requires the
keyboard to remain open and checks the entire sheet, milk row, and add button:
iOS accessibility can mark a row as visible even when keys cover it. The last
flow verifies one tap starts a route and dismisses the keyboard, then ends that
single-product route without changing the shopping list.

`e2e/mobile.spec.ts` also checks the search input settings and sheet sizing in a
short usable viewport. That is a layout regression check, not an iOS keyboard test.
