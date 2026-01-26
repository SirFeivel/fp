const tw = 40;
const th = 20;
const grout = 0.5;

console.log('=== HERRINGBONE PATTERN ANALYSIS ===\n');
console.log(`Tile: ${tw}cm x ${th}cm, Grout: ${grout}cm\n`);

console.log('HERRINGBONE UNIT (2x2 alternating):');
console.log('  Tile 1: horizontal (tw x th) at (0, 0)');
console.log('  Tile 2: vertical (th x tw) at (tw+grout, 0)');
console.log('  Tile 3: vertical (th x tw) at (0, tw+grout)');
console.log('  Tile 4: horizontal (tw x th) at (tw+grout, tw+grout)');

console.log('\nUNIT DIMENSIONS:');
console.log(`  Tile 1 extends: X[0 to ${tw}], Y[0 to ${th}]`);
console.log(`  Tile 2 (rotated) at X=${tw + grout}: extends X[${tw + grout} to ${tw + grout + th}], Y[0 to ${tw}]`);
console.log(`  Tile 3 (rotated) at Y=${tw + grout}: extends X[0 to ${th}], Y[${tw + grout} to ${tw + grout + tw}]`);
console.log(`  Tile 4 at (${tw + grout}, ${tw + grout}): extends X[${tw + grout} to ${tw + grout + tw}], Y[${tw + grout} to ${tw + grout + th}]`);

const unitMaxX = tw + grout + th;
const unitMaxY = tw + grout + tw;
console.log(`\n  Unit bounding box: ${unitMaxX}cm x ${unitMaxY}cm`);

console.log('\nCURRENT IMPLEMENTATION:');
const currentPatternWidth = tw + th + grout;
const currentPatternHeight = tw + th + grout;
console.log(`  patternWidth = tw + th + grout = ${currentPatternWidth}cm`);
console.log(`  patternHeight = tw + th + grout = ${currentPatternHeight}cm`);

console.log('\nGAP ANALYSIS:');
console.log(`  Actual unit needs: ${unitMaxX}cm x ${unitMaxY}cm`);
console.log(`  Current grid uses: ${currentPatternWidth}cm x ${currentPatternHeight}cm`);
console.log(`  X gap/overlap: ${currentPatternWidth - unitMaxX}cm`);
console.log(`  Y gap/overlap: ${currentPatternHeight - unitMaxY}cm`);

console.log('\nPROBLEM:');
console.log(`  Tile 2 is rotated, so needs HEIGHT of tw (${tw}cm), not th (${th}cm)`);
console.log(`  But patternHeight is tw + th + grout = ${currentPatternHeight}cm`);
console.log(`  Should be: tw + tw + grout = ${tw + tw + grout}cm`);

console.log('\nCORRECT SOLUTION:');
const correctStepX = tw + th + grout;
const correctStepY = tw + tw + grout;
console.log(`  stepX = tw + th + grout = ${correctStepX}cm`);
console.log(`  stepY = tw + tw + grout = ${correctStepY}cm`);
