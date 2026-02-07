// src/three-view.js — Self-contained Three.js 3D room viewer
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { computeOuterPolygon } from "./floor_geometry.js";

// Palette pulled from CSS variables / 2D room rendering colors
const FLOOR_COLOR = 0x3b82f6;    // --accent / selected room fill (#3b82f6)
const FLOOR_OPACITY = 0.25;      // matches rgba(59,130,246,0.25)
const WALL_COLOR = 0x6496c8;     // unselected room fill tone (rgb(100,150,200))
const WALL_HOVER_COLOR = 0x3b82f6; // selection blue (#3b82f6)
const EDGE_COLOR = 0xc8dcff;     // room stroke (rgba(200,220,255))
const SURFACE_HIGHLIGHT_OPACITY = 0.45;   // hover/selected floor opacity
const BG_COLOR = 0x081022;       // .svgWrap background

// --- Tile path parsing helpers ---

/** Parse "M x y L x y ... Z M x y ..." into array of rings [{x,y}...] */
function parseTilePathD(d) {
  const rings = [];
  let current = null;
  const tokens = d.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "M") {
      current = [];
      rings.push(current);
      current.push({ x: parseFloat(tokens[i + 1]), y: parseFloat(tokens[i + 2]) });
      i += 3;
    } else if (t === "L") {
      current.push({ x: parseFloat(tokens[i + 1]), y: parseFloat(tokens[i + 2]) });
      i += 3;
    } else if (t === "Z") {
      i++;
    } else {
      // implicit coordinate pair (continuation of L)
      if (current) current.push({ x: parseFloat(tokens[i]), y: parseFloat(tokens[i + 1]) });
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
  if (!surfaceVerts || surfaceVerts.length < 4) return null;
  const P0 = surfaceVerts[0];
  const U = { x: surfaceVerts[1].x - P0.x, y: surfaceVerts[1].y - P0.y };
  const V = { x: surfaceVerts[3].x - P0.x, y: surfaceVerts[3].y - P0.y };
  const det = U.x * V.y - U.y * V.x;
  if (Math.abs(det) < 0.001) return null;
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

/** Convert an exclusion to a THREE.Shape in 2D surface-local coords. */
function exclusionToShape(ex) {
  const shape = new THREE.Shape();
  if (ex.type === "rect") {
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
      { shapes: excludedShapes, color: 0xef4444, opacity: 0.25 },
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
    const exclMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: exclZBias !== 0,
      polygonOffsetFactor: exclZBias !== 0 ? exclZBias : 0,
      polygonOffsetUnits: exclZBias !== 0 ? exclZBias : 0,
    });
    const exclLineMat = new THREE.LineBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.8,
    });

    for (const ex of exclusions) {
      const shape = exclusionToShape(ex);
      if (!shape) continue;

      const geo = new THREE.ShapeGeometry(shape);
      transformShapeGeo(geo, mapper);
      const mesh = new THREE.Mesh(geo, exclMat);
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
      const line = new THREE.Line(lineGeo, exclLineMat);
      line.userData = { type: "exclusionEdge" };
      lines.push(line);
    }
  }

  return { meshes, lines };
}

// Non-selected room colors (dimmer than selected)
const UNSELECTED_FLOOR_COLOR = 0x334155;
const UNSELECTED_FLOOR_OPACITY = 0.12;
const UNSELECTED_WALL_COLOR = 0x4a5568;
const UNSELECTED_EDGE_COLOR = 0x6b7280;

/**
 * Creates a Three.js 3D view controller for floor visualization.
 * @param {{ canvas: HTMLCanvasElement, onWallDoubleClick: Function, onHoverChange: Function, onRoomSelect: Function }} opts
 */
