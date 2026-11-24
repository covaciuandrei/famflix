# FamFlix intro

The landing page's optional **Watch intro** plays a local, 25-second,
1920 x 1080 landscape MP4 at 30 fps. It explains personal and family use,
shows choosing an initially unselected My list option, adding the title,
marking it watched, and then optionally saving a score. The shared-list,
voting and watched-together scenes are retained.

Playback and sound start only after a click, with English narration, native
controls, timed captions and a readable transcript. If the browser blocks
audible playback, an explicit Play button is offered. Closing the dialog
unmounts the video. A revision query on media URLs prevents old cached clips
from hiding an update. No third-party video player or tracking is involved.

## Editing and rendering

This is a standalone authoring project. To edit or re-render the intro, use
**Node.js 22+**, FFmpeg and FFprobe on your PATH. Running the app does not
require these tools: it serves the finished files in [`public/video/`](../../public/video/).

```sh
cd video/intro
npm ci
HYPERFRAMES_NO_TELEMETRY=1 npm run render
```

The prepared narration and its cue timings are included. To change the spoken
script, edit [narration.json](./narration.json) and regenerate it first:

```sh
HYPERFRAMES_NO_TELEMETRY=1 HF_HUB_DISABLE_TELEMETRY=1 npm run voice
HYPERFRAMES_NO_TELEMETRY=1 npm run render
```

The presenter-style script introduces FamFlix and explains how its core features
fit together, rather than reading a series of isolated commands. Speech uses
the local Kokoro-82M `af_bella` voice in full precision (`fp32`), recorded as
one connected take at a brisk presentation pace. The approved text and narrator
are preserved in the shorter cut; animation timings are tightened and the long
ending hold is removed. Speech is regenerated at the faster delivery rate,
not stitched from short labels or time-stretched afterwards.

`spokenBrand` supplies the pronunciation-only input `Famflix`: one
**FAM-flicks** word with a single primary stress and a short i. Display copy
and captions retain **FamFlix**. The pronunciation regression test checks the
actual phonemes produced by the same English phonemizer used by Kokoro.

Local Whisper word timestamps align the verbatim captions to the actual
delivery. The recognized speech is checked against the script; missing or
substantially different narration is rejected. Both speech and recognition
run on-device. The first run downloads their public models into the ignored
local cache; later runs reuse them. The renderer refuses stale narration when
its script changes.

The renderer prepares local assets, runs Hyperframes checks, renders with
one browser worker, selects a settled outro poster, bakes it into frame zero,
and writes an optimized H.264/AAC MP4 with faststart. It verifies the duration,
dimensions, codecs and 750-frame count before reporting success. Background
music is mixed quietly underneath the normalized voice.

- [Main composition](./index.html): timing, brand overlays and soundtrack.
- [Scenes](./scenes/): editable, seek-safe GSAP product illustrations.
- [Brand styles](./assets/brand.css): the app's Geist font and colour tokens.
- [Render script](./render.mjs): original score synthesis and local export.
- [Narration generator](./narrate.mjs): local speech synthesis, measured timing
  and loudness normalization; captions are generated from the actual clips.
- [Video](../../public/video/famflix-intro.mp4) and
  [poster](../../public/video/famflix-intro.jpg): assets served by the app.
- [Captions](../../public/video/famflix-intro.vtt): generated from speech timings.
  Keep the [player transcript](../../src/components/app-intro.tsx) aligned with
  script and scene edits.

For a local composition check or frame inspection:

```sh
npm test
HYPERFRAMES_NO_TELEMETRY=1 npm run check
HYPERFRAMES_NO_TELEMETRY=1 npx hyperframes snapshot --at 1,3.8,4.95,6.45,7,8.5,10.5,14,15.5,18.5,22,24.5
```

With the application's development dependencies installed, `npm test` checks
caption alignment and seeks the actual scene timeline in Chromium. Regression
checks cover the unchanged approved script/narrator, single-stress brand
pronunciation, unselected list chooser, add confirmation, immediate Watched
state, empty-to-selected score, saving a rating, and seeking backwards without
retaining later state.

Generated tooling assets, dependencies and intermediate renders are ignored.
Only the final app assets need to be served in production. Rendering does not
publish or deploy anything.

## Content and credits

Created with the [Brag workflow](https://github.com/latent-spaces/brag) and
[Hyperframes](https://github.com/heygen-com/hyperframes), rendered locally.
The interface is an illustrative reconstruction of FamFlix's personal and
family lists, adding/marking titles watched, movie-night voting and
watched-together features, not a live account recording.
All displayed people, titles, artwork and scores are fictional demo examples.
The logo and palette come from FamFlix. The soundtrack and selection accents
are original, synthesized locally by the render script. The English voiceover
is synthesized on-device using [Kokoro](https://github.com/hexgrad/kokoro)
(Apache-2.0 weights). No stock music, movie artwork, cloud voice service or
external generation API is used.

[Geist](https://github.com/vercel/geist-font) is licensed under the SIL Open
Font License. Its font file is prepared from the pinned Fontsource package.
[GSAP](https://gsap.com/community/standard-license/) and Hyperframes are used
only by the local authoring toolchain, not shipped as application dependencies.
