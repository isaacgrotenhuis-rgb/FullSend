import * as React from "react";

/**
 * Focus restoration for dialogs that are opened by parent state rather than by
 * a `DialogTrigger`.
 *
 * Radix's modal `Dialog.Content` and `AlertDialog.Content` handle their own
 * `onCloseAutoFocus`: they `preventDefault()` — which cancels FocusScope's
 * generic "focus whatever was focused before" restore — and then focus
 * `triggerRef.current`. With no trigger rendered that ref is null, so nothing
 * is focused and the browser drops focus to `<body>`. Keyboard users lose
 * their place every time a dialog closes, and nothing about it is visible.
 *
 * Every dialog in this app is opened from parent state, so both vendored
 * Content components wire this up. The returned handler captures whatever was
 * focused when the content first rendered and focuses it back on close; if
 * that element is gone from the document it stands down and lets Radix's own
 * behaviour run.
 */
export const useRestoreFocusOnClose = (
  onCloseAutoFocus?: (event: Event) => void
): ((event: Event) => void) => {
  const [opener] = React.useState<Element | null>(() =>
    typeof document === "undefined" ? null : document.activeElement
  );

  return React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      if (!(opener instanceof HTMLElement) || !opener.isConnected) return;
      event.preventDefault();
      opener.focus();
    },
    [onCloseAutoFocus, opener]
  );
};
