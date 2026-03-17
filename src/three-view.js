// src/three-view.js — Self-contained Three.js 3D room viewer
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DEFAULT_WALL_HEIGHT_CM } from "./constants.js";

// --- 3D color palette (pulled from CSS variables / 2D room rendering) ---
const FLOOR_COLOR = 0x3b82f6;    // --accent / selected room fill (#3b82f6)
const FLOOR_OPACITY = 0.25;      // matches rgba(59,130,246,0.25)
const WALL_COLOR = 0x6496c8;     // unselected room fill tone (rgb(100,150,200))
const WALL_HOVER_COLOR = 0x3b82f6; // selection blue (#3b82f6)
const EDGE_COLOR = 0xc8dcff;     // room stroke (rgba(200,220,255))
const SURFACE_HIGHLIGHT_OPACITY = 0.45;   // hover/selected floor opacity
const BG_COLOR = 0x081022;       // .svgWrap background
const UNSELECTED_FLOOR_COLOR = 0x334155;
const UNSELECTED_FLOOR_OPACITY = 0.12;
const UNSELECTED_WALL_COLOR = 0x4a5568;
const UNSELECTED_EDGE_COLOR = 0x6b7280;
const EXCLUSION_COLOR = 0xef4444; // red for exclusion zones

// --- Surface layering offsets (cm) ---
// Physical offset from base surface to avoid z-fighting.
// Layers ordered: base mesh < grout < tiles < skirting / exclusions.
const SURFACE_GROUT_OFFSET     = 0.3; // wall grout quad → outward from wall mesh
const SURFACE_TILE_OFFSET      = 0.5; // floor Y, obj3d top Y, obj3d side normal
const SURFACE_TILE_OFFSET_WALL = 0.6; // wall tiles → outward (in front of grout, behind skirting)
const SURFACE_SKIRTING_OFFSET  = 0.9; // wall skirting → outward
const SURFACE_EXCL_OFFSET      = 1.0; // floor exclusion Y

// --- Tile path parsing helpers ---

/** Parse "M x y L x y ... Z M x y ..." into array of rings [{x,y}...] */
function parseTilePathD(d) {
  if (!d || typeof d !== "string") return [];
  const rings = [];
  let current = null;
  const tokens = d.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "M") {
      current = [];
      rings.push(current);
      const px = parseFloat(tokens[i + 1]), py = parseFloat(tokens[i + 2]);
      if (!isNaN(px) && !isNaN(py)) current.push({ x: px, y: py });
      i += 3;
    } else if (t === "L") {
      const px = parseFloat(tokens[i + 1]), py = parseFloat(tokens[i + 2]);
      if (current && !isNaN(px) && !isNaN(py)) current.push({ x: px, y: py });
      i += 3;
    } else if (t === "Z") {
      i++;
    } else {
      // implicit coordinate pair (continuation of L)
      const px = parseFloat(tokens[i]), py = parseFloat(tokens[i + 1]);
      if (current && !isNaN(px) && !isNaN(py)) current.push({ x: px, y: py });
      i += 2;
    }
  }
  return rings;
}

/** Parse "#rrggbb" hex string to THREE.Color */
function parseHexColor(hex) {
  if (!hex || typeof hex !== "string") return new THREE.Color(0xffffff);
  return new THREE.Color(hex);
}

/**
 * Creates a mapper from wall surface local 2D coords to 3D wall face coords.
 * surfaceVerts[0..3] map to: A@ground, B@ground, B@height, A@height.
 * hStart/hEnd allow per-edge height interpolation for sloped walls.
 */
function createWallMapper(surfaceVerts, ax, az, bx, bz, hStart, hEnd) {
  if (!surfaceVerts || surfaceVerts.length < 4) {
    console.log(`[three-view] mapper: NULL (surfaceVerts=${surfaceVerts?.length ?? 0})`);
    return null;
  }
  const P0 = surfaceVerts[0];
  const U = { x: surfaceVerts[1].x - P0.x, y: surfaceVerts[1].y - P0.y };
  const V = { x: surfaceVerts[3].x - P0.x, y: surfaceVerts[3].y - P0.y };
  const det = U.x * V.y - U.y * V.x;
  if (Math.abs(det) < 0.0001) {
    console.warn(`[three-view] createWallMapper: skipping degenerate surface (det=${det.toFixed(6)})`);
    return null;
  }
  const invDet = 1 / det;
  return function (sx, sy) {
    const dx = sx - P0.x, dy = sy - P0.y;
    const t = (V.y * dx - V.x * dy) * invDet;
    const s = (-U.y * dx + U.x * dy) * invDet;
    const h = hStart + (hEnd - hStart) * t;
    return {
      x: ax + t * (bx - ax),
      y: s * h,
      z: az + t * (bz - az),
    };
  };
}

/** Wrap a mapper so every output point is pushed along (nx, nz) by `offset` cm. */
function createOffsetMapper(mapper, nx, nz, offset) {
  return (x, y) => {
    const p = mapper(x, y);
    return { x: p.x + nx * offset, y: p.y, z: p.z + nz * offset };
  };
}

/**
 * Create a grout background quad for a wall surface.
 * Walls need an explicit grout quad because one wall mesh has two surfaces
 * (inner/outer) and only one may be tiled.
 */
function createGroutQuad(surfaceVerts, mapper, nx, nz, groutColorHex) {
  if (!surfaceVerts || surfaceVerts.length < 4) {
    console.warn(`[three-view] createGroutQuad: dropped (verts=${surfaceVerts?.length})`);
    return null;
  }
  const groutMapper = createOffsetMapper(mapper, nx, nz, SURFACE_GROUT_OFFSET);
  const corners = surfaceVerts.map(v => groutMapper(v.x, v.y));
  const positions = new Float32Array(corners.flatMap(c => [c.x, c.y, c.z]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    color: parseHexColor(groutColorHex),
    side: THREE.DoubleSide,
  });
  console.log(`[three-view] createGroutQuad: color=${groutColorHex}`);
  return new THREE.Mesh(geo, mat);
}

/**
 * Render a corner fill prism into a THREE.js scene.
 * Handles both triangle fills (same-room reflex vertices, p4 absent) and
 * quad fills (cross-room corner gaps, p4 = outer corner present).
 *
 * Triangle fill (p4 absent): p1, p2 are the outer face endpoints; p3 is the inner vertex.
 * Quad fill (p4 present): p1, p2 are outer face endpoints of the two walls,
 *   p4 is the outer corner (line intersection), p3 = p1+p2-p4 (inner corner).
 */