export function createThreeViewController({ canvas, onWallDoubleClick, onRoomDoubleClick, onHoverChange, onRoomSelect, onSurfaceSelect }) {
  let renderer, camera, controls, scene;
  let animFrameId = null;
  let active = false;
  let initialized = false;

  // Interaction state
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let wallMeshes = [];
  let floorMeshes = [];
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
    hoveredMesh = null;

    const { rooms, selectedRoomId, selectedSurfaceEdgeIndex } = floorData;

    for (const roomDesc of rooms) {
      const isSel = roomDesc.id === selectedRoomId;
      addRoomToScene(roomDesc, isSel, isSel ? selectedSurfaceEdgeIndex : null);
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
      frameCameraOnFloor(rooms);
    }
  }

  // --- Add a single room to the scene ---
  // selectedSurfaceEdgeIndex: null = floor highlighted (or no highlight), number = that wall edge highlighted
  function addRoomToScene(roomDesc, isSelected, selectedSurfaceEdgeIndex = null) {
    const verts = roomDesc.polygonVertices;
    if (!verts || verts.length < 3) return;

    const pos = roomDesc.floorPosition || { x: 0, y: 0 };
    const wallH = roomDesc.wallHeightCm ?? 200;

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
    const floorOpacity = hasTiles
      ? 1.0
      : (isSelected ? FLOOR_OPACITY : UNSELECTED_FLOOR_OPACITY);

    const floorMat = new THREE.MeshBasicMaterial({
      color: floorColor,
      transparent: true,
      opacity: floorOpacity,
      side: THREE.DoubleSide,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.userData = { type: "floor", roomId: roomDesc.id, baseColor: floorMat.color.getHex(), baseOpacity: floorOpacity };
    scene.add(floorMesh);
    floorMeshes.push(floorMesh);

    // --- Wall meshes ---
    const showWalls = roomDesc.showWalls !== false;
    const n = verts.length;
    const wallColor = isSelected ? WALL_COLOR : UNSELECTED_WALL_COLOR;
    const edgeColor = isSelected ? EDGE_COLOR : UNSELECTED_EDGE_COLOR;

    if (showWalls) {
      // Compute outward normal direction (signed area for winding)
      let area2 = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area2 += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
      }
      const sign = area2 > 0 ? 1 : -1;

      // Build effective thicknesses using free edge segments (0 for fully-shared edges)
      const freeSegsByEdge = roomDesc.freeEdgeSegments || [];
      const effectiveThicknesses = [];
      for (let i = 0; i < n; i++) {
        const ep = roomDesc.edgeProperties?.[i];
        const thick = ep?.thicknessCm ?? 12;
        const freeSegs = freeSegsByEdge[i] || [];
        effectiveThicknesses.push(freeSegs.length > 0 ? thick : 0);
      }

      // Compute mitered outer polygon for clean corners
      const outerVerts = computeOuterPolygon(verts, effectiveThicknesses, sign);

      for (let i = 0; i < n; i++) {
        const freeSegs = freeSegsByEdge[i] || [];
        if (freeSegs.length === 0) continue; // Fully shared edge — no wall

        const A = verts[i];
        const B = verts[(i + 1) % n];

        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const edgeLen = Math.sqrt(dx * dx + dy * dy);
        if (edgeLen < 1) continue;

        // Per-edge properties
        const ep = roomDesc.edgeProperties?.[i];
        const hA = ep?.heightStartCm ?? wallH;
        const hB = ep?.heightEndCm ?? wallH;

        // Use mitered outer vertices instead of independently computed offsets
        const OA = outerVerts[i];
        const OB = outerVerts[(i + 1) % n];

        // Inner edge (room boundary) in floor coordinates
        const iax = pos.x + A.x, iaz = pos.y + A.y;
        const ibx = pos.x + B.x, ibz = pos.y + B.y;
        // Outer edge (mitered)
        const oax = pos.x + OA.x, oaz = pos.y + OA.y;
        const obx = pos.x + OB.x, obz = pos.y + OB.y;

        // 8 vertices: inner-bottom-A, inner-bottom-B, outer-bottom-B, outer-bottom-A,
        //             inner-top-A,    inner-top-B,    outer-top-B,    outer-top-A
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

        // 6 faces × 2 triangles = 12 triangles
        const indices = [
          // Inner face (facing room interior)
          0, 5, 1,  0, 4, 5,
          // Outer face (facing outside)
          2, 7, 3,  2, 6, 7,
          // Top face
          4, 6, 5,  4, 7, 6,
          // Bottom face
          0, 1, 2,  0, 2, 3,
          // Left cap (at vertex A)
          0, 3, 7,  0, 7, 4,
          // Right cap (at vertex B)
          1, 5, 6,  1, 6, 2,
        ];

        const wallGeo = new THREE.BufferGeometry();
        wallGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        wallGeo.setIndex(indices);
        wallGeo.computeVertexNormals();

        const wallHasTiles = (roomDesc.wallData || []).some(wd => wd.edgeIndex === i && wd.tiles?.length > 0);
        const wallBaseColor = wallHasTiles ? parseHexColor(roomDesc.groutColor || "#ffffff") : new THREE.Color(wallColor);

        const wallMat = new THREE.MeshLambertMaterial({
          color: wallBaseColor,
          side: THREE.DoubleSide,
        });

        const wallMesh = new THREE.Mesh(wallGeo, wallMat);
        wallMesh.userData = { type: "wall", edgeIndex: i, roomId: roomDesc.id, baseColor: wallBaseColor.getHex() };
        scene.add(wallMesh);
        wallMeshes.push(wallMesh);

        const edgesGeo = new THREE.EdgesGeometry(wallGeo);
        const linesMat = new THREE.LineBasicMaterial({ color: edgeColor });
        const lineSegments = new THREE.LineSegments(edgesGeo, linesMat);
        scene.add(lineSegments);
      }
    }

    // --- Floor tiles + exclusions via renderSurface3D ---
    if (hasTiles) {
      const floorMapper = createFloorMapper(pos);
      const { meshes, lines } = renderSurface3D({
        tiles: roomDesc.floorTiles,
        exclusions: roomDesc.floorExclusions || [],
        groutColor: roomDesc.groutColor,
        mapper: floorMapper,
      });
      for (const m of meshes) scene.add(m);
      for (const l of lines) scene.add(l);
    } else if ((roomDesc.floorExclusions || []).length > 0) {
      const floorMapper = createFloorMapper(pos);
      const { meshes, lines } = renderSurface3D({
        tiles: [],
        exclusions: roomDesc.floorExclusions,
        groutColor: roomDesc.groutColor || "#ffffff",
        mapper: floorMapper,
      });
      for (const m of meshes) scene.add(m);
      for (const l of lines) scene.add(l);
    }

    // --- Wall tiles + exclusions via renderSurface3D ---
    if (showWalls) {
      const wallDataArr = roomDesc.wallData || [];
      for (const wd of wallDataArr) {
        if (!wd.surfaceVerts) continue;
        const wi = wd.edgeIndex;
        const A = verts[wi];
        const B = verts[(wi + 1) % n];
        const ax = pos.x + A.x, az = pos.y + A.y;
        const bx = pos.x + B.x, bz = pos.y + B.y;

        const wdHStart = wd.hStart ?? wallH;
        const wdHEnd = wd.hEnd ?? wallH;
        const mapper = createWallMapper(wd.surfaceVerts, ax, az, bx, bz, wdHStart, wdHEnd);
        if (!mapper) continue;

        const { meshes, lines } = renderSurface3D({
          tiles: wd.tiles,
          exclusions: wd.exclusions,
          groutColor: roomDesc.groutColor || "#ffffff",
          mapper,
          tileZBias: -1,
          exclZBias: -2,
        });
        for (const m of meshes) scene.add(m);
        for (const l of lines) scene.add(l);
      }
    }
  }

  // --- Camera framing for entire floor ---
  function frameCameraOnFloor(rooms) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let maxWallH = 0;

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
      const wh = roomDesc.wallHeightCm ?? 200;
      if (wh > maxWallH) maxWallH = wh;
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
    camera.position.set(cx + dist * 0.6, cy + dist * 0.8, cz + dist * 0.6);
    camera.lookAt(cx, cy, cz);
    controls.update();
  }

  // --- Reset camera ---
  function resetCamera() {
    if (!scene) return;
    const allMeshes = [...wallMeshes, ...floorMeshes];
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
    camera.position.set(center.x + dist * 0.6, center.y + dist * 0.8, center.z + dist * 0.6);
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

    // Check walls first, then floors
    let hit = null;
    const wallHits = raycaster.intersectObjects(wallMeshes, false);
    if (wallHits.length > 0) {
      hit = wallHits[0].object;
    } else {
      const floorHits = raycaster.intersectObjects(floorMeshes, false);
      if (floorHits.length > 0) hit = floorHits[0].object;
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
        const isFloor = hoveredMesh.userData.type === "floor";
        const label = isFloor ? "Floor" : `Wall ${hoveredMesh.userData.edgeIndex + 1}`;
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

    // Check walls first (surface select), then floors
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
