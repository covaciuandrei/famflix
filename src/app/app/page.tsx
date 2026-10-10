import { redirect } from "next/navigation";

import { APP_HOME } from "@/lib/constants";

/** There is no Home page: old links and bookmarks to /app land on the first tab. */
export default function AppIndexPage() {
  redirect(APP_HOME);
}
