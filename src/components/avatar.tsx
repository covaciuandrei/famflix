import { initials, safeAvatarUrl } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Avatar({
  name,
  url,
  className,
}: {
  name?: string | null;
  url?: string | null;
  className?: string;
}) {
  const src = safeAvatarUrl(url);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? "avatar"}
        // Google answers 429 instead of the photo when the request carries our page as referrer.
        referrerPolicy="no-referrer"
        className={cn("size-8 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