function renderCornerFill(fill, scene, baseColor, linesMat) {
  const { p1, p2, p3, p4, h } = fill;
  let positions, indices;

  if (p4) {
    // Quad fill: vertices 0-3 floor, 4-7 ceiling
    // 0=p1, 1=p2, 2=p3(inner), 3=p4(outer corner)
    positions = new Float32Array([
      p1.x, 0, p1.y,  // 0 p1 floor
      p2.x, 0, p2.y,  // 1 p2 floor
      p3.x, 0, p3.y,  // 2 p3 floor (inner corner)
      p4.x, 0, p4.y,  // 3 p4 floor (outer corner)
      p1.x, h, p1.y,  // 4 p1 ceil
      p2.x, h, p2.y,  // 5 p2 ceil
      p3.x, h, p3.y,  // 6 p3 ceil (inner corner)
      p4.x, h, p4.y,  // 7 p4 ceil (outer corner)
    ]);
    indices = [
      // Top face (p3→p1→p4→p2 quad, split into 2 triangles)
      6, 4, 7,  6, 7, 5,
      // Side A: p1 → p4 (outer face along wall A direction)
      0, 3, 7,  0, 7, 4,
      // Side B: p4 → p2 (outer face along wall B direction)
      3, 1, 5,  3, 5, 7,
    ];
  } else {
    // Triangle fill (same as before — same-room reflex vertex gap)
    positions = new Float32Array([
      p1.x, 0, p1.y,  // 0: p1 floor
      p2.x, 0, p2.y,  // 1: p2 floor
      p3.x, 0, p3.y,  // 2: p3 floor (inner vertex)
      p1.x, h, p1.y,  // 3: p1 ceiling
      p2.x, h, p2.y,  // 4: p2 ceiling
      p3.x, h, p3.y,  // 5: p3 ceiling
    ]);
    indices = [
      3, 5, 4,       // top triangle
      0, 1, 4,  0, 4, 3,  // outer side (p1–p2)
    ];
  }

  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  fillGeo.setIndex(indices);
  fillGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(fillGeo, new THREE.MeshLambertMaterial({
    color: baseColor, side: THREE.DoubleSide,
  })));
  scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(fillGeo, 30), linesMat));
}

/**
 * Build wall geometry with doorway holes cut through it.
 * For walls without doorways, produces a simple 8-vertex box.
 * For walls with doorways, uses ShapeGeometry for inner/outer faces
 * with holes, plus reveal quads connecting the two faces at each opening.
 */
