/**
 * Icons from Lucide (lucide.dev, ISC licence): one consistent line set at
 * a 1.75 stroke. Decorative: the buttons that use them carry the label.
 */

import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Bug,
  Captions,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Crown,
  ExternalLink,
  FileText,
  Flag,
  Hand,
  History,
  Keyboard,
  Layers,
  type LucideIcon,
  MessageSquareText,
  MessagesSquare,
  Mic,
  MicOff,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  PhoneOff,
  Plus,
  RotateCcw,
  SquareCheckBig,
  SquareKanban,
  Trash2,
  X,
} from "lucide-react";

type IconProps = { size?: number; className?: string };

const icon = (Icon: LucideIcon, defaultSize = 18) =>
  function DvIcon({ size = defaultSize, className }: IconProps) {
    return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden="true" />;
  };

/** The DevOps Voice mark: dotted rings in a soft tile, with the orange signal dot. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" aria-hidden="true">
      <rect x="0.5" y="0.5" width="41" height="41" rx="13" fill="rgba(255,255,255,.04)" stroke="rgba(160,185,230,.26)" />
      <circle cx="21" cy="21" r="12.5" fill="none" stroke="#cfd9ee" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.1 4.3" />
      <circle cx="21" cy="21" r="6.5" fill="none" stroke="rgba(207,217,238,.5)" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.1 3.4" />
      <circle cx="21" cy="21" r="3.3" fill="#FF5600" />
    </svg>
  );
}

export const MicIcon = icon(Mic);
export const MuteIcon = icon(MicOff);
export const CaptionsIcon = icon(Captions);
export const InterruptIcon = icon(Hand);
export const KeyboardIcon = icon(Keyboard);
export const EndIcon = icon(PhoneOff);
export const ChatIcon = icon(MessagesSquare);
export const WorkspaceIcon = icon(Layers);
export const CollapseLeftIcon = icon(PanelLeftClose);
export const CollapseRightIcon = icon(PanelRightClose);
export const CloseIcon = icon(X);
export const CheckIcon = icon(Check);
export const SendIcon = icon(ArrowRight);
export const PlusIcon = icon(Plus);
export const HistoryIcon = icon(History);
export const TrashIcon = icon(Trash2);
export const BoardIcon = icon(SquareKanban);
export const ChevronLeftIcon = icon(ChevronLeft);
export const ChevronRightIcon = icon(ChevronRight);
export const ChevronDownIcon = icon(ChevronDown);
export const ReplayIcon = icon(RotateCcw);
export const WaveIcon = icon(AudioLines);
export const ParentIcon = icon(CornerDownRight, 14);
export const FlagIcon = icon(Flag, 13);
export const CommentIcon = icon(MessageSquareText);
export const DescriptionIcon = icon(FileText);
export const EditIcon = icon(Pencil);
export const ExternalIcon = icon(ExternalLink, 14);

/** The work item type's icon: task, bug, story/requirement, feature/initiative, epic. */
export function TypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  const t = type.toLowerCase();
  const Icon =
    t === "bug" || t === "impediment" || t === "issue"
      ? Bug
      : t === "task"
        ? SquareCheckBig
        : t === "epic"
          ? Crown
          : t === "feature" || t === "initiative"
            ? Flag
            : BookOpen;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}
