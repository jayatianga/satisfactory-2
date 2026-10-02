import { ITEMS } from './items.js';

// m = machine category, t = cycle time in seconds at 100% clock.
// hand = can also be crafted at the Craft Bench / HUB.
export const RECIPES = {
  // --- Smelter ---
  iron_ingot:     { m: 'smelter', t: 2, in: { iron_ore: 1 }, out: { iron_ingot: 1 }, hand: true },
  copper_ingot:   { m: 'smelter', t: 2, in: { copper_ore: 1 }, out: { copper_ingot: 1 }, hand: true },
  caterium_ingot: { m: 'smelter', t: 4, in: { caterium_ore: 3 }, out: { caterium_ingot: 1 }, hand: true },

  // --- Foundry ---
  steel_ingot:     { m: 'foundry', t: 4, in: { iron_ore: 3, coal: 3 }, out: { steel_ingot: 3 } },
  alt_iron_alloy:  { name: 'Alt: Iron Alloy Ingot', m: 'foundry', t: 6, in: { iron_ore: 2, copper_ore: 2 }, out: { iron_ingot: 5 } },
  alt_solid_steel: { name: 'Alt: Solid Steel Ingot', m: 'foundry', t: 3, in: { iron_ingot: 2, coal: 2 }, out: { steel_ingot: 3 } },

  // --- Constructor ---
  iron_plate:      { m: 'constructor', t: 6, in: { iron_ingot: 3 }, out: { iron_plate: 2 }, hand: true },
  iron_rod:        { m: 'constructor', t: 4, in: { iron_ingot: 1 }, out: { iron_rod: 1 }, hand: true },
  screw:           { m: 'constructor', t: 6, in: { iron_rod: 1 }, out: { screw: 4 }, hand: true },
  wire:            { m: 'constructor', t: 4, in: { copper_ingot: 1 }, out: { wire: 2 }, hand: true },
  cable:           { m: 'constructor', t: 2, in: { wire: 2 }, out: { cable: 1 }, hand: true },
  concrete:        { m: 'constructor', t: 4, in: { limestone: 3 }, out: { concrete: 1 }, hand: true },
  copper_sheet:    { m: 'constructor', t: 6, in: { copper_ingot: 2 }, out: { copper_sheet: 1 }, hand: true },
  steel_beam:      { m: 'constructor', t: 4, in: { steel_ingot: 4 }, out: { steel_beam: 1 }, hand: true },
  steel_pipe:      { m: 'constructor', t: 6, in: { steel_ingot: 3 }, out: { steel_pipe: 2 }, hand: true },
  quickwire:       { m: 'constructor', t: 5, in: { caterium_ingot: 1 }, out: { quickwire: 5 }, hand: true },
  quartz_crystal:  { m: 'constructor', t: 8, in: { raw_quartz: 5 }, out: { quartz_crystal: 3 }, hand: true },
  silica:          { m: 'constructor', t: 8, in: { raw_quartz: 3 }, out: { silica: 5 }, hand: true },
  biomass_leaves:  { name: 'Biomass (Leaves)', m: 'constructor', t: 5, in: { leaves: 10 }, out: { biomass: 5 }, hand: true },
  biomass_wood:    { name: 'Biomass (Wood)', m: 'constructor', t: 4, in: { wood: 4 }, out: { biomass: 20 }, hand: true },
  biomass_mycelia: { name: 'Biomass (Mycelia)', m: 'constructor', t: 4, in: { mycelia: 1 }, out: { biomass: 10 }, hand: true },
  solid_biofuel:   { m: 'constructor', t: 4, in: { biomass: 8 }, out: { solid_biofuel: 4 }, hand: true },

  // --- Assembler ---
  reinforced_iron_plate:   { m: 'assembler', t: 12, in: { iron_plate: 6, screw: 12 }, out: { reinforced_iron_plate: 1 }, hand: true },
  rotor:                   { m: 'assembler', t: 15, in: { iron_rod: 5, screw: 25 }, out: { rotor: 1 }, hand: true },
  modular_frame:           { m: 'assembler', t: 60, in: { reinforced_iron_plate: 3, iron_rod: 12 }, out: { modular_frame: 2 }, hand: true },
  smart_plating:           { m: 'assembler', t: 30, in: { reinforced_iron_plate: 1, rotor: 1 }, out: { smart_plating: 1 }, hand: true },
  encased_industrial_beam: { m: 'assembler', t: 10, in: { steel_beam: 3, concrete: 6 }, out: { encased_industrial_beam: 1 }, hand: true },
  stator:                  { m: 'assembler', t: 12, in: { steel_pipe: 3, wire: 8 }, out: { stator: 1 }, hand: true },
  motor:                   { m: 'assembler', t: 12, in: { rotor: 2, stator: 2 }, out: { motor: 1 }, hand: true },
  versatile_framework:     { m: 'assembler', t: 24, in: { modular_frame: 1, steel_beam: 12 }, out: { versatile_framework: 2 } },
  automated_wiring:        { m: 'assembler', t: 24, in: { stator: 1, cable: 20 }, out: { automated_wiring: 1 } },
  compacted_coal:          { m: 'assembler', t: 12, in: { coal: 5, sulfur: 5 }, out: { compacted_coal: 5 } },
  power_shard:             { m: 'assembler', t: 30, in: { quartz_crystal: 10, quickwire: 20 }, out: { power_shard: 1 } },
  alt_fused_wire:          { name: 'Alt: Fused Wire', m: 'assembler', t: 20, in: { copper_ingot: 4, caterium_ingot: 1 }, out: { wire: 30 } },
  alt_stitched_plate:      { name: 'Alt: Stitched Iron Plate', m: 'assembler', t: 32, in: { iron_plate: 10, wire: 20 }, out: { reinforced_iron_plate: 3 } },
  alt_bolted_frame:        { name: 'Alt: Bolted Frame', m: 'assembler', t: 24, in: { reinforced_iron_plate: 3, screw: 56 }, out: { modular_frame: 2 } },
  alt_steel_rotor:         { name: 'Alt: Steel Rotor', m: 'assembler', t: 12, in: { steel_pipe: 2, wire: 6 }, out: { rotor: 1 } },
  alt_quickwire_stator:    { name: 'Alt: Quickwire Stator', m: 'assembler', t: 15, in: { steel_pipe: 4, quickwire: 15 }, out: { stator: 2 } },

  // --- Manufacturer ---
  heavy_modular_frame: { m: 'manufacturer', t: 30, in: { modular_frame: 5, steel_pipe: 15, encased_industrial_beam: 5, screw: 100 }, out: { heavy_modular_frame: 1 } },
  crystal_oscillator:  { m: 'manufacturer', t: 120, in: { quartz_crystal: 36, cable: 28, reinforced_iron_plate: 5 }, out: { crystal_oscillator: 2 } },
};

for (const [id, r] of Object.entries(RECIPES)) {
  r.id = id;
  if (!r.name) r.name = ITEMS[Object.keys(r.out)[0]].name;
  r.inList = Object.entries(r.in).map(([item, n]) => ({ item, n }));
  r.outList = Object.entries(r.out).map(([item, n]) => ({ item, n }));
  r.alt = id.startsWith('alt_');
}

export const START_RECIPES = ['iron_ingot', 'iron_plate', 'iron_rod'];

export function handTime(r) {
  return Math.min(6, Math.max(0.6, r.t * 0.45));
}

export function perMinute(r, n, clock = 1) {
  return (60 / r.t) * n * clock;
}
