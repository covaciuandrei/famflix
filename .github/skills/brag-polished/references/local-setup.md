# Local setup

This additive workflow is based on Brag upstream revision
`669ab9286aa28b6c3ee30e75f181ee74319d012a`. Original Brag commands are unchanged.

Use Node.js 22+, FFmpeg, FFprobe and Chromium. Keep this toolchain separate
from the target app: do not upgrade its runtime merely to make a video.

```sh
cd <skill-dir>
npm ci
npm exec playwright install chromium
node scripts/doctor.mjs
```

The installed tool dependencies include a pinned, isolated Node 22 runtime.
`npm run` uses that runtime from the skill's own `node_modules/.bin`; the
application keeps its own Node version. Use Node 22+ for the initial bootstrap.

The initial dependency and public model downloads require internet access.
Kokoro/Whisper inference and Hyperframes rendering are local. Telemetry is
disabled by the scripts. No speech-generation API credentials are used.

Create a profile from the template, fill in real source evidence, then:

```sh
npm --prefix <skill-dir> run init -- --profile /project/video-profile.json --out /project/brag-output
npm --prefix <skill-dir> run voice -- /project/brag-output/project.json
npm --prefix <skill-dir> run render -- /project/brag-output/project.json
npm --prefix <skill-dir> run validate -- /project/brag-output/project.json --require-review
```

Use a new output directory for another run. Existing workspaces are not
overwritten by initialization. Generated assets/caches stay outside the app's
dependency tree and are ignored by this local fork.

The default narrator is Bella (`af_bella`, fp32, speed 1.06). Canonical names
stay in captions; `pronunciations` controls spoken aliases and optional
expected phonemes. The implementation uses JavaScript Kokoro with pinned model
revisions, avoiding the native Python eSpeak initialization failure on macOS.

Install this local skill for Copilot by linking its folder into
`~/.copilot/skills/brag-polished`. Do not replace an existing skill without
review. A new session/reload may be needed for skill discovery. The same
SKILL.md is compatible with other Agent Skills clients; installing into them
is a separate choice.

The canonical checkout keeps its public `upstream` fetch-only, with its push
URL disabled. Its separate private `origin` backup is owner-approved;
`push.default=nothing` still requires an explicit push target. A vendored
project copy belongs to that application's Git repository instead.

Video-generation commands do not commit, push, publish or deploy. A private
backup does not authorize public publication or uploading a project's content
to generation services.
