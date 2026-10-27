# Toolkit provenance and local editing

## Pinned source

- Canonical private repository:
  [covaciuandrei/brag-polished](https://github.com/covaciuandrei/brag-polished).
- Imported commit:
  [3cd3feee55d78955e04596bb3df14596f6e7b119](https://github.com/covaciuandrei/brag-polished/commit/3cd3feee55d78955e04596bb3df14596f6e7b119).
- Canonical source directory: `skills/brag-polished/`.
- Project copy: `.github/skills/brag-polished/`.
- Original public upstream: [latent-spaces/brag](https://github.com/latent-spaces/brag).

All imported source, dependency locks, templates, tests, licenses and approved
reference fixtures match that revision. The only local additions/overrides are
this provenance file and [SKILL.md](./SKILL.md), whose entry point directs
FamFlix edits to its existing authoring project.

This is a full copy, not a symlink or submodule. Cloning FamFlix includes the
toolkit without requiring access to another checkout.

## Changing the FamFlix introduction

Use [the existing video project](../../../video/intro/README.md) for the actual
composition, narration and app-delivered assets. Keep product claims aligned
with [the feature guide](../../../docs/FEATURES.md). Do not change the frozen
golden fixtures just to follow a new app feature.

App-specific adaptations can be edited in this copy. Keep reusable fixes in
the canonical toolkit as well, so other projects can benefit.

## Updating the shared toolkit

1. Review canonical changes since the pinned commit and compare them with local
   edits. Preserve the FamFlix entry point and any later app-specific changes;
   never overwrite the project copy blindly.
2. Bring in the relevant shared changes, including their tests and notices.
3. Use Node.js 22+ for this isolated package:

   ```sh
   npm --prefix .github/skills/brag-polished ci
   npm --prefix .github/skills/brag-polished test
   npm run lint
   npx tsc --noEmit
   ```

   Run the video project's own checks when changing the actual intro. New
   renders still need visual/listening review.
4. Update the imported commit and local-override list here, then commit the
   tested project copy. Do not add installed dependencies, model caches or
   generated renders.

The app remains on Node 20; this toolkit is not an application dependency.
Its upstream [MIT license](./LICENSE) and
[third-party notices](./THIRD_PARTY_NOTICES.md) travel with the copy.
Private backups do not authorize public publication.
