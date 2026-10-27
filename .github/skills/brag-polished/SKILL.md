---
name: brag-polished
description: 'Create or update the narrated FamFlix application intro using its existing editable video project and approved Bella voice. Use for /brag-polished, app-feature video updates, professional product presentations, accurate UI demonstrations, captions and validated local renders.'
argument-hint: '[project] [duration] [landscape|vertical|square]'
user-invocable: true
---

# Polished product videos

Turn the current product into a concise, truthful presentation, not a generic
slideshow. This is an additive workflow; it does not change `/brag` or
`/brag-slim`.

## FamFlix project entry point

This is the editable project copy. Read [its source provenance](./UPSTREAM.md)
before updating shared tooling or replacing local customizations.

For changes to the existing landing-page intro, start with the
[current authoring and rendering guide](../../../video/intro/README.md) and
[current feature guide](../../../docs/FEATURES.md). Edit the actual
`video/intro/` composition, script and regression tests; its render scripts
write the assets already used by the app. Keep the player transcript aligned.
Preserve the approved Bella delivery and 25-second format unless the user
requests a change. The toolkit's golden fixtures are historical regression
references, not the source of the current application video.

Use the generic profile workflow below for a new presentation or an explicitly
requested migration. Neither workflow publishes or deploys the application.
If the host selects the personal skill instead, explicitly load this
project-local SKILL.md when working on FamFlix.

## Defaults and boundaries

- Local Kokoro **Bella (`af_bella`), full precision (`fp32`)**, one continuous
  presenter take, speed `1.06`. This preset is narrated; use the original Brag
  workflow if a silent video is explicitly requested.
- Default output: **25 seconds, 1920 x 1080 landscape, 30 fps**.
- Brand names, pronunciation, colors, fonts, features and scene design come
  from this project, never a previous customer's video.
- English narration in this version. Ask before changing language or voice.
- No cloud speech, code/asset uploads, publishing, deployments or remote writes.
  Bootstrap downloads public dependencies/models; inference and rendering stay
  on this computer. Telemetry is disabled by the toolkit.
- Never copy credentials, real accounts, customer data or private URLs into
  a profile, scene, transcript or rendered frame.

Resolve `<skill-dir>` from this file's actual installation location. Scripts,
templates and references use relative paths. Do not assume a particular home
directory, application framework or package-manager runtime.

## Workflow

1. **Understand the product.** Read [the creative brief](./references/creative-brief.md).
   Inspect the actual UI, source and feature documentation. Select the useful
   flow: entry -> action -> result. Do not invent capabilities or usage numbers.
2. **Prepare the profile and story.** Copy
   [the profile template](./templates/project-profile.json) outside the skill
   into the current project and replace all draft values. Record source-backed
   facts, licensed local assets, canonical script and pronunciation aliases.
   Keep the script connected and conversational; do not narrate isolated labels.
3. **Check the toolchain.** Read [local setup](./references/local-setup.md).
   Use Node 22+ for this toolkit without changing the app's runtime. Run
   `npm --prefix "<skill-dir>" run doctor -- "<profile>"`.
4. **Create a fresh workspace.**
   `npm --prefix "<skill-dir>" run init -- --profile "<profile>" --out "<new-workspace>"`
   refuses to overwrite an existing workspace. The starter is scaffolding:
   customize the scenes to demonstrate the real product and its own brand.
   Existing custom compositions can supply their own workspace/profile instead.
5. **Produce the voice first.**
   `npm --prefix "<skill-dir>" run voice -- "<workspace>/project.json"`.
   Keep Bella/full precision unless the user overrides it. Pronunciation aliases
   affect speech only; captions retain the canonical words. Never silently
   truncate, time-stretch, downgrade the voice or switch providers.
6. **Time the actual composition to the measured voice.** Read Hyperframes'
   current composition/motion guidance when authoring. Use local runtime assets,
   seek-safe paused timelines and source-accurate UI states. Supply leaf-scene
   state assertions before/after each important action. No checked destination
   before adding; no rating before choosing it; no stale counts after watching.
7. **Check, render and inspect.** Read [quality checks](./references/quality-checks.md).
   `npm --prefix "<skill-dir>" run render -- "<workspace>/project.json"` runs
   Hyperframes and state checks before local rendering, then verifies the MP4.
   Inspect decoded frames and listen to the result. Review is not optional.
8. **Deliver honestly.** Outputs are `video.mp4`, `poster.jpg`, `captions.vtt`,
   `transcript.txt`, `validation.json` and review material in the workspace.
   Report automated results separately from listening/visual approval. Use
   `npm --prefix "<skill-dir>" run validate -- "<profile>" --require-review` only after a real review has
   populated `review.json`. Never claim an unheard voice was human-reviewed.

## Quality bar

Keep the user's requested duration, readable holds, correct pronunciation,
clean UI transitions, narration above the music and a short ending hold.
Reduce the story before increasing speech speed beyond the supported range.
If a prerequisite, alignment, state or render check fails, show the error and
fix it; do not return a success-shaped placeholder.

The local FamFlix reference preserves the approved result. An unrelated
product fixture checks that the reusable core does not depend on its names,
colors, dimensions or application paths. Reference material is local-only.
