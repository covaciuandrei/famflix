# brag-polished (reusable private workflow)

A reusable narrated product-video workflow, added without changing `/brag` or
`/brag-slim`. It keeps creative decisions in the skill and deterministic media
work in a small profile-driven toolkit.

The default is the approved **Bella / af_bella / fp32 / speed 1.06** presenter
voice, recorded as one connected take, with **25s, 1920x1080, 30fps** delivery.
Names and pronunciation aliases, palette, font, features, composition and
output settings belong to each project. No app/runtime upgrade is needed.

## Ownership and project copies

The canonical generic toolkit is maintained in the
[private brag-polished repository](https://github.com/covaciuandrei/brag-polished)
under `skills/brag-polished/`. The public
[Brag upstream](https://github.com/latent-spaces/brag) remains separate.

[FamFlix](https://github.com/covaciuandrei/famflix) also tracks a complete,
editable copy at `.github/skills/brag-polished/`. Its `UPSTREAM.md` records the
exact source commit, so the app does not depend on a sibling checkout, symlink
or submodule. The approved fixtures are regression references; FamFlix's
actual editable introduction remains in its `video/intro/` project.

- Keep reusable fixes in the canonical toolkit and port relevant improvements
  into project copies.
- Keep app-specific scripts, profiles and scenes with the application.
- Compare a project's pinned source revision and local edits before updating
  its copy. Never replace local customizations blindly; update its provenance
  after tests pass.
- Version source, locked dependencies and approved regression references.
  Ignore installed dependencies, model caches and temporary/generated renders.

## Use in another project

Install dependencies once with Node 22+, then use the toolkit's pinned runtime
through npm. FFmpeg, FFprobe and Chromium must be available; the doctor reports
missing prerequisites and disk constraints explicitly.

```sh
cd <skill-dir>
npm ci
npm exec playwright install chromium
npm run doctor
```

Invoke the installed personal skill as `/brag-polished` in a fresh Copilot
session. Alternatively follow [SKILL.md](./SKILL.md) with any Agent Skills
client. If the running host cached its skill list, reload the window/start a
new chat. Until then, explicitly ask the agent to read the installed personal
`brag-polished/SKILL.md`; no publishing or global application-runtime change
is needed. Start from [the profile template](./templates/project-profile.json),
replace draft values with the product's actual source-backed facts and brand,
and initialize a fresh workspace:

```sh
npm --prefix <skill-dir> run init -- --profile /project/profile.json --out /project/brag-output
npm --prefix <skill-dir> run voice -- /project/brag-output/project.json
npm --prefix <skill-dir> run render -- /project/brag-output/project.json
```

Customize the starter composition; do not make every product look the same.
Its scenes are ordinary editable Hyperframes HTML/GSAP. `stateContracts`
assert the actual leaf-scene HTML at important local timeline times and in
reverse order. The assembled root is checked/rendered by Hyperframes.

Outputs include the MP4, poster, canonical VTT/transcript, `validation.json`
and decoded review frames under `.checks/`. `review.json` is intentionally
not auto-approved. After real listening/visual review:

```sh
npm --prefix <skill-dir> run validate -- /project/brag-output/project.json --require-review
```

An automated pass is not a claim that someone listened to the new result.
Neither rendering nor validation publishes anything.

## Reproducibility and safeguards

- Locked dependencies and isolated Node 22, pinned Kokoro/Whisper source
  revisions, voice vectors from pinned `kokoro-js`, model/font hashes.
- The SDK performs its normal English normalization. A guard on its public
  tokenizer disables truncation and rejects inputs above 512 model tokens
  before inference. No finished-audio time stretching or silent voice fallback.
- Pronunciation aliases never rewrite canonical captions.
- Local word alignment with at most 10% script disagreement, no missing
  caption groups or invented successful timings.
- Exact media duration/dimensions/frame count, structural faststart, frame-zero
  poster comparison, final voice-presence/synchronization and safe mix checks.
- AAC trailing padding is bounded to one codec frame; presentation duration
  still has to match the requested duration exactly.
- Profile/composition/audio fingerprints prevent stale outputs being approved.
- Failed render/validation commands replace old success reports with an explicit
  failed report; pending human review stays distinct from automated failure.
- Native Python eSpeak is not used. Initial public model/dependency downloads
  need internet; speech inference and rendering run on-device.

## Reference checks

```sh
npm --prefix <skill-dir> test
npm --prefix <skill-dir> run voice -- <skill-dir>/fixtures/famflix-reference/project.json
npm --prefix <skill-dir> run render -- <skill-dir>/fixtures/famflix-reference/project.json
npm --prefix <skill-dir> run init -- --profile <skill-dir>/fixtures/unrelated-product/profile-source.json --out <new-pantry-workspace>
npm --prefix <skill-dir> run voice -- <new-pantry-workspace>/project.json
npm --prefix <skill-dir> run render -- <new-pantry-workspace>/project.json
```

The first reference retains only the approved fictional video composition,
golden media and factual description, not FamFlix application/account data.
The second is a different synthetic product with a warm palette, Fraunces
typography, another UI flow, a 20-second duration and square output.

Local render summaries are recorded in [the benchmark baseline](./fixtures/benchmark-baseline.json).
Generated media, dependencies and model caches are ignored. Keep all reference
material private; public publication requires separate approval. Video-generation
commands never commit, push, upload project content or deploy the application.

See [local setup](./references/local-setup.md),
[quality checks](./references/quality-checks.md) and
[third-party notices](./THIRD_PARTY_NOTICES.md). Original upstream license
notices remain intact.
