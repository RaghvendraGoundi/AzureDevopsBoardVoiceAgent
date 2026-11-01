/**
 * Icons from the variant B design (2px stroke, round caps). Decorative:
 * the buttons that use them carry the label.
 */

type IconProps = { size?: number; className?: string };

function Svg({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** The DevOps Voice mark: a ring, a dashed inner ring and an orange dot. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13" stroke="#F6F6F1" strokeWidth="2" />
      <circle cx="16" cy="16" r="7" stroke="#F6F6F1" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="16" cy="16" r="2.5" fill="#FF5600" />
    </svg>
  );
}

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </Svg>
);
export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3" />
  </Svg>
);
export const MuteIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M3 3l18 18" />
  </Svg>
);
export const CaptionsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 11h4M13 11h4M7 15h10" />
  </Svg>
);
export const InterruptIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 12V7M10 12V4M14 12V5M18 12V8M6 12c0 6 3 9 7 9s6-3 6-8v-1" />
  </Svg>
);
export const KeyboardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </Svg>
);
export const EndIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 15c5-5 11-5 16 0l-2 3-3-1.5v-2.5c-2-.7-4-.7-6 0v2.5L6 18z" />
  </Svg>
);
export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
  </Svg>
);
export const WorkspaceIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Svg>
);
export const CollapseLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const CollapseRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 5l14 14M19 5L5 19" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12l5 5L20 6" />
  </Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const HistoryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Svg>
);
export const BoardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="11" rx="1.5" />
    <rect x="17" y="4" width="4" height="7" rx="1.5" />
  </Svg>
);

/** Work item type glyphs, matched loosely by name so custom process types still get one. */
export function TypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  const t = type.toLowerCase();
  if (t === "bug" || t === "impediment" || t === "issue")
    return (
      <Svg size={size}>
        <circle cx="12" cy="13" r="5" />
        <path d="M12 8V5M7 11 4 9M17 11l3-2M7 15l-3 2M17 15l3 2" />
      </Svg>
    );
  if (t === "task")
    return (
      <Svg size={size}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8 12l3 3 5-6" />
      </Svg>
    );
  if (t === "epic")
    return (
      <Svg size={size}>
        <path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z" />
      </Svg>
    );
  if (t === "feature" || t === "initiative")
    return (
      <Svg size={size}>
        <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
      </Svg>
    );
  return (
    <Svg size={size}>
      <path d="M6 4h12v16l-6-4-6 4V4z" />
    </Svg>
  );
}
