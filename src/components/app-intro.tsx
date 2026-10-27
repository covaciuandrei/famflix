"use client";

import { Play, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";
import { closeOnBackdrop, openModal } from "@/lib/dialog";

const INTRO_DURATION = 25;
const INTRO_VERSION = "concise-25-v4";
const VIDEO_URL = `/video/famflix-intro.mp4?v=${INTRO_VERSION}`;

export function AppIntro() {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  function playIntro() {
    const player = video.current;
    if (!player) {
      setFailed(true);
      return;
    }
    void player.play().catch((error: unknown) => {
      if (!dialog.current?.open || video.current !== player) return;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setPlaybackBlocked(true);
      } else {
        setFailed(true);
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        aria-haspopup="dialog"
        aria-label={`Watch intro with narration (${INTRO_DURATION} seconds)`}
        onClick={() => {
          // Mount before play() so audible playback stays inside this user gesture.
          flushSync(() => {
            setFailed(false);
            setPlaybackBlocked(false);
            setOpen(true);
          });
          openModal(dialog.current);
          playIntro();
        }}
      >
        <Play className="size-4" aria-hidden />
        Watch intro
        <span className="text-xs text-muted-foreground">{INTRO_DURATION} sec</span>
      </Button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-4xl overflow-y-auto rounded-2xl border border-border bg-background p-0 text-left text-foreground shadow-2xl backdrop:bg-black/75"
        onClose={() => setOpen(false)}
        {...closeOnBackdrop}
      >
        <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              Meet FamFlix
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              Your own list or a family night, in {INTRO_DURATION} seconds.
              With English narration and sound.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close intro"
            onClick={() => dialog.current?.close()}
          >
            <X className="size-5" aria-hidden />
          </Button>
        </div>

        {open && (
          <video
            ref={video}
            aria-label="FamFlix introduction"
            width={1920}
            height={1080}
            className="aspect-video w-full bg-black"
            src={VIDEO_URL}
            poster={`/video/famflix-intro.jpg?v=${INTRO_VERSION}`}
            controls
            playsInline
            preload="none"
            onError={() => setFailed(true)}
            onPlay={() => setPlaybackBlocked(false)}
          >
            <track
              kind="captions"
              src={`/video/famflix-intro.vtt?v=${INTRO_VERSION}`}
              srcLang="en"
              label="English"
            />
            Your browser cannot play this video. Download it using the link
            below, or read the transcript.
          </video>
        )}

        <div className="flex flex-col gap-3 p-4 text-sm sm:p-5">
          {playbackBlocked && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-muted-foreground">
                Your browser paused playback. Press Play to hear the intro.
              </p>
              <Button size="sm" onClick={playIntro}>
                <Play className="size-4" aria-hidden />
                Play intro with sound
              </Button>
            </div>
          )}
          {failed && (
            <p role="alert" className="text-destructive">
              The intro could not be loaded. Try downloading the video below,
              or read the transcript.
            </p>
          )}
          <details>
            <summary className="w-fit cursor-pointer rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Read the intro transcript
            </summary>
            <div className="mt-3 space-y-2 text-muted-foreground">
              <p>Meet FamFlix, a home for everything you want to watch.</p>
              <p>
                Find movies and series, save them to your own list, and mark
                them watched when you&apos;re done.
              </p>
              <p>
                You can also share a list with family and friends, so
                everyone&apos;s ideas are in one place.
              </p>
              <p>
                For movie night, swipe and vote together to find a favourite.
              </p>
              <p>
                Afterwards, add your ratings and keep track of who watched with
                you.
              </p>
              <p>FamFlix. Less choosing. More watching. Get started for free.</p>
              <p className="text-xs">
                The demo shows choosing My list in Add to…, the title moving to
                Watched after Mark watched, and an optional score saved
                afterwards. It ends with Get started — it&apos;s free.
              </p>
              <p className="text-xs">
                English voiceover with original instrumental music. The people,
                titles and artwork in the video are fictional demo examples.
              </p>
            </div>
          </details>
          <a
            href={VIDEO_URL}
            download
            className="w-fit text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Download the video
          </a>
        </div>
      </dialog>
    </>
  );
}
