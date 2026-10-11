import { castVotes, finishStack, type ActionResult } from "@/app/app/movie-night/actions";
import type { Vote } from "@/lib/movie-night";

/**
 * What a room needs from the server: where to ask for the night's state, how to send votes and how to finish a
 * stack. A family member and a guest reach the server differently (a guest has no account), so the room takes
 * these from outside.
 */
export interface NightTransport {
  /** The night's state; with `full` it comes with the cards. */
  stateUrl: (full: boolean) => string;
  castVotes: (
    stackId: string,
    votes: { candidateId: string; vote: Vote | null }[],
  ) => Promise<ActionResult & { loves?: number }>;
  finishStack: (stackId: string) => Promise<ActionResult>;
}

/** A signed-in member of the family. */
export function memberTransport(nightId: string): NightTransport {
  return {
    stateUrl: (full) => `/api/movie-night/${nightId}/state${full ? "?full=1" : ""}`,
    castVotes,
    finishStack,
  };
}
