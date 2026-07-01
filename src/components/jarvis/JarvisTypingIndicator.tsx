"use client";

export default function JarvisTypingIndicator() {
  return (
    <div className="flex items-start gap-3 px-4">
      <div className="w-8 h-8 rounded-full bg-accent-tint flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-accent-text">J</span>
      </div>
      <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-primary animate-[jarvis-pulse_1.4s_ease-in-out_infinite]" />
          <span className="w-2 h-2 rounded-full bg-primary animate-[jarvis-pulse_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="w-2 h-2 rounded-full bg-primary animate-[jarvis-pulse_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
      </div>
    </div>
  );
}
