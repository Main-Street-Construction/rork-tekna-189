const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Expo SDK 58 web export can crash Metro constant-folding on expo-router
// ("Duplicate declaration \"data\""). Keep classic import transform for stability.
config.transformer = config.transformer ?? {};
const prevGetTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async () => {
  const base = prevGetTransformOptions
    ? await prevGetTransformOptions()
    : { transform: {} };
  return {
    ...base,
    transform: {
      ...(base.transform ?? {}),
      experimentalImportSupport: false,
      inlineRequires: base.transform?.inlineRequires ?? true,
    },
  };
};

module.exports = config;
