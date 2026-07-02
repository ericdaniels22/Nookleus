"use client";

import {
  Inbox,
  Send,
  FileText,
  Trash2,
  Archive,
  ShieldAlert,
  Star,
  SquarePen,
} from "lucide-react";

interface FolderCounts {
  [key: string]: { total: number; unread: number };
}

interface IconRailProps {
  folder: string;
  counts: FolderCounts;
  onFolderChange: (key: string) => void;
  onCompose: () => void;
}

const FOLDER_ICONS = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileText },
  { key: "trash", label: "Trash", icon: Trash2 },
  { key: "archive", label: "Archive", icon: Archive },
  { key: "spam", label: "Spam", icon: ShieldAlert },
  { key: "starred", label: "Starred", icon: Star },
];

export default function IconRail({
  folder,
  counts,
  onFolderChange,
  onCompose,
}: IconRailProps) {
  return (
    <div className="w-14 border-r border-border bg-muted shrink-0 flex flex-col items-center py-2 gap-1">
      {/* Compose button */}
      <button
        onClick={onCompose}
        className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-all"
        title="Compose"
      >
        <SquarePen size={18} />
      </button>

      {/* Divider */}
      <div className="border-t border-border my-2 w-8" />

      {/* Folder icons */}
      {FOLDER_ICONS.map(({ key, label, icon: Icon }) => {
        const isActive = folder === key;
        const unread = counts[key]?.unread || 0;
        const total = counts[key]?.total || 0;
        const showBadge =
          (key === "inbox" && unread > 0) ||
          (key === "starred" && total > 0);
        const badgeValue = key === "starred" ? total : unread;

        return (
          <button
            key={key}
            onClick={() => onFolderChange(key)}
            title={label}
            className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-primary/5"
            }`}
          >
            <Icon size={18} />
            {showBadge && (
              <span className="absolute -top-1 -right-1 bg-primary/10 text-primary text-[11px] font-bold rounded-full min-w-[17px] h-[17px] px-1 flex items-center justify-center">
                {badgeValue > 99 ? "99+" : badgeValue}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
