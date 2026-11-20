/**
 * The dynamic part of the Expo config; everything static stays in app.json.
 *
 * Signing settings come from the root .env so they survive `expo prebuild`,
 * which rewrites the bundle identifier and clears the team picked in Xcode:
 *
 *   IOS_BUNDLE_ID   a bundle identifier of your own, e.g. com.yourname.lis.
 *                   A free Apple ID can only sign an identifier that no
 *                   other Apple account has registered.
 *   APPLE_TEAM_ID   your 10-character team id. Optional: without it, pick
 *                   the team in Xcode again after each prebuild.
 *
 * The "react-native-wifi-reborn" config plugin is deliberately not listed
 * in app.json. All it added on iOS were the Hotspot Configuration and
 * Access Wi-Fi Information entitlements, which a free Apple ID cannot sign
 * and which iOS never uses here (Wi-Fi scanning is Android-only). The
 * Android permission it added is already in app.json, and the native
 * module is still linked automatically.
 */
module.exports = ({ config }) => {
  const bundleIdentifier = process.env.IOS_BUNDLE_ID?.trim();
  const appleTeamId = process.env.APPLE_TEAM_ID?.trim();
  return {
    ...config,
    ios: {
      ...config.ios,
      ...(bundleIdentifier ? { bundleIdentifier } : {}),
      ...(appleTeamId ? { appleTeamId } : {}),
    },
  };
};
