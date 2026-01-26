const tw = 40;
const th = 20;
const grout = 0.5;

console.log('=== BASKETWEAVE PATTERN ANALYSIS ===\n');
console.log(`Tile: ${tw}cm x ${th}cm, Grout: ${grout}cm\n`);

console.log('HORIZONTAL PAIR (original orientation):');
const hPairWidth = 2 * tw + grout;
const hPairHeight = 2 * th + grout;
console.log(`  Width: 2*${tw} + ${grout} = ${hPairWidth}cm`);
console.log(`  Height: 2*${th} + ${grout} = ${hPairHeight}cm`);
console.log(`  Tiles: 4 tiles in 2x2 grid, each ${tw}x${th}`);

console.log('\nVERTICAL PAIR (rotated 90°):');
const vPairWidth = 2 * th + grout;
const vPairHeight = 2 * tw + grout;
console.log(`  Width: 2*${th} + ${grout} = ${vPairWidth}cm`);
console.log(`  Height: 2*${tw} + ${grout} = ${vPairHeight}cm`);
console.log(`  Tiles: 4 tiles in 2x2 grid, each ${th}x${tw} (rotated)`);

console.log('\nCURRENT IMPLEMENTATION:');
const pairSize = Math.max(tw, th);
const currentStepX = pairSize * 2 + grout;
const currentStepY = pairSize * 2 + grout;
console.log(`  pairSize = max(${tw}, ${th}) = ${pairSize}`);
console.log(`  stepX = ${currentStepX}cm`);
console.log(`  stepY = ${currentStepY}cm`);

console.log('\nGAP ANALYSIS:');
console.log(`  Horizontal pair in grid: ${hPairWidth}x${hPairHeight} in ${currentStepX}x${currentStepY} cell`);
console.log(`    X gap: ${currentStepX - hPairWidth}cm`);
console.log(`    Y gap: ${currentStepY - hPairHeight}cm`);
console.log(`  Vertical pair in grid: ${vPairWidth}x${vPairHeight} in ${currentStepX}x${currentStepY} cell`);
console.log(`    X gap: ${currentStepX - vPairWidth}cm`);
console.log(`    Y gap: ${currentStepY - vPairHeight}cm`);

console.log('\nCORRECT SOLUTION:');
console.log(`  stepX should = ${hPairWidth}cm (2*tw + grout)`);
console.log(`  stepY should = ${vPairHeight}cm (2*tw + grout)`);
console.log(`  Note: Both dimensions use tw because pairs interlock`);
