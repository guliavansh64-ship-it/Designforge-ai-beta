/**
 * Local (non-EAS) release builds: signs `assembleRelease` with an upload keystore whose path and
 * passwords come from environment variables — never from source:
 *   DF_KEYSTORE_PATH, DF_KEYSTORE_PASSWORD, DF_KEY_ALIAS, DF_KEY_PASSWORD
 * If they're absent, Gradle falls back to the default debug signing (fine for local testing only).
 * EAS builds ignore this and use EAS-managed credentials.
 * Also tunes Gradle for small build machines and limits ABIs if DF_ABIS is set (e.g. "arm64-v8a").
 */
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const SIGNING = `
    // >>> designforge-release v2
    // DesignForge: package ONLY the ABIs that were compiled (reactNativeArchitectures). Otherwise prebuilt
    // AARs ship libs for all 4 ABIs while locally-built libs exist only for the selected ones → crash on launch.
    def dfAbis = findProperty("reactNativeArchitectures")
    if (dfAbis) { defaultConfig.ndk.abiFilters(*dfAbis.toString().split(",").collect { it.trim() }) }
    // DesignForge: release signing from env (see plugins/withReleaseSigning.js)
    def dfStore = System.getenv("DF_KEYSTORE_PATH")
    if (dfStore) {
        signingConfigs {
            dfRelease {
                storeFile file(dfStore)
                storePassword System.getenv("DF_KEYSTORE_PASSWORD")
                keyAlias System.getenv("DF_KEY_ALIAS")
                keyPassword System.getenv("DF_KEY_PASSWORD")
            }
        }
        buildTypes.release.signingConfig signingConfigs.dfRelease
    }
    // <<< designforge-release
`;

module.exports = function withReleaseSigning(config) {
  config = withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    // Remove any previously injected block (current markers, or the unmarked v1 block) so re-runs stay idempotent.
    g = g.replace(/\n\s*\/\/ >>> designforge-release[\s\S]*?\/\/ <<< designforge-release\n/, '\n');
    g = g.replace(/\n\s*\/\/ DesignForge: release signing from env[\s\S]*?buildTypes\.release\.signingConfig signingConfigs\.dfRelease\n\s*\}\n/, '\n');
    // Insert inside android { } just before packagingOptions so it overrides the template's debug signing.
    const next = g.replace(/\n(\s*)packagingOptions \{/, `\n${SIGNING}\n$1packagingOptions {`);
    c.modResults.contents = next !== g ? next : `${g}\nandroid {${SIGNING}}\n`;
    return c;
  });
  return withGradleProperties(config, (c) => {
    const set = (key, value) => {
      c.modResults = c.modResults.filter((p) => !(p.type === 'property' && p.key === key));
      c.modResults.push({ type: 'property', key, value });
    };
    if (process.env.DF_ABIS) set('reactNativeArchitectures', process.env.DF_ABIS);
    if (process.env.DF_LOW_MEMORY) {
      set('org.gradle.jvmargs', '-Xmx2048m -XX:MaxMetaspaceSize=768m -XX:+HeapDumpOnOutOfMemoryError');
      set('org.gradle.workers.max', '2');
      set('org.gradle.parallel', 'false');
      set('kotlin.daemon.jvmargs', '-Xmx1024m');
    }
    return c;
  });
};
