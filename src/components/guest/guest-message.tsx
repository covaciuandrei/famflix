import { Link2Off, LogOut, Popcorn, UserX, type LucideIcon } from "lucide-react";

export type GuestMessageKind = "over" | "dead" | "out" | "left";

const MESSAGES: Record<GuestMessageKind, { title: string; text: string; Icon: LucideIcon }> = {
  over: {
    title: "This movie night is over",
    text: "Thanks for voting!",
    Icon: Popcorn,
  },
  // A link that doesn't work says no more than this: not whether the night is over, replaced or turned off.
  dead: {
    title: "This link isn't working",
    text: "The movie night may be over, or the link may have been replaced or turned off. Ask the person who invited you for a new one.",
    Icon: Link2Off,
  },
  out: {
    title: "You're not in this movie night any more",
    text: "You may have been taken out of it, or it is gone. If that wasn't meant, ask the person who invited you for a new link.",
    Icon: UserX,
  },
  left: {
    title: "You left the movie night",
    text: "Your name and votes are gone from it. Thanks for stopping by!",
    Icon: LogOut,
  },
};

/** What a guest is told when there is no night to show: all a guest ever sees of FamFlix besides the night itself. */
export function GuestMessage({ kind }: { kind: GuestMessageKind }) {
  const { title, text, Icon } = MESSAGES[kind];
  return (
    <div role="status" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <Icon className="size-10 text-primary" aria-hidden />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
