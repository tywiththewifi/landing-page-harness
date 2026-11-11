/**
 * A chevron whose shaft fades in and slides 6px right when its link or button is
 * hovered or focused. Decorative, so it's hidden from assistive tech: the label already
 * says where the link goes.
 */
export function HoverArrow() {
  return (
    <svg className="sl-hover-arrow" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" focusable="false">
      <g className="sl-hover-arrow__group">
        <path className="sl-hover-arrow__shaft" d="M-4 5h8" stroke="currentColor" strokeWidth="1.75" />
        <path d="M2 1.25 5.75 5 2 8.75" stroke="currentColor" strokeWidth="1.75" />
      </g>
    </svg>
  );
}
