import * as React from "react";
import { cn } from "@/lib/utils";

// §2.8 — a deliberate LIGHT zone inside the dark app. Received HTML mail is
// authored for white backgrounds and the compose surface must match what
// recipients see, so both render on a light island rather than being inverted
// into the dark theme. Beyond the `bg-white` surface, the island scopes
// `color-scheme: light`: the app sets `color-scheme: dark` globally
// (globals.css), which otherwise renders native controls (inputs, checkboxes,
// scrollbars) dark inside these light regions. `colorScheme` is applied last so
// it can't be flipped back by a caller's `style` — the light context is a
// contract, not a default.
type LightContentIslandProps = React.HTMLAttributes<HTMLDivElement>;

export function LightContentIsland({
  className,
  style,
  children,
  ...rest
}: LightContentIslandProps) {
  return (
    <div
      {...rest}
      className={cn("bg-white text-[#1a1a1a]", className)}
      style={{ ...style, colorScheme: "light" }}
    >
      {children}
    </div>
  );
}
