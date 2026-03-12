# Remove 7 unused dependencies from the project

## Summary

After scanning every source file in the project, 7 packages listed in the app's dependency list are never imported or used anywhere in the code. Removing them reduces install size, avoids confusion, and speeds up installs.

## Packages to remove

## What stays the same

- **No code changes** — only `package.json` is updated
- **No features added or removed**
- **No structural or design changes**

## Steps

1. Remove the 7 packages from `package.json`
2. Re-run the package installer to update the lock file

