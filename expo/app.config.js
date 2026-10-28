/**
 * Dynamic Expo config.
 *
 * EAS remote autoIncrement only bumps ios.buildNumber / android.versionCode.
 * App Store rejects reusing a closed CFBundleShortVersionString (e.g. 1.7.0),
 * so every EAS production/preview build gets a higher marketing version patch.
 */
const appJson = require('./app.json');

function resolveMarketingVersion(baseVersion, profile) {
  const parts = String(baseVersion || '1.0.0').split('.');
  const major = parts[0] || '1';
  const minor = parts[1] || '0';
  const basePatch = parseInt(parts[2] || '0', 10) || 0;

  const onEas = process.env.EAS_BUILD === 'true';
  const shouldBump =
    onEas && (profile === 'production' || profile === 'preview' || !profile);

  if (!shouldBump) {
    return `${major}.${minor}.${basePatch}`;
  }

  // Monotonic patch (unix seconds). Always greater than prior App Store trains.
  const timePatch = Math.floor(Date.now() / 1000);
  const patch = Math.max(basePatch + 1, timePatch);
  const resolved = `${major}.${minor}.${patch}`;
  console.log(`[app.config] Marketing version ${baseVersion} → ${resolved} (profile=${profile || 'unknown'})`);
  return resolved;
}

module.exports = () => {
  const expo = appJson.expo;
  const profile = process.env.EAS_BUILD_PROFILE;

  return {
    ...expo,
    version: resolveMarketingVersion(expo.version, profile),
  };
};
