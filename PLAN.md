# Remove 7 unused dependencies from the project

## Summary

After scanning every source file in the project, 7 packages listed in the app's dependency list were never imported or used anywhere in the code. They have been removed.

## Packages removed

- [x] expo-blur
- [x] expo-clipboard
- [x] expo-image
- [x] expo-linear-gradient
- [x] expo-symbols
- [x] expo-font
- [x] expo-web-browser

## What stayed the same

- **No feature changes** — only `package.json` and `app.json` updated
- **No structural or design changes**

## Steps

- [x] Remove the 7 packages from `package.json`
- [x] Re-run the package installer to update the lock file
- [x] Clean up `app.json` plugin references
