// Pure 2D point-generation for the profile-drawing tools, shared between
// plan2d.js (Vista 2D) and scene3d.js (Vista 3D) so both views draw exactly
// the same shapes for the same tool - previously each view had its own copy
// of this logic, and only the 2D one actually understood 3-point arcs.

export const TWO_POINT_TOOLS = ["rectangle", "circle", "ellipse", "polygon-inscribed", "polygon-circumscribed"];
export const THREE_POINT_TOOLS = ["arc3"];

function circlePoints(center, radius, segments = 48) {
  return Array.from({ length: segments }, (_, i) => {
    const t = (i / segments) * Math.PI * 2;
    return { x: center.x + Math.cos(t) * radius, y: center.y + Math.sin(t) * radius };
  });
}

function ellipsePoints(center, rx, ry, segments = 48) {
  return Array.from({ length: segments }, (_, i) => {
    const t = (i / segments) * Math.PI * 2;
    return { x: center.x + Math.cos(t) * rx, y: center.y + Math.sin(t) * ry };
  });
}

function polygonPoints(center, radius, sides, mode) {
  const n = Math.max(3, sides);
  // "inscribed": the clicked radius is the circumradius - vertices sit exactly
  // on that circle. "circumscribed": the clicked radius is the apothem (the
  // circle sits *inside* the polygon, touching each edge's midpoint), so the
  // vertices sit further out, at radius / cos(pi/n).
  const r = mode === "circumscribed" ? radius / Math.cos(Math.PI / n) : radius;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return { x: center.x + Math.cos(t) * r, y: center.y + Math.sin(t) * r };
  });
}

// Counterclockwise angular distance from `from` to `to`, always in [0, 2*PI).
const ccwDistance = (from, to) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

export function arcPoints(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return [a, b, c];
  const ux = ((a.x * a.x + a.y * a.y) * (b.y - c.y) + (b.x * b.x + b.y * b.y) * (c.y - a.y) + (c.x * c.x + c.y * c.y) * (a.y - b.y)) / d;
  const uy = ((a.x * a.x + a.y * a.y) * (c.x - b.x) + (b.x * b.x + b.y * b.y) * (a.x - c.x) + (c.x * c.x + c.y * c.y) * (b.x - a.x)) / d;
  const aa = Math.atan2(a.y - uy, a.x - ux), cc = Math.atan2(c.y - uy, c.x - ux), bb = Math.atan2(b.y - uy, b.x - ux);
  const r = Math.hypot(a.x - ux, a.y - uy);
  // Sweep from `aa` counterclockwise (increasing angle). If that direction
  // reaches `bb` before it reaches `cc`, that's the arc through the clicked
  // midpoint; otherwise the clockwise sweep is the one that passes through it.
  const distToB = ccwDistance(aa, bb);
  const distToC = ccwDistance(aa, cc);
  const end = distToB < distToC ? aa + distToC : aa - (2 * Math.PI - distToC);
  return Array.from({ length: 24 }, (_, i) => {
    const t = i / 23, ang = aa + (end - aa) * t;
    return { x: ux + Math.cos(ang) * r, y: uy + Math.sin(ang) * r };
  });
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

// Catmull-Rom spline through arbitrary control points. "spline" is a free-form
// multi-click tool like "line" (not a fixed 2/3-point primitive), so it needs
// at least 3 clicked points before there's a meaningful curve to interpolate.
// `closed: true` treats the control points as a cyclic loop (used once the
// profile is actually being closed into a shape) so the curve wraps smoothly
// back to the first point instead of leaving a straight "seam" where a closed
// polygon would normally just connect the last raw click back to the first.
export function splinePoints(controlPoints, { closed = false, segmentsPerSpan = 12 } = {}) {
  const pts = controlPoints;
  if (pts.length < 3) return pts;
  const n = pts.length;
  if (!closed) {
    const at = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    const out = [pts[0]];
    for (let i = 0; i < n - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let s = 1; s <= segmentsPerSpan; s++) out.push(catmullRom(p0, p1, p2, p3, s / segmentsPerSpan));
    }
    return out;
  }
  const at = (i) => pts[((i % n) + n) % n];
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < segmentsPerSpan; s++) out.push(catmullRom(p0, p1, p2, p3, s / segmentsPerSpan));
  }
  return out;
}

export function makeShapePoints(tool, pts, options = {}) {
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[1];
  const r = Math.hypot(b.x - a.x, b.y - a.y);
  if (tool === "rectangle") return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
  if (tool === "circle") return circlePoints(a, r, 48);
  if (tool === "ellipse") return ellipsePoints(a, Math.abs(b.x - a.x), Math.abs(b.y - a.y), 48);
  if (tool === "polygon-inscribed") return polygonPoints(a, r, options.sides || 6, "inscribed");
  if (tool === "polygon-circumscribed") return polygonPoints(a, r, options.sides || 6, "circumscribed");
  if (tool === "arc3" && pts.length >= 3) return arcPoints(pts[0], pts[1], pts[2]);
  if (tool === "spline" && pts.length >= 3) return splinePoints(pts, { closed: !!options.closed });
  return null;
}
