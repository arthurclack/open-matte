// Small icons drawn inline, in the colour of the text beside them (styles.css, .icon).
// They replace the characters ▶, ▾ and ▸: iOS can draw ▶ as a coloured emoji, and
// screen readers read each one out as "black right-pointing triangle" and so on.
// Hidden from screen readers, so a button is named by its words alone, and never a
// stop for the keyboard.

// Every icon is 0.9em high. `w` is its width in sixteenths of that, so the box is no
// wider than the shape and the space beside it is the same as the character's was.
function Icon({ w, children }) {
  return (
    <svg
      className="icon"
      viewBox={`0 0 ${w} 16`}
      width={`${(w * 0.9) / 16}em`}
      height="0.9em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// Play, Resume and Preview.
export function PlayIcon() {
  return (
    <Icon w={11}>
      <path d="M0.5 2v12L11 8z" />
    </Icon>
  );
}

// A button that opens a menu.
export function MenuIcon() {
  return (
    <Icon w={7}>
      <path d="M0.5 5.5h6L3.5 10.7z" />
    </Icon>
  );
}

// Between the steps of a way through a device's menus, as in Settings ▸ Accessibility.
// A screen reader hears a comma there instead.
export function StepIcon() {
  return (
    <>
      <Icon w={6}>
        <path d="M0.5 5v6l5-3z" />
      </Icon>
      <span className="visually-hidden">,</span>
    </>
  );
}
