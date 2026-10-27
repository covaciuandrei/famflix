# Quality gates and review

Automated checks fail with an actionable error. They do not substitute stock
footage, another voice, approximate caption timings or an empty output.

## Before rendering

- Complete profile; every claim has an existing source and supporting excerpt.
- Local licensed assets and a dedicated Node 22+ toolchain.
- One continuous Bella/fp32 take by default. Check the actual untruncated
  phoneme token sequence before inference (maximum 512 model tokens).
- Speech fits the requested duration and supported pace, with no more than
  the declared ending hold. Reword before rushing or cutting speech.
- Pronunciation aliases are project-specific. Expected phonemes can be tested.
- Captions align to locally recognized word timings. Reject excessive
  disagreement, missing groups, invalid timestamps or stale narration.
- Hyperframes check passes. Leaf-scene state assertions pass in their original
  order and backwards, including actual visibility through ancestor opacity.

## Final media

- Declared width, height, fps, exact frame count and duration.
- H.264/yuv420p picture, AAC audio and `moov` preceding media for faststart.
- Narration remains present and synchronized in every spoken caption window.
- A non-silent, unclipped final mix; a quiet music bed below the normalized voice.
- A selected settled poster at the declared time, also baked into frame zero.
- Decoded keyframes, readable text and a bounded ending hold.

## Human review

Inspect the final decoded frames and listen to the actual voice and mix.
Check the product's factual claims, natural delivery, pronunciation, readable
holds, transitions and asset permissions. Record real review results in
`review.json`; never mark a listening review passed from ASR alone.

`validate.mjs <profile>` distinguishes automated success from pending review.
`validate.mjs <profile> --require-review` additionally requires all review
checks to be explicitly approved. Neither command publishes anything.

Reference fixtures catch regressions. They cannot guarantee that one visual
style, word rate or story is appropriate for every product.
