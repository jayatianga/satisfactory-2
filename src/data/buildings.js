// Building definitions. Local space: origin at the bottom-centre of the
// footprint, +Z is the building's "front" (outputs), -Z the back (inputs).
// size = [width (x), height (y), depth (z)] in metres.
// Ports: { t: 'in'|'out', x, y, z, dx, dz } — (dx,dz) is the outward facing direction.

const inBack = (x = 0, d) => ({ t: 'in', x, y: 1, z: -d / 2, dx: 0, dz: -1 });
const outFront = (x = 0, d) => ({ t: 'out', x, y: 1, z: d / 2, dx: 0, dz: 1 });

export const CATEGORIES = [
  { id: 'special', name: 'Special' },
  { id: 'production', name: 'Production' },
  { id: 'power', name: 'Power' },
  { id: 'logistics', name: 'Logistics' },
  { id: 'organisation', name: 'Organisation' },
  { id: 'foundations', name: 'Architecture' },
];

export const BUILDINGS = {
  // ---------------- Special ----------------
  hub: {
    name: 'The HUB', cat: 'special', size: [10, 6, 8], cost: {}, unique: true, ui: 'hub',
    desc: 'Your base of operations. Contains the Milestone terminal and a Craft Bench.',
  },
  craft_bench: {
    name: 'Craft Bench', cat: 'special', size: [3, 1.6, 2], cost: { iron_plate: 3, iron_rod: 3 }, ui: 'bench',
    desc: 'Hand-craft components from raw materials.',
  },
  mam: {
    name: 'M.A.M.', cat: 'special', size: [6, 3, 5], cost: { cable: 15, iron_plate: 25, wire: 45 }, ui: 'mam',
    desc: 'Molecular Analysis Machine. Research alien resources and alternate recipes.',
  },
  space_elevator: {
    name: 'Space Elevator', cat: 'special', size: [22, 34, 22], cost: { concrete: 500, iron_plate: 250, iron_rod: 400 },
    unique: true, ui: 'elevator', ports: [inBack(-4, 22), inBack(4, 22)],
    colliders: [[-11, 0, -11, 11, 4, 11], [-4, 4, -4, 4, 34, 4]],
    desc: 'Deliver Project Assembly parts to unlock new Tiers. Accepts parts by conveyor.',
  },
  awesome_sink: {
    name: 'AWESOME Sink', cat: 'special', size: [10, 10, 10], cost: { reinforced_iron_plate: 15, cable: 30, concrete: 45 },
    power: 30, ui: 'sink', ports: [inBack(0, 10)], conn: [3.5, 8, -3.5],
    desc: 'Converts items into points and FICSIT Coupons, spendable in the AWESOME Shop.',
  },

  // ---------------- Production ----------------
  miner_mk1: {
    name: 'Miner Mk.1', cat: 'production', size: [6, 10, 10], cost: { iron_plate: 10, concrete: 10 },
    power: 5, miner: 1, snap: 'node', ports: [outFront(0, 10)], conn: [2.2, 4, -4], ui: 'miner',
    colliders: [[-3, 0, -5, 3, 4, 5], [-1.6, 4, -2, 1.6, 10, 2]],
    desc: 'Extracts solid resources from a resource node. 60/min on a Normal node.',
  },
  miner_mk2: {
    name: 'Miner Mk.2', cat: 'production', size: [6, 10, 10], cost: { encased_industrial_beam: 10, modular_frame: 10, steel_pipe: 10 },
    power: 12, miner: 2, snap: 'node', ports: [outFront(0, 10)], conn: [2.2, 4, -4], ui: 'miner', model: 'miner_mk1', tint: '#3d74c8',
    colliders: [[-3, 0, -5, 3, 4, 5], [-1.6, 4, -2, 1.6, 10, 2]],
    desc: 'Extracts 120/min on a Normal node.',
  },
  miner_mk3: {
    name: 'Miner Mk.3', cat: 'production', size: [6, 10, 10], cost: { motor: 10, encased_industrial_beam: 20, steel_pipe: 20, modular_frame: 10 },
    power: 30, miner: 4, snap: 'node', ports: [outFront(0, 10)], conn: [2.2, 4, -4], ui: 'miner', model: 'miner_mk1', tint: '#8e44ad',
    colliders: [[-3, 0, -5, 3, 4, 5], [-1.6, 4, -2, 1.6, 10, 2]],
    desc: 'Extracts 240/min on a Normal node.',
  },
  smelter: {
    name: 'Smelter', cat: 'production', size: [6, 7, 9], cost: { iron_rod: 5, wire: 8 },
    smoke: [[1.1, 7.9, -1.6]], power: 4, machine: 'smelter', ports: [inBack(0, 9), outFront(0, 9)], conn: [2.4, 6, -3], ui: 'machine',
    desc: 'Smelts ore into ingots.',
  },
  constructor: {
    name: 'Constructor', cat: 'production', size: [8, 7, 10], cost: { iron_plate: 10, cable: 8, screw: 20 },
    power: 4, machine: 'constructor', ports: [inBack(0, 10), outFront(0, 10)], conn: [3.4, 6, -4], ui: 'machine',
    desc: 'Crafts one part into another.',
  },
  assembler: {
    name: 'Assembler', cat: 'production', size: [10, 9, 15], cost: { reinforced_iron_plate: 8, rotor: 4, cable: 10 },
    power: 15, machine: 'assembler', ports: [inBack(-2, 15), inBack(2, 15), outFront(0, 15)], conn: [4.4, 8, -6], ui: 'machine',
    desc: 'Crafts two parts into another part.',
  },
  foundry: {
    name: 'Foundry', cat: 'production', size: [10, 9, 9], cost: { modular_frame: 10, rotor: 10, concrete: 20 },
    smoke: [[0, 8.9, -3.4]], power: 16, machine: 'foundry', ports: [inBack(-2, 9), inBack(2, 9), outFront(0, 9)], conn: [4.4, 8, -3.5], ui: 'machine',
    desc: 'Smelts two resources into alloy ingots.',
  },
  manufacturer: {
    name: 'Manufacturer', cat: 'production', size: [18, 12, 20], cost: { motor: 10, modular_frame: 20, cable: 50, encased_industrial_beam: 20 },
    smoke: [[-5, 12.4, -4], [0, 12.4, -4], [5, 12.4, -4]], power: 55, machine: 'manufacturer',
    ports: [inBack(-6, 20), inBack(-2, 20), inBack(2, 20), inBack(6, 20), outFront(0, 20)], conn: [8, 11, -8], ui: 'machine',
    desc: 'Crafts three or four parts into a complex component.',
  },

  // ---------------- Power ----------------
  biomass_burner: {
    name: 'Biomass Burner', cat: 'power', size: [7, 8, 7], cost: { iron_plate: 15, iron_rod: 15, wire: 25 },
    smoke: [[1.4, 8.6, -1.0]], gen: 30, fuels: ['leaves', 'wood', 'mycelia', 'biomass', 'solid_biofuel'], ports: [inBack(0, 7)], conn: [2.6, 7.5, 2.6], ui: 'generator',
    desc: 'Burns biomass to produce 30 MW. Can be fed by hand or by conveyor.',
  },
  coal_generator: {
    name: 'Coal Generator', cat: 'power', size: [10, 13, 20], cost: { reinforced_iron_plate: 20, rotor: 10, cable: 30 },
    smoke: [[-2.5, 13.8, 5], [2.5, 13.8, 5]], steam: true, gen: 75, fuels: ['coal', 'compacted_coal'], ports: [inBack(0, 20)], conn: [4, 12, 6], ui: 'generator',
    desc: 'Burns coal to produce 75 MW.',
  },
  power_storage: {
    name: 'Power Storage', cat: 'power', size: [6, 6, 6], cost: { wire: 100, modular_frame: 10, stator: 5 },
    battery: 100, conn: [0, 6.2, 0], ui: 'battery',
    desc: 'Stores up to 100 MWh of excess power and releases it when demand exceeds supply.',
  },
  power_pole_mk1: {
    name: 'Power Pole Mk.1', cat: 'power', size: [0.6, 7, 0.6], cost: { wire: 3, iron_rod: 1 },
    pole: 4, conn: [0, 6.8, 0], ui: 'pole', noCollide: true,
    desc: 'Connects buildings to the power grid. Up to 4 connections.',
  },
  power_pole_mk2: {
    name: 'Power Pole Mk.2', cat: 'power', size: [0.7, 9, 0.7], cost: { wire: 6, iron_rod: 2, concrete: 2 },
    pole: 7, conn: [0, 8.8, 0], ui: 'pole', model: 'power_pole_mk1', tint: '#3d74c8', noCollide: true,
    desc: 'Up to 7 connections.',
  },
  power_pole_mk3: {
    name: 'Power Pole Mk.3', cat: 'power', size: [0.8, 11, 0.8], cost: { reinforced_iron_plate: 2, steel_pipe: 2, cable: 4 },
    pole: 10, conn: [0, 10.8, 0], ui: 'pole', model: 'power_pole_mk1', tint: '#8e44ad', noCollide: true,
    desc: 'Up to 10 connections.',
  },
  power_line: {
    name: 'Power Line', cat: 'power', kind: 'wire', cost: { wire: 1 }, costPer: 20, maxLen: 100,
    desc: 'Connect power poles and buildings. Costs 1 Wire per 20 m.',
  },

  // ---------------- Logistics ----------------
  belt_mk1: { name: 'Conveyor Belt Mk.1', cat: 'logistics', kind: 'belt', tier: 1, speed: 1, cost: { iron_plate: 1 }, costPer: 8, maxLen: 56, desc: '60 items/min.' },
  belt_mk2: { name: 'Conveyor Belt Mk.2', cat: 'logistics', kind: 'belt', tier: 2, speed: 2, cost: { reinforced_iron_plate: 1 }, costPer: 8, maxLen: 56, desc: '120 items/min.' },
  belt_mk3: { name: 'Conveyor Belt Mk.3', cat: 'logistics', kind: 'belt', tier: 3, speed: 4.5, cost: { steel_beam: 1 }, costPer: 8, maxLen: 56, desc: '270 items/min.' },
  belt_mk4: { name: 'Conveyor Belt Mk.4', cat: 'logistics', kind: 'belt', tier: 4, speed: 8, cost: { encased_industrial_beam: 1 }, costPer: 8, maxLen: 56, desc: '480 items/min.' },
  belt_mk5: { name: 'Conveyor Belt Mk.5', cat: 'logistics', kind: 'belt', tier: 5, speed: 13, cost: { encased_industrial_beam: 1, steel_pipe: 2 }, costPer: 8, maxLen: 56, desc: '780 items/min.' },
  conveyor_pole: {
    name: 'Conveyor Pole', cat: 'logistics', size: [0.6, 1, 0.6], cost: { iron_rod: 1, iron_plate: 1 }, logistic: 'pole', noCollide: true,
    ports: [{ t: 'in', x: 0, y: 1, z: 0, dx: 0, dz: -1 }, { t: 'out', x: 0, y: 1, z: 0, dx: 0, dz: 1 }],
    desc: 'Supports and joins conveyor belts. Page Up/Down changes its height.',
  },
  splitter: {
    name: 'Conveyor Splitter', cat: 'logistics', size: [3, 2, 3], cost: { iron_plate: 2, cable: 2 }, logistic: 'splitter',
    ports: [
      { t: 'in', x: 0, y: 1, z: -1.5, dx: 0, dz: -1 },
      { t: 'out', x: 0, y: 1, z: 1.5, dx: 0, dz: 1 },
      { t: 'out', x: -1.5, y: 1, z: 0, dx: -1, dz: 0 },
      { t: 'out', x: 1.5, y: 1, z: 0, dx: 1, dz: 0 },
    ],
    desc: 'Splits one conveyor into up to three outputs, evenly.',
  },
  merger: {
    name: 'Conveyor Merger', cat: 'logistics', size: [3, 2, 3], cost: { iron_plate: 2, iron_rod: 2 }, logistic: 'merger',
    ports: [
      { t: 'in', x: 0, y: 1, z: -1.5, dx: 0, dz: -1 },
      { t: 'in', x: -1.5, y: 1, z: 0, dx: -1, dz: 0 },
      { t: 'in', x: 1.5, y: 1, z: 0, dx: 1, dz: 0 },
      { t: 'out', x: 0, y: 1, z: 1.5, dx: 0, dz: 1 },
    ],
    desc: 'Merges up to three conveyors into one.',
  },

  // ---------------- Organisation ----------------
  storage_container: {
    name: 'Storage Container', cat: 'organisation', size: [5, 3.2, 5], cost: { iron_plate: 10, iron_rod: 10 },
    storage: 24, ports: [inBack(0, 5), outFront(0, 5)], ui: 'storage',
    desc: '24 slots. Has a conveyor input and output.',
  },
  industrial_storage: {
    name: 'Industrial Storage Container', cat: 'organisation', size: [6, 6, 10], cost: { steel_beam: 20, steel_pipe: 20 },
    storage: 48, ports: [inBack(-1.5, 10), inBack(1.5, 10), outFront(-1.5, 10), outFront(1.5, 10)], ui: 'storage',
    desc: '48 slots. Two inputs and two outputs.',
  },
  crate: {
    name: 'Dismantle Crate', cat: null, size: [1.4, 1, 1.4], cost: {}, storage: 48, ui: 'storage', crate: true, noCollide: true,
    desc: 'Holds items that did not fit in your inventory.',
  },

  // ---------------- Architecture ----------------
  foundation_1: { name: 'Foundation 1m', cat: 'foundations', size: [8, 1, 8], cost: { concrete: 3 }, snap: 'grid8', arch: true, desc: '8m x 8m x 1m.' },
  foundation_2: { name: 'Foundation 2m', cat: 'foundations', size: [8, 2, 8], cost: { concrete: 5 }, snap: 'grid8', arch: true, desc: '8m x 8m x 2m.' },
  foundation_4: { name: 'Foundation 4m', cat: 'foundations', size: [8, 4, 8], cost: { concrete: 8 }, snap: 'grid8', arch: true, desc: '8m x 8m x 4m.' },
  ramp_2: { name: 'Ramp 2m', cat: 'foundations', size: [8, 2, 8], cost: { concrete: 5 }, snap: 'grid8', arch: true, slope: true, desc: 'Rises 2m over 8m.' },
  ramp_4: { name: 'Ramp 4m', cat: 'foundations', size: [8, 4, 8], cost: { concrete: 8 }, snap: 'grid8', arch: true, slope: true, desc: 'Rises 4m over 8m.' },
  wall: { name: 'Wall', cat: 'foundations', size: [8, 4, 0.5], cost: { concrete: 3 }, snap: 'wall', arch: true, desc: 'Basic 8m x 4m wall.' },
  wall_window: {
    name: 'Window Wall', cat: 'foundations', size: [8, 4, 0.5], cost: { concrete: 2, iron_plate: 2 }, snap: 'wall', arch: true,
    colliders: [[-4, 0, -0.25, 4, 1.2, 0.25], [-4, 3.2, -0.25, 4, 4, 0.25], [-4, 1.2, -0.25, -3, 3.2, 0.25], [3, 1.2, -0.25, 4, 3.2, 0.25]],
    desc: 'A wall with a window.',
  },
  lamp: {
    name: 'Street Light', cat: 'foundations', size: [0.5, 6, 0.5], cost: { iron_rod: 4, wire: 4, quickwire: 2 }, power: 0.5, conn: [0, 5.6, 0],
    noCollide: true, ui: 'pole', lamp: true, desc: 'Lights up your factory at night. Uses 0.5 MW.',
  },
};

for (const [id, d] of Object.entries(BUILDINGS)) {
  d.id = id;
  d.kind = d.kind || 'bld';
  d.ports = d.ports || [];
  if (d.kind === 'bld' && !d.colliders && !d.noCollide) {
    const [w, h, l] = d.size;
    d.colliders = [[-w / 2, 0, -l / 2, w / 2, h, l / 2]];
  }
  if (!d.snap) d.snap = 'free';
}

export const BELT_SPACING = 1.0; // metres between items on a belt
export const MAX_POLE_HEIGHT = 12;

export function beltRate(def) {
  return Math.round(def.speed / BELT_SPACING * 60);
}

// cost of a length-based thing (belt / wire)
export function lengthCost(def, len) {
  const segs = Math.max(1, Math.ceil(len / def.costPer));
  const out = {};
  for (const [k, v] of Object.entries(def.cost)) out[k] = v * segs;
  return out;
}

export function minerRate(def, purity, clock = 1) {
  const base = [30, 60, 120][purity];
  return base * def.miner * clock;
}

export const PURITY = ['Impure', 'Normal', 'Pure'];

export function powerUse(def, clock = 1) {
  if (!def.power) return 0;
  return def.power * Math.pow(clock, 1.321928);
}
