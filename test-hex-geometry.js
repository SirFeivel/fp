import { tileHexPolygon } from './src/geometry.js';

console.log('\n=== HEXAGON GEOMETRY VALIDATION ===\n');

const widthCm = 30;
const sideLength = widthCm / Math.sqrt(3);
const heightCm = sideLength * 2;

console.log(`Width (flat-to-flat): ${widthCm.toFixed(2)} cm`);
console.log(`Side length: ${sideLength.toFixed(2)} cm`);
console.log(`Height (point-to-point): ${heightCm.toFixed(2)} cm`);
console.log(`Expected area: ${((3 * Math.sqrt(3) / 2) * sideLength * sideLength).toFixed(2)} cm²`);

const hex1 = tileHexPolygon(0, 0, widthCm, 0, 0, 0);
const hex2 = tileHexPolygon(widthCm, 0, widthCm, 0, 0, 0);
const hex3 = tileHexPolygon(widthCm / 2, heightCm, widthCm, 0, 0, 0);

console.log('\nHex 1 (0, 0):');
console.log(JSON.stringify(hex1, null, 2));

console.log('\nHex 2 (right neighbor):');
console.log(JSON.stringify(hex2, null, 2));

console.log('\nHex 3 (bottom neighbor):');
console.log(JSON.stringify(hex3, null, 2));

const hex1Points = hex1[0][0];
const hex2Points = hex2[0][0];

console.log('\n=== TESSELLATION CHECK ===');
console.log('Hex1 rightmost points:', hex1Points.slice(3, 5));
console.log('Hex2 leftmost points:', hex2Points.slice(0, 2));

const rightEdge1 = hex1Points[3];
const rightEdge2 = hex1Points[4];
const leftEdge1 = hex2Points[0];
const leftEdge2 = hex2Points[1];

const tolerance = 0.01;
const match1 = Math.abs(rightEdge1[0] - leftEdge2[0]) < tolerance &&
               Math.abs(rightEdge1[1] - leftEdge2[1]) < tolerance;
const match2 = Math.abs(rightEdge2[0] - leftEdge1[0]) < tolerance &&
               Math.abs(rightEdge2[1] - leftEdge1[1]) < tolerance;

console.log(`\nEdge match 1: ${match1 ? 'PASS' : 'FAIL'}`);
console.log(`Edge match 2: ${match2 ? 'PASS' : 'FAIL'}`);
console.log(`\nTessellation: ${match1 && match2 ? '✓ PERFECT' : '✗ GAPS DETECTED'}`);
