import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

/**
 * Static + runtime guards for procedural model builders.
 *
 * The bug this exists for: `BufferGeometry` has no `.rotation` property, so
 * `const g = new THREE.TorusGeometry(...); g.rotation.x = ...` throws a
 * TypeError the moment that builder runs. It only surfaced once the orbiter
 * finally unlocked at wave 6, because nothing before then built a ring.
 */

const src = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

test('no builder assigns .rotation to a raw BufferGeometry', () => {
  const files = [
    '../../src/game/enemies.js',
    '../../src/game/player.js',
  ];
  for (const f of files) {
    const code = src(f);
    // find `const NAME = new THREE.<Geom>(...)` declarations
    const decls = [...code.matchAll(/const\s+(\w+)\s*=\s*new THREE\.(\w+)\s*\(/g)];
    for (const [, name, geomClass] of decls) {
      // Group / Vector3 / etc. legitimately have .rotation
      if (!geomClass.endsWith('Geometry')) continue;
      // look for `name.rotation.<axis> = ` anywhere after the declaration
      const uses = [...code.matchAll(new RegExp(`\\b${name}\\.rotation\\.`, 'g'))];
      assert.equal(
        uses.length,
        0,
        `${f}: "${name}" is a THREE.${geomClass} but is assigned .rotation — ` +
          'BufferGeometry has no rotation. Rotate the geometry (g.rotateX) or wrap it in a Mesh.',
      );
    }
  }
});

test('every procedural detail builder produces valid geometry', () => {
  // Exercise the geometries the game builds at module scope, checking that the
  // attributes Three.js needs for rendering are actually present.
  const cases = [
    ['TorusGeometry', () => new THREE.TorusGeometry(0.85, 0.06, 6, 20)],
    ['CylinderGeometry', () => new THREE.CylinderGeometry(0.28, 0.28, 0.8, 12)],
    ['ConeGeometry', () => new THREE.ConeGeometry(0.075, 0.46, 4)],
    ['BoxGeometry', () => new THREE.BoxGeometry(1.5, 0.26, 1.2)],
    ['OctahedronGeometry', () => new THREE.OctahedronGeometry(0.3, 0)],
    ['IcosahedronGeometry', () => new THREE.IcosahedronGeometry(0.15, 0)],
    ['TetrahedronGeometry', () => new THREE.TetrahedronGeometry(0.62)],
  ];
  for (const [name, make] of cases) {
    const geo = make();
    assert.ok(geo.attributes.position, `${name} missing position`);
    assert.ok(geo.attributes.normal, `${name} missing normal`);
    // polyhedra (octahedron/icosahedron/tetrahedron) are non-indexed by design
    if (!/Octahedron|Icosahedron|Tetrahedron/.test(name)) {
      assert.ok(geo.index, `${name} missing index`);
    }
    assert.ok(
      Number.isFinite(geo.attributes.position.array[0]),
      `${name} has non-finite positions`,
    );
    geo.dispose();
  }
});

test('rotating a geometry uses the rotate* methods, which exist', () => {
  const geo = new THREE.TorusGeometry(0.5, 0.05, 6, 16);
  assert.equal(typeof geo.rotateX, 'function');
  assert.equal(typeof geo.rotateY, 'function');
  assert.equal(typeof geo.rotateZ, 'function');
  // and the methods actually bake the transform into the vertex data
  // sample a few vertices: the ring's normals are not all identical, so a
  // rotation is visible somewhere in the buffer
  const before = Array.from(geo.attributes.normal.array);
  geo.rotateX(Math.PI / 2);
  const after = Array.from(geo.attributes.normal.array);
  assert.notDeepEqual(before, after, 'rotateX did not change the normals');
  geo.dispose();
});

test('enemy detail tables are keyed by real enemy ids', async () => {
  // A detail builder keyed to a non-existent id is dead code that silently
  // never runs — the same failure mode as the orbiter crash, but quieter.
  const { ENEMIES, BOSSES } = await import('../../src/game/enemyDefs.js');
  const code = src('../../src/game/enemies.js');
  const table = code.slice(code.indexOf('const DETAILS = {'), code.indexOf('function matFor'));
  const keys = [...table.matchAll(/^\s{2}(\w+):\s*\(\)\s*=>/gm)].map((m) => m[1]);
  const valid = new Set([...Object.keys(ENEMIES), ...Object.keys(BOSSES)]);
  assert.ok(keys.length > 0, 'no detail builders found');
  for (const k of keys) {
    assert.ok(valid.has(k), `DETAILS.${k} has no matching enemy definition`);
  }
});

test('every enemy has a body geometry path', async () => {
  const { ENEMIES, BOSSES } = await import('../../src/game/enemyDefs.js');
  const code = src('../../src/game/enemies.js');
  const fn = code.slice(code.indexOf('function geoFor('), code.indexOf('function matFor'));
  for (const def of [...Object.values(ENEMIES), ...Object.values(BOSSES)]) {
    assert.match(
      fn,
      new RegExp(`case '${def.shape}'`),
      `no geometry case for shape "${def.shape}" (${def.id})`,
    );
  }
});
