/**
 * Geometry for the curved "creative" bottom bar: a floating rounded bar whose top edge dips into a smooth
 * U-shaped notch that cradles the raised Studio (+) button.
 */
export const BAR = {
  height: 68, // visible bar body
  top: 50, // transparent space above the bar body for the raised button + its light ring
  fab: 62, // button diameter
  ring: 88, // light-ring container
  pad: 6, // room for the outer glow stroke inside the SVG
  radius: 26,
  notchHalf: 60, // half width of the notch opening
  notchDepth: 37,
  margin: 10, // horizontal margin of the floating bar
  maxWidth: 560,
};

export function barPath(w: number) {
  const { top: y0, height, pad: p, radius: r, notchHalf: nw, notchDepth: d } = BAR;
  const x0 = p, x1 = w - p, yb = y0 + height - p, cx = w / 2;
  return [
    `M ${x0} ${y0 + r}`, `Q ${x0} ${y0} ${x0 + r} ${y0}`,
    `L ${cx - nw} ${y0}`,
    `C ${cx - nw + 28} ${y0} ${cx - 42} ${y0 + d} ${cx} ${y0 + d}`,
    `C ${cx + 42} ${y0 + d} ${cx + nw - 28} ${y0} ${cx + nw} ${y0}`,
    `L ${x1 - r} ${y0}`, `Q ${x1} ${y0} ${x1} ${y0 + r}`,
    `L ${x1} ${yb - r}`, `Q ${x1} ${yb} ${x1 - r} ${yb}`,
    `L ${x0 + r} ${yb}`, `Q ${x0} ${yb} ${x0} ${yb - r}`, 'Z',
  ].join(' ');
}
/** Centre of the raised button, in bar coordinates. */
export const fabCenterY = () => BAR.top - 3;
