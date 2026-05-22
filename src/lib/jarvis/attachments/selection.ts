// Attachment selection for Jarvis Chat attachments (#200).
//
// A Jarvis message carries at most five Chat attachments. This module is
// the gate between what the user picks (or drops) and what the message is
// allowed to hold: it admits as many newly-picked files as fit under the
// cap and reports the rest with a clear message. Pure logic — no I/O.

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export interface AttachmentAdmission<T> {
  // Files that fit under the cap and should be attached.
  accepted: T[];
  // Files turned away because the cap is reached.
  rejected: T[];
  // A user-facing message when files were turned away, else null.
  error: string | null;
}

// Given how many files are already attached (`currentCount`) and what the
// user just picked (`incoming`), admit as many of `incoming` as fit under
// the per-message cap.
export function admitAttachments<T>(
  currentCount: number,
  incoming: readonly T[],
): AttachmentAdmission<T> {
  const room = MAX_ATTACHMENTS_PER_MESSAGE - currentCount;
  const accepted = incoming.slice(0, Math.max(0, room));
  const rejected = incoming.slice(accepted.length);

  return {
    accepted,
    rejected,
    error:
      rejected.length > 0
        ? `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`
        : null,
  };
}
