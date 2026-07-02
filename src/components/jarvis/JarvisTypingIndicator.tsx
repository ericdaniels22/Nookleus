"use client";

// §5 (design system v2): while Jarvis is composing a reply the stream is
// shown as a single small pulsing --accent-text dot inside a Jarvis-style
// card bubble — no three-dot bounce, no skeletons mid-stream.
export default function JarvisTypingIndicator() {
  return (
    <div className="flex items-start gap-3 px-4" data-slot="jarvis-streaming">
      <div className="w-8 h-8 rounded-full bg-accent-tint flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-accent-text">J</span>
      </div>
      <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
        <span
          data-slot="jarvis-streaming-dot"
          role="status"
          aria-label="Jarvis is responding"
          className="block w-2 h-2 rounded-full bg-accent-text animate-[jarvis-pulse_1.4s_ease-in-out_infinite]"
        />
      </div>
    </div>
  );
}