function buildWallGeo(iax, iaz, ibx, ibz, oax, oaz, obx, obz, hA, hB, edgeLen, doorways) {
  // 2D parametric mappers — (u along edge, v height) → 3D position
  function innerXYZ(u, v) {
    const t = edgeLen > 0 ? u / edgeLen : 0;
    return [iax + t * (ibx - iax), v, iaz + t * (ibz - iaz)];
  }
  function outerXYZ(u, v) {
    const t = edgeLen > 0 ? u / edgeLen : 0;
    return [oax + t * (obx - oax), v, oaz + t * (obz - oaz)];
  }

  if (!doorways || doorways.length === 0) {
    // Simple box — 8 vertices, 6 faces × 2 triangles
    const positions = new Float32Array([
      iax, 0,  iaz,   // 0: inner-bottom-A
      ibx, 0,  ibz,   // 1: inner-bottom-B
      obx, 0,  obz,   // 2: outer-bottom-B
      oax, 0,  oaz,   // 3: outer-bottom-A
      iax, hA, iaz,   // 4: inner-top-A
      ibx, hB, ibz,   // 5: inner-top-B
      obx, hB, obz,   // 6: outer-top-B
      oax, hA, oaz,   // 7: outer-top-A
    ]);
    const indices = [
      0, 5, 1,  0, 4, 5,   // Inner face
      2, 7, 3,  2, 6, 7,   // Outer face
      4, 6, 5,  4, 7, 6,   // Top
      0, 1, 2,  0, 2, 3,   // Bottom
      0, 3, 7,  0, 7, 4,   // Left cap
      1, 5, 6,  1, 6, 2,   // Right cap
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    console.log(`[three-view] wallGeo: simple box, 8 verts, 12 tris, h=${hA}/${hB}, len=${edgeLen?.toFixed(1)}`);
    return geo;
  }

  // --- Complex geometry with doorway holes ---
  const verts = [];
  const idx = [];

  function addV(x, y, z) {
    const vi = verts.length / 3;
    verts.push(x, y, z);
    return vi;
  }
  function addTri(a, b, c) { idx.push(a, b, c); }
  function addQuad(a, b, c, d) { idx.push(a, b, c, a, c, d); }

  // Wall face shape (trapezoid) in 2D (u, v) space
  const faceShape = new THREE.Shape();
  faceShape.moveTo(0, 0);
  faceShape.lineTo(edgeLen, 0);
  faceShape.lineTo(edgeLen, hB);
  faceShape.lineTo(0, hA);
  faceShape.closePath();

  // Pre-compute clamped doorway heights so hole and reveals stay within face
  const clampedDoorways = doorways.map(dw => {
    const off = Math.max(0, dw.offsetCm);
    let w = dw.widthCm;
    if (off + w > edgeLen) {
      console.warn(`[three-view] buildWallGeo: clamping doorway width from ${w.toFixed(1)} to ${(edgeLen - off).toFixed(1)} (offset=${off.toFixed(1)}, edgeLen=${edgeLen.toFixed(1)})`);
      w = Math.max(0, edgeLen - off);
    }
    const elev = dw.elevationCm || 0;
    const tMid = edgeLen > 0 ? (off + w / 2) / edgeLen : 0;
    const wallHere = hA + (hB - hA) * tMid;
    const h = Math.min(dw.heightCm, wallHere - elev);
    return { ...dw, offsetCm: off, widthCm: w, _clampedH: h, _elev: elev };
  }).filter(dw => dw._clampedH > 0 && dw.widthCm > 0);

  for (const dw of clampedDoorways) {
    const off = dw.offsetCm;
    const w = dw.widthCm;
    const elev = dw._elev;
    const h = dw._clampedH;
    const hole = new THREE.Path();
    hole.moveTo(off, elev);
    hole.lineTo(off + w, elev);
    hole.lineTo(off + w, elev + h);
    hole.lineTo(off, elev + h);
    hole.closePath();
    faceShape.holes.push(hole);
  }

  const shapeGeo = new THREE.ShapeGeometry(faceShape);
  const sp = shapeGeo.attributes.position.array;
  const si = shapeGeo.index.array;

  // Inner face — map 2D shape vertices to 3D inner positions
  const innerBase = verts.length / 3;
  for (let k = 0; k < sp.length; k += 3) {
    const [x, y, z] = innerXYZ(sp[k], sp[k + 1]);
    verts.push(x, y, z);
  }
  for (let k = 0; k < si.length; k += 3) {
    addTri(si[k] + innerBase, si[k + 1] + innerBase, si[k + 2] + innerBase);
  }

  // Outer face — map to outer positions, reverse winding
  const outerBase = verts.length / 3;
  for (let k = 0; k < sp.length; k += 3) {
    const [x, y, z] = outerXYZ(sp[k], sp[k + 1]);
    verts.push(x, y, z);
  }
  for (let k = 0; k < si.length; k += 3) {
    addTri(si[k] + outerBase, si[k + 2] + outerBase, si[k + 1] + outerBase);
  }

  shapeGeo.dispose();

  // Top face
  addQuad(
    addV(iax, hA, iaz), addV(ibx, hB, ibz),
    addV(obx, hB, obz), addV(oax, hA, oaz)
  );

  // Bottom face — split around ground-level doorways
  const groundDw = clampedDoorways
    .filter(dw => dw._elev < 0.1)
    .sort((a, b) => a.offsetCm - b.offsetCm);

  let cursor = 0;
  for (const dw of groundDw) {
    if (dw.offsetCm > cursor + 0.1) {
      addQuad(
        addV(...innerXYZ(cursor, 0)), addV(...innerXYZ(dw.offsetCm, 0)),
        addV(...outerXYZ(dw.offsetCm, 0)), addV(...outerXYZ(cursor, 0))
      );
    }
    cursor = Math.max(cursor, dw.offsetCm + dw.widthCm);
  }
  if (cursor < edgeLen - 0.1) {
    addQuad(
      addV(...innerXYZ(cursor, 0)), addV(...innerXYZ(edgeLen, 0)),
      addV(...outerXYZ(edgeLen, 0)), addV(...outerXYZ(cursor, 0))
    );
  }

  // Left cap (at vertex A)
  addQuad(
    addV(iax, 0, iaz), addV(oax, 0, oaz),
    addV(oax, hA, oaz), addV(iax, hA, iaz)
  );
  // Right cap (at vertex B)
  addQuad(
    addV(ibx, 0, ibz), addV(ibx, hB, ibz),
    addV(obx, hB, obz), addV(obx, 0, obz)
  );

  // Doorway reveals — connect inner to outer at each opening
  for (const dw of clampedDoorways) {
    const off = dw.offsetCm;
    const w = dw.widthCm;
    const elev = dw._elev;
    const h = dw._clampedH;

    // Left reveal
    addQuad(
      addV(...innerXYZ(off, elev)), addV(...outerXYZ(off, elev)),
      addV(...outerXYZ(off, elev + h)), addV(...innerXYZ(off, elev + h))
    );
    // Right reveal
    addQuad(
      addV(...innerXYZ(off + w, elev)), addV(...innerXYZ(off + w, elev + h)),
      addV(...outerXYZ(off + w, elev + h)), addV(...outerXYZ(off + w, elev))
    );
    // Lintel (top of doorway)
    addQuad(
      addV(...innerXYZ(off, elev + h)), addV(...outerXYZ(off, elev + h)),
      addV(...outerXYZ(off + w, elev + h)), addV(...innerXYZ(off + w, elev + h))
    );
    // Sill (bottom of doorway, if elevated)
    if (elev > 0.1) {
      addQuad(
        addV(...innerXYZ(off, elev)), addV(...innerXYZ(off + w, elev)),
        addV(...outerXYZ(off + w, elev)), addV(...outerXYZ(off, elev))
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  console.log(`[three-view] wallGeo: doorway-holes, ${verts.length / 3} verts, ${idx.length / 3} tris, ${doorways.length} doorways, h=${hA}/${hB}, len=${edgeLen?.toFixed(1)}`);
  return geo;
}

/** Convert an exclusion to a THREE.Shape in 2D surface-local coords. */
function exclusionToShape(ex) {
  if (!ex || !ex.type) return null;
  const shape = new THREE.Shape();
  if (ex.type === "rect") {
    if (ex.x == null || ex.y == null || ex.w == null || ex.h == null) return null;
    shape.moveTo(ex.x, ex.y);
    shape.lineTo(ex.x + ex.w, ex.y);
    shape.lineTo(ex.x + ex.w, ex.y + ex.h);
    shape.lineTo(ex.x, ex.y + ex.h);
    shape.closePath();
  } else if (ex.type === "circle") {
    const rx = ex.rx || ex.r || 10;
    const ry = ex.ry || ex.r || 10;
    // Approximate ellipse with 48 segments
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const px = ex.cx + rx * Math.cos(a);
      const py = ex.cy + ry * Math.sin(a);
      if (i === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    }
    shape.closePath();
  } else if (ex.type === "tri") {
    shape.moveTo(ex.p1.x, ex.p1.y);
    shape.lineTo(ex.p2.x, ex.p2.y);
    shape.lineTo(ex.p3.x, ex.p3.y);
    shape.closePath();
  } else if (ex.type === "freeform" && ex.vertices?.length >= 3) {
    shape.moveTo(ex.vertices[0].x, ex.vertices[0].y);
    for (let i = 1; i < ex.vertices.length; i++) {
      shape.lineTo(ex.vertices[i].x, ex.vertices[i].y);
    }
    shape.closePath();
  } else {
    return null;
  }
  return shape;
}

/** Transform all vertices in a ShapeGeometry from 2D (x,y,0) to 3D via mapper. */
function transformShapeGeo(geo, mapper) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const p = mapper(pos.getX(i), pos.getY(i));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** Floor mapper: maps 2D (x,y) to XZ plane at Y=0 with offset. */
function createFloorMapper(pos) {
  return (x, y) => ({ x: pos.x + x, y: 0, z: pos.y + y });
}

/**
 * Create a mapper for a box face that maps 2D surface coords (sx, sy) to 3D world coords.
 * sx: 0..faceWidth along the face's horizontal axis
 * sy: 0..faceHeight along the face's vertical axis (0 = bottom/near, faceHeight = top/far)
 * For side faces: sx = along face width, sy = up from floor (0=floor, h=top)
 * For top face: sx = along width, sy = along depth
 */
function createBoxFaceMapper(obj, roomPos, face) {
  const h = obj.heightCm || 100;

  // Get vertices and bounding box for any object type
  let verts;
  if (obj.type === "tri") {
    verts = [obj.p1, obj.p2, obj.p3];
  } else if (obj.type === "freeform" && obj.vertices?.length >= 3) {
    verts = obj.vertices;
  } else {
    // rect
    verts = [
      { x: obj.x, y: obj.y },
      { x: obj.x + obj.w, y: obj.y },
      { x: obj.x + obj.w, y: obj.y + obj.h },
      { x: obj.x, y: obj.y + obj.h },
    ];
  }

  const xs = verts.map(v => v.x), ys = verts.map(v => v.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const ox = roomPos.x + minX;
  const oz = roomPos.y + minY;
  const w = Math.max(...xs) - minX;
  const d = Math.max(...ys) - minY;

  // Handle side-N faces for tri/freeform
  const sideMatch = face.match(/^side-(\d+)$/);
  if (sideMatch) {
    const idx = parseInt(sideMatch[1]);
    const a = verts[idx], b = verts[(idx + 1) % verts.length];
    if (!a || !b) return null;
    const ax = roomPos.x + a.x, az = roomPos.y + a.y;
    const bx = roomPos.x + b.x, bz = roomPos.y + b.y;
    const edgeLen = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2);
    if (edgeLen < 0.01) return null;
    const dx = (bx - ax) / edgeLen, dz = (bz - az) / edgeLen;
    // sx = along edge, sy = up
    return (sx, sy) => ({ x: ax + dx * sx, y: sy, z: az + dz * sx });
  }

  switch (face) {
    case "front":
      return (sx, sy) => ({ x: ox + sx, y: sy, z: oz });
    case "back":
      return (sx, sy) => ({ x: ox + w - sx, y: sy, z: oz + d });
    case "left":
      return (sx, sy) => ({ x: ox, y: sy, z: oz + sx });
    case "right":
      return (sx, sy) => ({ x: ox + w, y: sy, z: oz + d - sx });
    case "top":
      return (sx, sy) => ({ x: ox + sx, y: h, z: oz + sy });
    default:
      return null;
  }
}

/**
 * Renders tiles + exclusions for any surface (floor or wall).
 * @param {Object} opts
 * @param {Array}  opts.tiles       - Tile objects with { d, isFull, excluded }
 * @param {Array}  opts.exclusions  - Exclusion objects (rect/circle/tri/freeform)
 * @param {string} opts.groutColor  - Hex string like "#ffffff"
 * @param {Function} opts.mapper    - (x, y) → { x, y, z } maps 2D surface coords to 3D
 * @param {number} [opts.tileZBias=0]     - polygonOffset factor for tile meshes
 * @param {number} [opts.exclZBias=0]     - polygonOffset factor for exclusion meshes
 * @returns {{ meshes: THREE.Object3D[], lines: THREE.Object3D[] }}
 */
function renderSurface3D(opts) {
  const { tiles, exclusions, mapper, tileZBias = 0, exclZBias = 0 } = opts;
  const groutColor = parseHexColor(opts.groutColor);
  const meshes = [];
  const lines = [];

  // --- Tiles ---
  if (tiles && tiles.length > 0) {
    const fullShapes = [];
    const cutShapes = [];
    const excludedShapes = [];

    for (const tile of tiles) {
      const rings = parseTilePathD(tile.d);
      const bucket = tile.excluded ? excludedShapes : (tile.isFull ? fullShapes : cutShapes);
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const shape = new THREE.Shape();
        shape.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i].x, ring[i].y);
        shape.closePath();
        bucket.push(shape);
      }
    }

    // Contrast colors based on grout luminance
    const groutLum = groutColor.r * 0.299 + groutColor.g * 0.587 + groutColor.b * 0.114;
    const outlineHex = groutLum > 0.5 ? 0x000000 : 0xffffff;
    const tileFillHex = outlineHex;

    const tileGroups = [
      { shapes: fullShapes, color: tileFillHex, opacity: 0.12 },
      { shapes: cutShapes, color: tileFillHex, opacity: 0.06 },
      { shapes: excludedShapes, color: EXCLUSION_COLOR, opacity: 0.25 },
    ];

    for (const group of tileGroups) {
      if (group.shapes.length === 0) continue;
      const geo = new THREE.ShapeGeometry(group.shapes);
      transformShapeGeo(geo, mapper);
      const usePO = tileZBias !== 0;
      const mat = new THREE.MeshBasicMaterial({
        color: group.color,
        transparent: true,
        opacity: group.opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: usePO,
        polygonOffsetFactor: usePO ? tileZBias : 0,
        polygonOffsetUnits: usePO ? tileZBias : 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { type: "tiles" };
      meshes.push(mesh);
    }

    // Tile edge outlines
    const lineMat = new THREE.LineBasicMaterial({
      color: outlineHex,
      transparent: true,
      opacity: 0.35,
    });
    for (const tile of tiles) {
      if (tile.excluded) continue;
      const rings = parseTilePathD(tile.d);
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const points = [];
        for (const pt of ring) {
          const p = mapper(pt.x, pt.y);
          points.push(new THREE.Vector3(p.x, p.y, p.z));
        }
        points.push(points[0].clone());
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(lineGeo, lineMat);
        line.userData = { type: "tileEdge" };
        lines.push(line);
      }
    }
  }

  // --- Exclusions ---
  if (exclusions && exclusions.length > 0) {
    const OBJ3D_FLOOR_COLOR = 0x22c55e;
    const TILED_EXCL_COLOR = 0x22c55e;
    const exclMat = new THREE.MeshBasicMaterial({
      color: EXCLUSION_COLOR,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: exclZBias !== 0,
      polygonOffsetFactor: exclZBias !== 0 ? exclZBias : 0,
      polygonOffsetUnits: exclZBias !== 0 ? exclZBias : 0,
    });
    const obj3dMat = new THREE.MeshBasicMaterial({
      color: OBJ3D_FLOOR_COLOR,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: exclZBias !== 0,
      polygonOffsetFactor: exclZBias !== 0 ? exclZBias : 0,
      polygonOffsetUnits: exclZBias !== 0 ? exclZBias : 0,
    });
    const tiledExclMat = new THREE.MeshBasicMaterial({
      color: TILED_EXCL_COLOR,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: exclZBias !== 0,
      polygonOffsetFactor: exclZBias !== 0 ? exclZBias : 0,
      polygonOffsetUnits: exclZBias !== 0 ? exclZBias : 0,
    });
    const exclLineMat = new THREE.LineBasicMaterial({
      color: EXCLUSION_COLOR,
      transparent: true,
      opacity: 0.8,
    });
    const obj3dLineMat = new THREE.LineBasicMaterial({
      color: OBJ3D_FLOOR_COLOR,
      transparent: true,
      opacity: 0.8,
    });
    const tiledExclLineMat = new THREE.LineBasicMaterial({
      color: TILED_EXCL_COLOR,
      transparent: true,
      opacity: 0.8,
    });

    for (const ex of exclusions) {
      const shape = exclusionToShape(ex);
      if (!shape) continue;
      const isObj3d = ex._isObject3d;
      const isTiled = !!ex.tile;

      const geo = new THREE.ShapeGeometry(shape);
      transformShapeGeo(geo, mapper);
      const mesh = new THREE.Mesh(geo, isObj3d ? obj3dMat : (isTiled ? tiledExclMat : exclMat));
      mesh.userData = { type: "exclusion" };
      meshes.push(mesh);

      // Outline
      const pts = shape.getPoints(ex.type === "circle" ? 64 : undefined);
      const linePoints = [];
      for (const pt of pts) {
        const p = mapper(pt.x, pt.y);
        linePoints.push(new THREE.Vector3(p.x, p.y, p.z));
      }
      linePoints.push(linePoints[0].clone());
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
      const line = new THREE.Line(lineGeo, isObj3d ? obj3dLineMat : (isTiled ? tiledExclLineMat : exclLineMat));
      line.userData = { type: "exclusionEdge" };
      lines.push(line);
    }
  }

  return { meshes, lines };
}

/**
 * Creates a Three.js 3D view controller for floor visualization.
 * @param {{ canvas: HTMLCanvasElement, onWallDoubleClick: Function, onHoverChange: Function, onRoomSelect: Function }} opts
 */
// Export pure helper functions for unit testing
export { parseTilePathD, parseHexColor, createWallMapper, createFloorMapper, createBoxFaceMapper, createOffsetMapper, createGroutQuad, exclusionToShape, buildWallGeo };

export function createThreeViewController({ canvas, onWallDoubleClick, onRoomDoubleClick, onHoverChange, onRoomSelect, onSurfaceSelect, onObjectSelect, onObjectDoubleClick }) {
  let renderer, camera, controls, scene;
  let animFrameId = null;
  let active = false;
  let initialized = false;

  // Interaction state
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let wallMeshes = [];
  let floorMeshes = [];
  let object3dMeshes = [];
  let hoveredMesh = null;

  // Camera stability: only auto-frame when room set changes
  let lastFloorRoomIds = null;

  // Click-to-select: anti-drag guard
  let pointerDownPos = null;

  // --- Init (lazy) ---
  function init() {
    if (initialized) return;
    initialized = true;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(BG_COLOR);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50000);

    scene = new THREE.Scene();

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(500, 1000, 500);
    scene.add(dir);

    // OrbitControls
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    // Event listeners on canvas
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);

    resize();
  }

  // --- Resize ---
  function resize() {
    if (!renderer) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // --- Build scene from floor data (multiple rooms) ---
  function buildScene(floorData) {
    if (!scene) return;

    // Clear previous objects (keep lights)
    const toRemove = [];
    scene.traverse((obj) => {
      if (obj.isMesh || obj.isLineSegments || obj.isLine) toRemove.push(obj);
    });
    for (const obj of toRemove) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose();
      scene.remove(obj);
    }
    wallMeshes = [];
    floorMeshes = [];
    object3dMeshes = [];
    hoveredMesh = null;

    const { rooms, walls, showWalls, selectedRoomId, selectedSurfaceEdgeIndex } = floorData;
    console.log(`[three-view] buildScene: ${rooms.length} rooms, ${(walls || []).length} walls (cleared ${toRemove.length} objects, showWalls=${showWalls !== false})`);

    for (const roomDesc of rooms) {
      const isSel = roomDesc.id === selectedRoomId;
      addRoomToScene(roomDesc, isSel, isSel ? selectedSurfaceEdgeIndex : null);
    }

    // Render wall entities at floor level (once per wall, no deduplication needed)
    if (showWalls !== false) {
      for (const wallDesc of (walls || [])) {
        addWallToScene(wallDesc, selectedRoomId, selectedSurfaceEdgeIndex);
      }
    }

    // Apply hover state to the selected surface (wall or floor)
    if (selectedSurfaceEdgeIndex != null) {
      const match = wallMeshes.find(
        m => m.userData.roomId === selectedRoomId && m.userData.edgeIndex === selectedSurfaceEdgeIndex
      );
      if (match) {
        match.material.color.setHex(WALL_HOVER_COLOR);
        hoveredMesh = match;
      }
    } else if (selectedSurfaceEdgeIndex === null && selectedRoomId) {
      // Floor surface selected — highlight it
      const match = floorMeshes.find(m => m.userData.roomId === selectedRoomId);
      if (match) {
        match.material.color.setHex(WALL_HOVER_COLOR);
        match.material.opacity = SURFACE_HIGHLIGHT_OPACITY;
        hoveredMesh = match;
      }
    }

    // Camera stability: only auto-frame when room set changes
    const currentIds = rooms.map(r => r.id).sort().join(",");
    if (currentIds !== lastFloorRoomIds) {
      lastFloorRoomIds = currentIds;
      frameCameraOnFloor(rooms, walls || []);
    }
  }

  // --- Add a single room to the scene ---
  // selectedSurfaceEdgeIndex: null = floor highlighted (or no highlight), number = that wall edge highlighted
  function addRoomToScene(roomDesc, isSelected, selectedSurfaceEdgeIndex = null) {
    const verts = roomDesc.polygonVertices;
    if (!verts || verts.length < 3) return;

    const pos = roomDesc.floorPosition || { x: 0, y: 0 };
    console.log(`[three-view] room ${roomDesc.id}: poly=${verts.length}v @ (${pos.x},${pos.y}), tiles=${roomDesc.floorTiles?.length || 0}, excl=${(roomDesc.floorExclusions || []).length}, patches=${(roomDesc.doorwayFloorPatches || []).length}, selected=${isSelected}`);
    console.log(`[three-view] room ${roomDesc.id} vertices: ${verts.map(v => `(${v.x.toFixed(1)},${v.y.toFixed(1)})`).join(' ')}`);
    const wallH = DEFAULT_WALL_HEIGHT_CM; // default, per-edge heights from wallData

    // --- Floor mesh ---
    const floorShape = new THREE.Shape();
    floorShape.moveTo(pos.x + verts[0].x, -(pos.y + verts[0].y));
    for (let i = 1; i < verts.length; i++) {
      floorShape.lineTo(pos.x + verts[i].x, -(pos.y + verts[i].y));
    }
    floorShape.closePath();

    const floorGeo = new THREE.ShapeGeometry(floorShape);
    floorGeo.rotateX(-Math.PI / 2);

    const hasTiles = roomDesc.floorTiles?.length > 0;
    const groutColor = hasTiles ? parseHexColor(roomDesc.groutColor) : null;

    const floorColor = hasTiles
      ? groutColor
      : (isSelected ? FLOOR_COLOR : UNSELECTED_FLOOR_COLOR);

    const floorMat = new THREE.MeshLambertMaterial({
      color: floorColor,
      side: THREE.DoubleSide,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.userData = { type: "floor", roomId: roomDesc.id, baseColor: floorMat.color.getHex(), baseOpacity: 1.0 };
    scene.add(floorMesh);
    floorMeshes.push(floorMesh);

    // Doorway floor extensions — additional floor mesh patches through doorway openings
    for (const patch of (roomDesc.doorwayFloorPatches || [])) {
      const dwShape = new THREE.Shape();
      dwShape.moveTo(pos.x + patch[0].x, -(pos.y + patch[0].y));
      for (let i = 1; i < patch.length; i++) {
        dwShape.lineTo(pos.x + patch[i].x, -(pos.y + patch[i].y));
      }
      dwShape.closePath();
      const dwGeo = new THREE.ShapeGeometry(dwShape);
      dwGeo.rotateX(-Math.PI / 2);
      scene.add(new THREE.Mesh(dwGeo, floorMat));
    }

    // --- Floor tiles + exclusions via renderSurface3D ---
    // Y offsets to layer above the opaque floor (in cm, invisible at room scale)
    const TILE_Y = SURFACE_TILE_OFFSET;
    const EXCL_Y = SURFACE_EXCL_OFFSET;

    if (hasTiles) {
      const floorMapper = createFloorMapper(pos);
      const { meshes, lines } = renderSurface3D({
        tiles: roomDesc.floorTiles,
        exclusions: roomDesc.floorExclusions || [],
        groutColor: roomDesc.groutColor,
        mapper: floorMapper,
      });


      for (const m of meshes) {
        m.position.y = m.userData.type === "exclusion" ? EXCL_Y : TILE_Y;
        scene.add(m);
      }
      for (const l of lines) { l.position.y = TILE_Y; scene.add(l); }
    } else if ((roomDesc.floorExclusions || []).length > 0) {
      const floorMapper = createFloorMapper(pos);
      const { meshes, lines } = renderSurface3D({
        tiles: [],
        exclusions: roomDesc.floorExclusions,
        groutColor: roomDesc.groutColor || "#ffffff",
        mapper: floorMapper,
      });
      for (const m of meshes) { m.position.y = EXCL_Y; scene.add(m); }
      for (const l of lines) { l.position.y = EXCL_Y; scene.add(l); }
    }

    // Sub-surface tile batches on floor
    for (const ss of (roomDesc.subSurfaceTiles || [])) {
      if (!ss.tiles.length) continue;
      const floorMapper = createFloorMapper(pos);
      const { meshes, lines } = renderSurface3D({
        tiles: ss.tiles,
        exclusions: [],
        groutColor: ss.groutColor,
        mapper: floorMapper,
      });
      for (const m of meshes) { m.position.y = SURFACE_TILE_OFFSET; scene.add(m); }
      for (const l of lines) { l.position.y = SURFACE_TILE_OFFSET; scene.add(l); }
      console.log(`[three-view:subSurface-floor] excl=${ss.exclusionId} tiles=${ss.tiles.length}`);
    }

    // --- 3D Objects (extruded boxes) ---
    for (const obj of (roomDesc.objects3d || [])) {
      addObject3DToScene(obj, pos, roomDesc.id);
    }

  }

  // --- Add a single 3D object (extruded box) to the scene ---
  // Get 2D vertices for any object type (in room-local coords)
  function getObj3dVertices2D(obj) {
    if (obj.type === 'tri') {
      return [obj.p1, obj.p2, obj.p3];
    } else if (obj.type === 'freeform' && obj.vertices?.length >= 3) {
      return obj.vertices;
    } else {
      // rect
      return [
        { x: obj.x, y: obj.y },
        { x: obj.x + obj.w, y: obj.y },
        { x: obj.x + obj.w, y: obj.y + obj.h },
        { x: obj.x, y: obj.y + obj.h },
      ];
    }
  }

  function addObject3DToScene(obj, roomPos, roomId) {
    const OBJ3D_COLOR = 0x22c55e;
    const OBJ3D_OPACITY = 0.9;
    const OBJ3D_EDGE_COLOR = 0x16a34a;

    const verts2d = getObj3dVertices2D(obj);
    const n = verts2d.length;
    const h = obj.heightCm || 100;

    // Convert 2D room-local vertices to 3D world coords (x=floorX, y=up, z=floorY)
    const worldVerts = verts2d.map(v => ({
      x: roomPos.x + v.x,
      z: roomPos.y + v.y,
    }));

    const faceTiles = obj.faceTiles || {};

    // --- Side faces (one quad per edge) ---
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = worldVerts[i];
      const b = worldVerts[j];

      // Determine face name based on object type
      let faceName;
      if (obj.type === 'rect') {
        faceName = ['front', 'right', 'back', 'left'][i];
      } else {
        faceName = `side-${i}`;
      }

      const positions = new Float32Array([
        a.x, 0, a.z,
        b.x, 0, b.z,
        b.x, h, b.z,
        a.x, h, a.z,
      ]);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.computeVertexNormals();

      const faceHasTiles = faceTiles[faceName]?.tiles?.length > 0;
      const faceColor = faceHasTiles ? parseHexColor(faceTiles[faceName].groutColor || "#ffffff") : OBJ3D_COLOR;
      const faceOpacity = faceHasTiles ? 1.0 : OBJ3D_OPACITY;

      const mat = new THREE.MeshLambertMaterial({
        color: faceColor,
        transparent: faceOpacity < 1,
        opacity: faceOpacity,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = {
        type: "object3d",
        objectId: obj.id,
        face: faceName,
        roomId,
        baseColor: faceColor instanceof THREE.Color ? faceColor.getHex() : (typeof faceColor === 'number' ? faceColor : OBJ3D_COLOR),
        baseOpacity: faceOpacity,
      };
      scene.add(mesh);
      object3dMeshes.push(mesh);
    }

    // --- Top face ---
    {
      // Build top face using THREE.ShapeGeometry for arbitrary polygons
      const shape = new THREE.Shape();
      shape.moveTo(worldVerts[0].x, worldVerts[0].z);
      for (let i = 1; i < n; i++) {
        shape.lineTo(worldVerts[i].x, worldVerts[i].z);
      }
      shape.closePath();

      const shapeGeo = new THREE.ShapeGeometry(shape);
      // ShapeGeometry produces vertices in (x, y) → remap to (x, h, z)
      const posArr = shapeGeo.attributes.position.array;
      for (let i = 0; i < posArr.length; i += 3) {
        const sx = posArr[i];
        const sy = posArr[i + 1];
        posArr[i] = sx;       // x stays
        posArr[i + 1] = h;    // y = height
        posArr[i + 2] = sy;   // z = old y
      }
      shapeGeo.attributes.position.needsUpdate = true;
      shapeGeo.computeVertexNormals();

      const topHasTiles = faceTiles["top"]?.tiles?.length > 0;
      const topColor = topHasTiles ? parseHexColor(faceTiles["top"].groutColor || "#ffffff") : OBJ3D_COLOR;
      const topOpacity = topHasTiles ? 1.0 : OBJ3D_OPACITY;

      const topMat = new THREE.MeshLambertMaterial({
        color: topColor,
        transparent: topOpacity < 1,
        opacity: topOpacity,
        side: THREE.DoubleSide,
      });

      const topMesh = new THREE.Mesh(shapeGeo, topMat);
      topMesh.userData = {
        type: "object3d",
        objectId: obj.id,
        face: "top",
        roomId,
        baseColor: topColor instanceof THREE.Color ? topColor.getHex() : (typeof topColor === 'number' ? topColor : OBJ3D_COLOR),
        baseOpacity: topOpacity,
      };
      scene.add(topMesh);
      object3dMeshes.push(topMesh);
    }

    // Compute polygon centroid for outward normal computation on side faces
    const cx = worldVerts.reduce((s, v) => s + v.x, 0) / n;
    const cz = worldVerts.reduce((s, v) => s + v.z, 0) / n;

    // Render tiles on faces that have tiling configured
    for (const [face, tileData] of Object.entries(faceTiles)) {
      if (!tileData.tiles?.length) continue;
      let mapper = createBoxFaceMapper(obj, roomPos, face);
      if (!mapper) {
        console.warn(`[three-view] OBJ3D TILING: obj=${obj.id} face=${face} mapper=NULL → SKIP`);
        continue;
      }

      // Offset tiles outward from face to avoid z-fighting (physical offset, same approach as walls/floor)
      if (face === "top") {
        // Top face: offset upward in Y, like floor's TILE_Y
        const baseMapper = mapper;
        mapper = (sx, sy) => {
          const p = baseMapper(sx, sy);
          return { x: p.x, y: p.y + SURFACE_TILE_OFFSET, z: p.z };
        };
      } else {
        // Side faces: offset outward along face normal (perpendicular to edge, away from centroid)
        const sideMatch = face.match(/^side-(\d+)$/);
        let nx = 0, nz = 0;
        if (sideMatch) {
          const idx = parseInt(sideMatch[1]);
          const a = worldVerts[idx], b = worldVerts[(idx + 1) % n];
          // Edge direction
          const edx = b.x - a.x, edz = b.z - a.z;
          const edLen = Math.sqrt(edx * edx + edz * edz);
          if (edLen > 0.001) {
            // Perpendicular (two options: rotate ±90°)
            let pnx = -edz / edLen, pnz = edx / edLen;
            // Pick the one pointing away from centroid
            const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
            if (pnx * (midX - cx) + pnz * (midZ - cz) < 0) { pnx = -pnx; pnz = -pnz; }
            nx = pnx; nz = pnz;
          }
        } else if (face === "front" || face === "back" || face === "left" || face === "right") {
          // Rect side faces: known normals
          if (face === "front") nz = -1;
          else if (face === "back") nz = 1;
          else if (face === "left") nx = -1;
          else if (face === "right") nx = 1;
        }
        mapper = createOffsetMapper(mapper, nx, nz, SURFACE_TILE_OFFSET);
      }

      const { meshes: tileMeshes, lines: tileLines } = renderSurface3D({
        tiles: tileData.tiles,
        exclusions: [],
        groutColor: tileData.groutColor || "#ffffff",
        mapper,
      });
      for (const m of tileMeshes) scene.add(m);
      for (const l of tileLines) scene.add(l);
    }

    // --- Edge lines ---
    const edgeLineVerts = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = worldVerts[i];
      const b = worldVerts[j];
      // Bottom edge
      edgeLineVerts.push(a.x, 0, a.z, b.x, 0, b.z);
      // Top edge
      edgeLineVerts.push(a.x, h, a.z, b.x, h, b.z);
      // Vertical edge
      edgeLineVerts.push(a.x, 0, a.z, a.x, h, a.z);
    }

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edgeLineVerts), 3));
    const edgeMat = new THREE.LineBasicMaterial({ color: OBJ3D_EDGE_COLOR });
    scene.add(new THREE.LineSegments(edgeGeo, edgeMat));

    const bounds = getObj3dBoundsForLog(worldVerts);
    console.log(`[three-view] object3d ${obj.id} (${obj.type}): verts=${n}, h=${h}, bounds=(${bounds}), faces=${n + 1}`);
  }

  function getObj3dBoundsForLog(worldVerts) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const v of worldVerts) {
      if (v.x < minX) minX = v.x;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.z > maxZ) maxZ = v.z;
    }
    return `${minX.toFixed(1)},${minZ.toFixed(1)}→${maxX.toFixed(1)},${maxZ.toFixed(1)}`;
  }

  // --- Add a single wall entity to the scene ---
  function addWallToScene(wallDesc, selectedRoomId, selectedSurfaceEdgeIndex) {
    const isOwnerSelected = wallDesc.roomEdge?.roomId === selectedRoomId;
    const isEdgeSelected = isOwnerSelected && wallDesc.roomEdge?.edgeIndex === selectedSurfaceEdgeIndex;
    const wallColor = isOwnerSelected ? WALL_COLOR : UNSELECTED_WALL_COLOR;
    const edgeColor = isOwnerSelected ? EDGE_COLOR : UNSELECTED_EDGE_COLOR;
    console.log(`[three-view] wall ${wallDesc.id}: inner=(${wallDesc.start.x.toFixed(1)},${wallDesc.start.y.toFixed(1)})→(${wallDesc.end.x.toFixed(1)},${wallDesc.end.y.toFixed(1)}) outer=(${wallDesc.outerStart.x.toFixed(1)},${wallDesc.outerStart.y.toFixed(1)})→(${wallDesc.outerEnd.x.toFixed(1)},${wallDesc.outerEnd.y.toFixed(1)}) h=${wallDesc.hStart}/${wallDesc.hEnd} len=${wallDesc.edgeLength?.toFixed(1)} doorways=${wallDesc.doorways?.length || 0} surfaces=${wallDesc.surfaces?.length || 0}`);

    const geo = buildWallGeo(
      wallDesc.start.x, wallDesc.start.y,
      wallDesc.end.x, wallDesc.end.y,
      wallDesc.outerStart.x, wallDesc.outerStart.y,
      wallDesc.outerEnd.x, wallDesc.outerEnd.y,
      wallDesc.hStart, wallDesc.hEnd,
      wallDesc.edgeLength, wallDesc.doorways
    );

    const baseColor = new THREE.Color(wallColor);

    const wallMat = new THREE.MeshLambertMaterial({
      color: baseColor,
      side: THREE.DoubleSide,
    });
    const wallMesh = new THREE.Mesh(geo, wallMat);
    wallMesh.userData = {
      type: "wall",
      wallId: wallDesc.id,
      roomId: wallDesc.roomEdge?.roomId,
      edgeIndex: wallDesc.roomEdge?.edgeIndex,
      baseColor: baseColor.getHex(),
    };
    scene.add(wallMesh);
    wallMeshes.push(wallMesh);

    const edgesGeo = new THREE.EdgesGeometry(geo, 30);
    const linesMat = new THREE.LineBasicMaterial({ color: edgeColor });
    scene.add(new THREE.LineSegments(edgesGeo, linesMat));

    // Corner fills: close outer-corner gaps.
    // endCornerFill: same-room reflex vertex gap (triangle) or cross-room end gap (quad).
    // startCornerFill: cross-room start gap (quad).
    if (wallDesc.endCornerFill) {
      console.log(`[three-view]   endCornerFill: ${wallDesc.endCornerFill.p4 ? 'quad' : 'tri'} h=${wallDesc.endCornerFill.h}`);
      renderCornerFill(wallDesc.endCornerFill, scene, baseColor, linesMat);
    }
    if (wallDesc.startCornerFill) {
      console.log(`[three-view]   startCornerFill: ${wallDesc.startCornerFill.p4 ? 'quad' : 'tri'} h=${wallDesc.startCornerFill.h}`);
      renderCornerFill(wallDesc.startCornerFill, scene, baseColor, linesMat);
    }

    // Render tiles for each surface
    for (let surfIdx = 0; surfIdx < wallDesc.surfaces.length; surfIdx++) {
      const surf = wallDesc.surfaces[surfIdx];
      if (!surf.tiles?.length && !surf.exclusions?.length) continue;

      // Owner surface maps to inner face, guest surface maps to outer face
      const isOwner = surf.roomId === wallDesc.roomEdge?.roomId;
      const faceStart = isOwner ? wallDesc.start : wallDesc.outerStart;
      const faceEnd = isOwner ? wallDesc.end : wallDesc.outerEnd;

      // Position tiles at the surface's from/to subsection of the wall face
      const ff = surf.fromFrac ?? 0;
      const tf = surf.toFrac ?? 1;
      const surfStart = {
        x: faceStart.x + ff * (faceEnd.x - faceStart.x),
        y: faceStart.y + ff * (faceEnd.y - faceStart.y),
      };
      const surfEnd = {
        x: faceStart.x + tf * (faceEnd.x - faceStart.x),
        y: faceStart.y + tf * (faceEnd.y - faceStart.y),
      };

      const mapper = createWallMapper(
        surf.surfaceVerts,
        surfStart.x, surfStart.y,
        surfEnd.x, surfEnd.y,
        surf.hStart, surf.hEnd
      );
      if (!mapper) { console.log(`[three-view]   surface[${surfIdx}] mapper=NULL → skip`); continue; }

      // Compute face normal pointing away from wall surface (for physical offset layering)
      const oppStart = isOwner ? wallDesc.outerStart : wallDesc.start;
      const oppEnd = isOwner ? wallDesc.outerEnd : wallDesc.end;
      const nmx = (surfStart.x + surfEnd.x) / 2 - (oppStart.x + oppEnd.x) / 2;
      const nmz = (surfStart.y + surfEnd.y) / 2 - (oppStart.y + oppEnd.y) / 2;
      const nmLen = Math.sqrt(nmx * nmx + nmz * nmz);
      const nx = nmLen > 0.001 ? nmx / nmLen : 0;
      const nz = nmLen > 0.001 ? nmz / nmLen : 0;
      console.log(`[three-view]   surface[${surfIdx}] normal: nx=${nx.toFixed(3)}, nz=${nz.toFixed(3)}`);

      // Grout background quad — covers this surface, hides wall color behind tiles.
      // Skip when doorway freeform exclusions are present: the wall mesh already has
      // the hole cut; the grout quad would cover it and make the doorway opaque.
      const hasDoorwayExcl = (surf.region?.exclusions || []).some(e => e.type === 'freeform');
      if (surf.tiles?.length && !hasDoorwayExcl) {
        const groutMesh = createGroutQuad(surf.surfaceVerts, mapper, nx, nz, surf.groutColor || "#ffffff");
        if (groutMesh) scene.add(groutMesh);
      }

      const tileMapper = createOffsetMapper(mapper, nx, nz, SURFACE_TILE_OFFSET_WALL);
      const { meshes, lines } = renderSurface3D({
        tiles: surf.tiles,
        exclusions: surf.exclusions,
        groutColor: surf.groutColor || "#ffffff",
        mapper: tileMapper,
        tileZBias: 0,
        exclZBias: 0,
      });
      for (const m of meshes) scene.add(m);
      for (const l of lines) scene.add(l);

      // Sub-surface tile batches on wall face
      for (const ss of (surf.subSurfaceTiles || [])) {
        if (!ss.tiles.length) continue;
        const { meshes: ssMeshes, lines: ssLines } = renderSurface3D({
          tiles: ss.tiles,
          exclusions: [],
          groutColor: ss.groutColor,
          mapper: tileMapper,
          tileZBias: 0,
          exclZBias: 0,
        });
        for (const m of ssMeshes) scene.add(m);
        for (const l of ssLines) scene.add(l);
        console.log(`[three-view:subSurface-wall] excl=${ss.exclusionId} tiles=${ss.tiles.length}`);
      }

      // Render actual skirting segments in 3D
      if (surf.skirtingOffset > 0 && surf.skirtingSegments && surf.skirtingSegments.length > 0) {
        const skirtingHeight = surf.skirtingHeight || 6;
        const skirtMapper = createOffsetMapper(mapper, nx, nz, SURFACE_SKIRTING_OFFSET);

        for (const segment of surf.skirtingSegments) {
          const { x1, x2, excluded } = segment;

          // Create quad for this skirting piece
          const segVerts = [
            { x: x1, y: surf.surfaceVerts[0].y },  // bottom-left (floor level)
            { x: x2, y: surf.surfaceVerts[0].y },  // bottom-right
            { x: x2, y: surf.surfaceVerts[0].y - skirtingHeight },  // top-right
            { x: x1, y: surf.surfaceVerts[0].y - skirtingHeight },  // top-left
          ];

          const seg3D = segVerts.map(v => skirtMapper(v.x, v.y));

          const segGeo = new THREE.BufferGeometry();
          const positions = new Float32Array(seg3D.flatMap(p => [p.x, p.y, p.z]));
          segGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          segGeo.setIndex([0, 1, 2, 0, 2, 3]);

          // Use accent color for active skirting, red for excluded
          const color = excluded ? 0xEF4444 : 0x7AA2FF;
          const opacity = excluded ? 0.8 : 0.9;

          const segMat = new THREE.MeshBasicMaterial({
            color,
            opacity,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false,
          });

          const segMesh = new THREE.Mesh(segGeo, segMat);
          scene.add(segMesh);
        }
      }
    }
  }

  // --- Camera framing for entire floor ---
  function frameCameraOnFloor(rooms, walls = []) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    for (const roomDesc of rooms) {
      const pos = roomDesc.floorPosition || { x: 0, y: 0 };
      const verts = roomDesc.polygonVertices;
      if (!verts || verts.length < 3) continue;
      for (const v of verts) {
        const wx = pos.x + v.x;
        const wz = pos.y + v.y;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wz < minZ) minZ = wz;
        if (wz > maxZ) maxZ = wz;
      }
    }

    let maxWallH = DEFAULT_WALL_HEIGHT_CM;
    for (const wd of walls) {
      maxWallH = Math.max(maxWallH, wd.hStart ?? DEFAULT_WALL_HEIGHT_CM, wd.hEnd ?? DEFAULT_WALL_HEIGHT_CM);
    }

    if (minX === Infinity) return; // no rooms

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const cy = maxWallH / 2;

    const sizeX = maxX - minX;
    const sizeZ = maxZ - minZ;
    const maxDim = Math.max(sizeX, sizeZ, maxWallH);

    controls.target.set(cx, cy, cz);

    const dist = maxDim * 1.8;
    // Top-down view matching 2D layout orientation
    camera.position.set(cx, cy + dist, cz);
    camera.lookAt(cx, cy, cz);
    controls.update();
  }

  // --- Reset camera ---
  function resetCamera() {
    if (!scene) return;
    const allMeshes = [...wallMeshes, ...floorMeshes, ...object3dMeshes];
    if (allMeshes.length === 0) return;
    const box = new THREE.Box3();
    for (const m of allMeshes) box.expandByObject(m);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.8;

    controls.target.copy(center);
    // Top-down view matching 2D layout orientation
    camera.position.set(center.x, center.y + dist, center.z);
    camera.lookAt(center);
    controls.update();
  }

  // --- Interaction: hover ---
  function onPointerMove(e) {
    if (!active) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    // Check walls first, then 3D objects, then floors
    let hit = null;
    const wallHits = raycaster.intersectObjects(wallMeshes, false);
    if (wallHits.length > 0) {
      hit = wallHits[0].object;
    } else {
      const objHits = raycaster.intersectObjects(object3dMeshes, false);
      if (objHits.length > 0) {
        hit = objHits[0].object;
      } else {
        const floorHits = raycaster.intersectObjects(floorMeshes, false);
        if (floorHits.length > 0) hit = floorHits[0].object;
      }
    }

    if (hit !== hoveredMesh) {
      // Unhover previous
      if (hoveredMesh) {
        hoveredMesh.material.color.setHex(hoveredMesh.userData.baseColor ?? WALL_COLOR);
        if (hoveredMesh.userData.baseOpacity != null) hoveredMesh.material.opacity = hoveredMesh.userData.baseOpacity;
      }
      hoveredMesh = hit;
      if (hoveredMesh) {
        hoveredMesh.material.color.setHex(WALL_HOVER_COLOR);
        if (hoveredMesh.userData.type === "floor") hoveredMesh.material.opacity = SURFACE_HIGHLIGHT_OPACITY;
        if (hoveredMesh.userData.type === "object3d") hoveredMesh.material.opacity = 1.0;
        const ud = hoveredMesh.userData;
        const label = ud.type === "floor" ? "Floor"
          : ud.type === "object3d" ? `Object (${ud.face})`
          : `Wall ${ud.edgeIndex + 1}`;
        onHoverChange?.({ label });
      } else {
        onHoverChange?.(null);
      }
    }
  }

  // --- Interaction: double-click ---
  function onDblClick(e) {
    if (!active) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    // Check walls first (higher priority — drill into wall view)
    const wallHits = raycaster.intersectObjects(wallMeshes, false);
    if (wallHits.length > 0) {
      const mesh = wallHits[0].object;
      onWallDoubleClick?.({
        edgeIndex: mesh.userData.edgeIndex,
        roomId: mesh.userData.roomId,
      });
      return;
    }

    // Then check 3D objects (surface editor)
    const objHits = raycaster.intersectObjects(object3dMeshes, false);
    if (objHits.length > 0) {
      const mesh = objHits[0].object;
      onObjectDoubleClick?.({
        objectId: mesh.userData.objectId,
        face: mesh.userData.face,
        roomId: mesh.userData.roomId,
      });
      return;
    }

    // Then check floor meshes (drill into room)
    const floorHits = raycaster.intersectObjects(floorMeshes, false);
    if (floorHits.length > 0) {
      const roomId = floorHits[0].object.userData.roomId;
      if (roomId) onRoomDoubleClick?.({ roomId });
    }
  }

  // --- Interaction: click-to-select room ---
  function onPointerDown(e) {
    if (!active) return;
    pointerDownPos = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e) {
    if (!active || !pointerDownPos) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    pointerDownPos = null;
    // Anti-drag guard: only fire click if pointer moved < 5px
    if (Math.sqrt(dx * dx + dy * dy) >= 5) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    // Check walls first (surface select), then 3D objects, then floors
    const wallHits = raycaster.intersectObjects(wallMeshes, false);
    if (wallHits.length > 0) {
      const mesh = wallHits[0].object;
      const roomId = mesh.userData.roomId;
      if (roomId) {
        if (onSurfaceSelect) onSurfaceSelect({ roomId, edgeIndex: mesh.userData.edgeIndex });
        else onRoomSelect?.({ roomId });
      }
      return;
    }
    const objHits = raycaster.intersectObjects(object3dMeshes, false);
    if (objHits.length > 0) {
      const mesh = objHits[0].object;
      onObjectSelect?.({
        objectId: mesh.userData.objectId,
        face: mesh.userData.face,
        roomId: mesh.userData.roomId,
      });
      return;
    }
    const floorHits = raycaster.intersectObjects(floorMeshes, false);
    if (floorHits.length > 0) {
      const roomId = floorHits[0].object.userData.roomId;
      if (roomId) {
        if (onSurfaceSelect) onSurfaceSelect({ roomId, edgeIndex: null });
        else onRoomSelect?.({ roomId });
      }
    }
  }

  // --- Animation loop ---
  function animate() {
    if (!active) return;
    animFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  // --- Lifecycle ---
  function start() {
    init();
    if (active) return;
    active = true;
    resize();
    animate();
  }

  function stop() {
    active = false;
    if (animFrameId != null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function dispose() {
    stop();
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("dblclick", onDblClick);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    if (scene) {
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    }
    controls?.dispose();
    renderer?.dispose();
    initialized = false;
    renderer = null;
    camera = null;
    controls = null;
    scene = null;
  }

  function isActive() {
    return active;
  }

  return { buildScene, resize, resetCamera, dispose, start, stop, isActive };
}
