export interface KeyBinding {
  keys: string;
  label: string;
  group: "Transport" | "View" | "Annotation" | "Session";
}

/**
 * Documented in one place so the help sheet cannot drift from the handler.
 */
export const KEYMAP: KeyBinding[] = [
  { keys: "Space", label: "Play / pause", group: "Transport" },
  { keys: ", / .", label: "Step one frame", group: "Transport" },
  { keys: "← / →", label: "Step one frame", group: "Transport" },
  { keys: "Shift + ← / →", label: "Jump ten frames", group: "Transport" },
  { keys: "Home / End", label: "First / last frame", group: "Transport" },
  { keys: "[ / ]", label: "Previous / next annotated frame", group: "Transport" },
  { keys: "PgUp / PgDn", label: "Previous / next file", group: "Transport" },
  { keys: "L", label: "Cycle loop → bounce → off", group: "Transport" },
  { keys: "1–5", label: "Playback rate", group: "Transport" },

  { keys: "F", label: "Flip horizontally", group: "View" },
  { keys: "Shift + F", label: "Flip vertically", group: "View" },
  { keys: "R", label: "Rotate 90°", group: "View" },
  { keys: "+ / −", label: "Zoom in / out", group: "View" },
  { keys: "0", label: "Fit to window", group: "View" },
  { keys: "9", label: "Zoom to 100%", group: "View" },
  { keys: "Space + drag", label: "Pan", group: "View" },
  { keys: "V", label: "Value check (desaturate)", group: "View" },
  { keys: "G", label: "Cycle composition guides", group: "View" },
  { keys: "O", label: "Onion skin", group: "View" },

  { keys: "B", label: "Pen", group: "Annotation" },
  { keys: "H", label: "Highlighter", group: "Annotation" },
  { keys: "A", label: "Arrow", group: "Annotation" },
  { keys: "S", label: "Rectangle", group: "Annotation" },
  { keys: "E", label: "Ellipse", group: "Annotation" },
  { keys: "T", label: "Text", group: "Annotation" },
  { keys: "X", label: "Eraser", group: "Annotation" },
  { keys: "Cmd/Ctrl + Z", label: "Undo", group: "Annotation" },
  { keys: "Shift + Cmd/Ctrl + Z", label: "Redo", group: "Annotation" },
  { keys: "Alt + drag", label: "Laser pointer", group: "Annotation" },

  { keys: "M", label: "Take / release master", group: "Session" },
  { keys: "D", label: "Input log — every pointer event and what it did", group: "Session" },
  { keys: "?", label: "This help", group: "Session" },
];

/** True when focus is in a field, so shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}
