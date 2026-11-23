<!-- Title: type(mod): what it does, e.g. fix(better-files): fetch preview badges on Windows. One mod per PR. See CONTRIBUTING.md. -->

Closes #

## Summary

<!-- What changed and why. Prefer a small picture over prose: a diff sketch, a file tree, a call tree or a Mermaid diagram. Call out anything non-obvious in the diff. -->

## Evidence

<!-- Before and after. A visual change needs screenshots or a recording; otherwise, the test that failed before and passes after. -->

- **Before:**
  **After:**

**Tried on:**

- [ ] macOS: in the app / tests only
- [ ] Windows: in the app / tests only
- [ ] Linux: in the app / tests only

<!-- Delete the platforms you didn't try, and strike out "in the app" or "tests only". Say what you didn't check by hand. -->

## Merge Danger

**Door:** <!-- two-way (cheap to revert) or one-way (migrates data, rewrites settings, or can't be undone) -->

**Blast Radius:** <!-- one word: what breaks if this is wrong, e.g. "cosmetic", "Better Files", "settings" -->

<!-- Anything a user could notice: changed settings, new prompts, files written, shared keys other mods read. -->

## AI usage

<!-- Which tool, and what it did: wrote the code, wrote the tests, helped debug, or none. Any answer is fine; see CODE_OF_CONDUCT.md. -->

## Checklist

- [ ] `node --test */tests/*.test.cjs site/tests/*.test.cjs` passes
- [ ] `herdr-app check` passes for the mod
- [ ] The mod's README, RECIPE and schema match the change
- [ ] I read my own diff top to bottom
