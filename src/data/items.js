// Every item in the game. `shape` drives the procedural inventory icon and the
// mesh used for the item when it rides a conveyor belt. `fuel` is energy in MJ,
// `points` is the AWESOME Sink value.
export const ITEMS = {
  iron_ore:       { name: 'Iron Ore', shape: 'ore', color: '#8c5b4a', c2: '#b8806a', stack: 100, points: 1 },
  copper_ore:     { name: 'Copper Ore', shape: 'ore', color: '#b8673a', c2: '#3fa89a', stack: 100, points: 3 },
  limestone:      { name: 'Limestone', shape: 'ore', color: '#d4ccb6', c2: '#a89f88', stack: 100, points: 2 },
  coal:           { name: 'Coal', shape: 'ore', color: '#2b2b2e', c2: '#55555e', stack: 100, points: 3, fuel: 300 },
  caterium_ore:   { name: 'Caterium Ore', shape: 'ore', color: '#d9b23a', c2: '#f6e59a', stack: 100, points: 7 },
  raw_quartz:     { name: 'Raw Quartz', shape: 'crystal', color: '#e48ad6', c2: '#ffd8f7', stack: 100, points: 15 },
  sulfur:         { name: 'Sulfur', shape: 'ore', color: '#e2d43a', c2: '#fff59a', stack: 100, points: 11 },

  leaves:         { name: 'Leaves', shape: 'leaf', color: '#4f8f34', c2: '#7cc451', stack: 500, fuel: 15, points: 1 },
  wood:           { name: 'Wood', shape: 'log', color: '#7a5233', c2: '#c09060', stack: 200, fuel: 100, points: 3 },
  mycelia:        { name: 'Mycelia', shape: 'mush', color: '#9b5fc0', c2: '#e2b8ff', stack: 200, fuel: 20, points: 4 },
  biomass:        { name: 'Biomass', shape: 'bale', color: '#7c8f3a', c2: '#a8bb5a', stack: 200, fuel: 180, points: 12 },
  solid_biofuel:  { name: 'Solid Biofuel', shape: 'pellet', color: '#5f7d2a', c2: '#9fc04e', stack: 200, fuel: 450, points: 48 },

  iron_ingot:     { name: 'Iron Ingot', shape: 'ingot', color: '#9aa1a8', stack: 100, points: 2 },
  copper_ingot:   { name: 'Copper Ingot', shape: 'ingot', color: '#c9733e', stack: 100, points: 6 },
  caterium_ingot: { name: 'Caterium Ingot', shape: 'ingot', color: '#e6bf3c', stack: 100, points: 42 },
  steel_ingot:    { name: 'Steel Ingot', shape: 'ingot', color: '#5b6066', stack: 100, points: 8 },

  concrete:       { name: 'Concrete', shape: 'block', color: '#a9a69e', stack: 500, points: 12 },
  iron_plate:     { name: 'Iron Plate', shape: 'plate', color: '#b5bcc4', stack: 200, points: 6 },
  iron_rod:       { name: 'Iron Rod', shape: 'rod', color: '#8e959c', stack: 200, points: 4 },
  screw:          { name: 'Screw', shape: 'screw', color: '#c3c8cc', stack: 500, points: 2 },
  wire:           { name: 'Wire', shape: 'wire', color: '#d6823f', stack: 500, points: 6 },
  cable:          { name: 'Cable', shape: 'cable', color: '#2f3237', c2: '#d6823f', stack: 200, points: 24 },
  copper_sheet:   { name: 'Copper Sheet', shape: 'sheet', color: '#d08048', stack: 200, points: 24 },
  quickwire:      { name: 'Quickwire', shape: 'wire', color: '#f0c840', stack: 500, points: 17 },
  quartz_crystal: { name: 'Quartz Crystal', shape: 'crystal', color: '#f2a0e6', c2: '#ffffff', stack: 200, points: 50 },
  silica:         { name: 'Silica', shape: 'powder', color: '#e8e2f0', c2: '#bdb4cc', stack: 200, points: 20 },
  compacted_coal: { name: 'Compacted Coal', shape: 'block', color: '#3a3330', stack: 100, fuel: 630, points: 28 },
  steel_beam:     { name: 'Steel Beam', shape: 'beam', color: '#5a6168', stack: 200, points: 64 },
  steel_pipe:     { name: 'Steel Pipe', shape: 'pipe', color: '#6d747b', stack: 200, points: 24 },

  reinforced_iron_plate: { name: 'Reinforced Iron Plate', shape: 'rplate', color: '#9aa3ab', c2: '#e8862a', stack: 100, points: 120 },
  rotor:          { name: 'Rotor', shape: 'rotor', color: '#a0a7ad', c2: '#5b6066', stack: 100, points: 140 },
  modular_frame:  { name: 'Modular Frame', shape: 'frame', color: '#c4c9ce', c2: '#e8862a', stack: 50, points: 408 },
  smart_plating:  { name: 'Smart Plating', shape: 'smart', color: '#9ea6ae', c2: '#3cc6e8', stack: 50, points: 520 },
  encased_industrial_beam: { name: 'Encased Industrial Beam', shape: 'ebeam', color: '#a9a69e', c2: '#5a6168', stack: 100, points: 528 },
  stator:         { name: 'Stator', shape: 'stator', color: '#6d747b', c2: '#d6823f', stack: 100, points: 240 },
  motor:          { name: 'Motor', shape: 'motor', color: '#8a9096', c2: '#e8862a', stack: 50, points: 1520 },
  versatile_framework: { name: 'Versatile Framework', shape: 'vframe', color: '#d9a13a', c2: '#5a6168', stack: 50, points: 1176 },
  automated_wiring: { name: 'Automated Wiring', shape: 'awiring', color: '#3a7bd5', c2: '#d6823f', stack: 50, points: 1440 },
  heavy_modular_frame: { name: 'Heavy Modular Frame', shape: 'hframe', color: '#4d5359', c2: '#c4c9ce', stack: 50, points: 10800 },
  crystal_oscillator: { name: 'Crystal Oscillator', shape: 'oscillator', color: '#5b6066', c2: '#f2a0e6', stack: 100, points: 3072 },
  power_shard:    { name: 'Power Shard', shape: 'shard', color: '#4fd1ff', c2: '#c8f4ff', stack: 100 },
};

export const ITEM_IDS = Object.keys(ITEMS);
export const ITEM_INDEX = Object.fromEntries(ITEM_IDS.map((id, i) => [id, i]));
for (const id of ITEM_IDS) ITEMS[id].id = id;

export function itemName(id) {
  return ITEMS[id] ? ITEMS[id].name : id;
}

export function stackOf(id) {
  return ITEMS[id] ? ITEMS[id].stack : 100;
}

// Which conveyor-belt mesh an item uses.
export function beltForm(id) {
  const s = ITEMS[id] ? ITEMS[id].shape : 'ore';
  switch (s) {
    case 'ingot': return 'ingot';
    case 'plate': case 'sheet': case 'rplate': case 'smart': return 'plate';
    case 'rod': case 'pipe': case 'beam': case 'ebeam': case 'wire': case 'cable': case 'log': return 'rod';
    case 'screw': case 'pellet': return 'small';
    case 'frame': case 'vframe': case 'hframe': case 'rotor': case 'stator': case 'motor':
    case 'awiring': case 'oscillator': case 'block': case 'bale': return 'box';
    case 'crystal': case 'shard': return 'crystal';
    default: return 'chunk';
  }
}
