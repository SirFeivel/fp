// src/three-view.js — Self-contained Three.js 3D room viewer
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const FLOOR_COLOR = 0x2255aa;
const FLOOR_OPACITY = 0.55;
const WALL_COLOR = 0x888888;
const WALL_HOVER_COLOR = 0xffdd44;
const EDGE_COLOR = 0x445566;
const BG_COLOR = 0x081022;

/**
 * Creates a Three.js 3D view controller for room visualization.
 * @param {{ canvas: HTMLCanvasElement, onWallDoubleClick: Function, onHoverChange: Function }} opts
 */
export function createThreeViewController({ canvas, onWallDoubleClick, onHoverChange }) {
  let renderer, camera, controls, scene;
  let animFrameId = null;
  let active = false;
  let initialized = false;

  // Interaction state
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let wallMeshes = [];
  let hoveredMesh = null;
  let currentRoomId = null;

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

  // --- Build scene from room data ---
  function buildScene(room) {
    if (!scene) return;
    currentRoomId = room.id;

    // Clear previous objects (keep lights)
    const toRemove = [];
    scene.traverse((obj) => {
      if (obj.isMesh || obj.isLineSegments) toRemove.push(obj);
    });
    for (const obj of toRemove) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose();
      scene.remove(obj);
    }
    wallMeshes = [];
    hoveredMesh = null;

    const verts = room.polygonVertices;
    if (!verts || verts.length < 3) return;

    const pos = room.floorPosition || { x: 0, y: 0 };
    const wallH = room.wallHeightCm ?? 200;

    // --- Floor mesh ---
    // Shape is in XY plane; rotateX(-PI/2) maps (sx, sy, 0) → (sx, 0, -sy).
    // Walls use Z = pos.y + v.y, so negate sy to match after rotation.
    const floorShape = new THREE.Shape();
    floorShape.moveTo(pos.x + verts[0].x, -(pos.y + verts[0].y));
    for (let i = 1; i < verts.length; i++) {
      floorShape.lineTo(pos.x + verts[i].x, -(pos.y + verts[i].y));
    }
    floorShape.closePath();

    const floorGeo = new THREE.ShapeGeometry(floorShape);
    // Rotate from XY to XZ plane (Y-up): swap Y/Z by rotating -90 deg around X
    floorGeo.rotateX(-Math.PI / 2);

    const floorMat = new THREE.MeshLambertMaterial({
      color: FLOOR_COLOR,
      transparent: true,
      opacity: FLOOR_OPACITY,
      side: THREE.DoubleSide,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.userData = { type: "floor" };
    scene.add(floorMesh);

    // --- Wall meshes ---
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const A = verts[i];
      const B = verts[(i + 1) % n];

      const ax = pos.x + A.x, az = pos.y + A.y;
      const bx = pos.x + B.x, bz = pos.y + B.y;

      // Quad: bottom-left, bottom-right, top-right, top-left
      const positions = new Float32Array([
        ax, 0, az,
        bx, 0, bz,
        bx, wallH, bz,
        ax, wallH, az,
      ]);
      const indices = [0, 1, 2, 0, 2, 3];

      const wallGeo = new THREE.BufferGeometry();
      wallGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      wallGeo.setIndex(indices);
      wallGeo.computeVertexNormals();

      const wallMat = new THREE.MeshLambertMaterial({
        color: WALL_COLOR,
        side: THREE.DoubleSide,
      });

      const wallMesh = new THREE.Mesh(wallGeo, wallMat);
      wallMesh.userData = { type: "wall", edgeIndex: i, roomId: room.id };
      scene.add(wallMesh);
      wallMeshes.push(wallMesh);

      // Edge lines for depth perception
      const edgesGeo = new THREE.EdgesGeometry(wallGeo);
      const linesMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
      const lineSegments = new THREE.LineSegments(edgesGeo, linesMat);
      scene.add(lineSegments);
    }

    // Auto-position camera to frame the room
    frameCameraOnRoom(verts, pos, wallH);
  }

  function frameCameraOnRoom(verts, pos, wallH) {
    // Compute bounding box center
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
      const wx = pos.x + v.x;
      const wz = pos.y + v.y;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const cy = wallH / 2;

    const sizeX = maxX - minX;
    const sizeZ = maxZ - minZ;
    const maxDim = Math.max(sizeX, sizeZ, wallH);

    controls.target.set(cx, cy, cz);

    // Position camera above and to the side
    const dist = maxDim * 1.8;
    camera.position.set(cx + dist * 0.6, cy + dist * 0.8, cz + dist * 0.6);
    camera.lookAt(cx, cy, cz);
    controls.update();
  }

  // --- Reset camera ---
  function resetCamera() {
    if (!scene || wallMeshes.length === 0) return;
    // Recompute from wall meshes
    const box = new THREE.Box3();
    for (const m of wallMeshes) box.expandByObject(m);
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
    const hits = raycaster.intersectObjects(wallMeshes, false);

    const hit = hits.length > 0 ? hits[0].object : null;
    if (hit !== hoveredMesh) {
      // Unhover previous
      if (hoveredMesh) {
        hoveredMesh.material.color.setHex(WALL_COLOR);
      }
      hoveredMesh = hit;
      if (hoveredMesh) {
        hoveredMesh.material.color.setHex(WALL_HOVER_COLOR);
        const idx = hoveredMesh.userData.edgeIndex;
        onHoverChange?.({ label: `Wall ${idx + 1}` });
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
    const hits = raycaster.intersectObjects(wallMeshes, false);

    if (hits.length > 0) {
      const mesh = hits[0].object;
      onWallDoubleClick?.({
        edgeIndex: mesh.userData.edgeIndex,
        roomId: mesh.userData.roomId,
      });
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
