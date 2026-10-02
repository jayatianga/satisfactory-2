// HUB milestones, Space Elevator phases, M.A.M. research and the AWESOME Shop.
// unlocks: b = buildings, r = recipes, slots = extra inventory slots, eq = equipment.

export const START_BUILDINGS = ['hub'];

export const TIER_REQ = { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 2 }; // Space Elevator phase needed per tier

export const MILESTONES = [
  // ---- Tier 0: Onboarding ----
  { id: 'hub1', tier: 0, name: 'HUB Upgrade 1', cost: { iron_rod: 10 },
    unlocks: { b: ['storage_container', 'craft_bench'], r: ['screw'], slots: 3 } },
  { id: 'hub2', tier: 0, name: 'HUB Upgrade 2', cost: { iron_rod: 20, iron_plate: 10 },
    unlocks: { b: ['biomass_burner', 'power_pole_mk1', 'power_line'], r: ['copper_ingot', 'wire', 'cable', 'biomass_leaves', 'biomass_wood'] } },
  { id: 'hub3', tier: 0, name: 'HUB Upgrade 3', cost: { iron_plate: 20, iron_rod: 20, wire: 20 },
    unlocks: { b: ['miner_mk1', 'belt_mk1', 'conveyor_pole', 'smelter'], r: ['concrete'] } },
  { id: 'hub4', tier: 0, name: 'HUB Upgrade 4', cost: { iron_plate: 50, concrete: 20, cable: 20 },
    unlocks: { b: ['constructor', 'foundation_1', 'wall', 'ramp_2'], slots: 3 } },

  // ---- Tier 1 ----
  { id: 'base_building', tier: 1, name: 'Base Building', cost: { concrete: 100, iron_plate: 100, iron_rod: 100 },
    unlocks: { b: ['foundation_2', 'foundation_4', 'ramp_4', 'wall_window'], r: ['copper_sheet'] } },
  { id: 'logistics', tier: 1, name: 'Logistics', cost: { iron_plate: 150, iron_rod: 150, screw: 300 },
    unlocks: { b: ['splitter', 'merger'] } },
  { id: 'field_research', tier: 1, name: 'Field Research', cost: { wire: 300, screw: 300, iron_plate: 100 },
    unlocks: { b: ['mam'], slots: 6 } },

  // ---- Tier 2 ----
  { id: 'part_assembly', tier: 2, name: 'Part Assembly', cost: { cable: 200, iron_rod: 200, screw: 500, iron_plate: 300 },
    unlocks: { b: ['assembler', 'space_elevator'], r: ['reinforced_iron_plate', 'rotor', 'modular_frame', 'smart_plating'] } },
  { id: 'sink_program', tier: 2, name: 'Resource Sink Bonus Program', cost: { concrete: 400, wire: 500, iron_rod: 200, iron_plate: 200 },
    unlocks: { b: ['awesome_sink'] } },
  { id: 'logistics_mk2', tier: 2, name: 'Logistics Mk.2', cost: { reinforced_iron_plate: 50, concrete: 200, cable: 200 },
    unlocks: { b: ['belt_mk2'], eq: ['jetpack'] } },

  // ---- Tier 3 ----
  { id: 'coal_power', tier: 3, name: 'Coal Power', cost: { reinforced_iron_plate: 150, rotor: 50, cable: 300 },
    unlocks: { b: ['coal_generator', 'power_pole_mk2'] } },
  { id: 'basic_steel', tier: 3, name: 'Basic Steel Production', cost: { rotor: 50, wire: 1000, concrete: 300, reinforced_iron_plate: 100 },
    unlocks: { b: ['foundry'], r: ['steel_ingot', 'steel_beam', 'steel_pipe', 'versatile_framework'] } },

  // ---- Tier 4 ----
  { id: 'advanced_steel', tier: 4, name: 'Advanced Steel Production', cost: { steel_pipe: 200, rotor: 200, wire: 1500, concrete: 300 },
    unlocks: { b: ['miner_mk2'], r: ['stator', 'motor', 'automated_wiring', 'encased_industrial_beam'] } },
  { id: 'logistics_mk3', tier: 4, name: 'Logistics Mk.3', cost: { steel_beam: 200, steel_pipe: 100, concrete: 500 },
    unlocks: { b: ['belt_mk3', 'industrial_storage', 'power_pole_mk3'] } },
  { id: 'power_storage_m', tier: 4, name: 'Expanded Power Infrastructure', cost: { encased_industrial_beam: 50, steel_beam: 100, modular_frame: 50 },
    unlocks: { b: ['power_storage'], slots: 6 } },

  // ---- Tier 5 ----
  { id: 'industrial_manufacturing', tier: 5, name: 'Industrial Manufacturing', cost: { motor: 50, encased_industrial_beam: 100, modular_frame: 100, steel_pipe: 300 },
    unlocks: { b: ['manufacturer'], r: ['heavy_modular_frame'] } },
  { id: 'logistics_mk4', tier: 5, name: 'Logistics Mk.4', cost: { motor: 100, encased_industrial_beam: 100, steel_beam: 500 },
    unlocks: { b: ['belt_mk4', 'miner_mk3'] } },
  { id: 'logistics_mk5', tier: 5, name: 'Logistics Mk.5', cost: { heavy_modular_frame: 20, motor: 100, steel_pipe: 500 },
    unlocks: { b: ['belt_mk5'] } },
];

export const ELEVATOR_PHASES = [
  { name: 'Distribution Platform', cost: { smart_plating: 50 }, unlocksText: 'Unlocks Tier 3 & Tier 4' },
  { name: 'Construction Dock', cost: { smart_plating: 300, versatile_framework: 200, automated_wiring: 50 }, unlocksText: 'Unlocks Tier 5' },
  { name: 'Main Body', cost: { versatile_framework: 500, heavy_modular_frame: 50, motor: 100, crystal_oscillator: 25 }, unlocksText: 'Completes Project Assembly — FICSIT thanks you, Pioneer.' },
];

export const RESEARCH = [
  { id: 'r_caterium', tree: 'Caterium', name: 'Caterium Analysis', cost: { caterium_ore: 10 },
    unlocks: { r: ['caterium_ingot', 'quickwire'], b: ['lamp'] } },
  { id: 'r_caterium2', tree: 'Caterium', name: 'Caterium Electronics', req: 'r_caterium', cost: { quickwire: 100, caterium_ingot: 50 },
    unlocks: { r: ['alt_fused_wire', 'alt_quickwire_stator'] } },
  { id: 'r_quartz', tree: 'Quartz', name: 'Quartz Analysis', cost: { raw_quartz: 10 },
    unlocks: { r: ['quartz_crystal', 'silica', 'crystal_oscillator'] } },
  { id: 'r_shards', tree: 'Quartz', name: 'Power Shards', req: 'r_quartz', cost: { quartz_crystal: 50, quickwire: 100 },
    unlocks: { r: ['power_shard'], gift: { power_shard: 3 } } },
  { id: 'r_sulfur', tree: 'Sulfur', name: 'Sulfur Analysis', cost: { sulfur: 10 },
    unlocks: { r: ['compacted_coal'] } },
  { id: 'r_mycelia', tree: 'Mycelia', name: 'Mycelia Analysis', cost: { mycelia: 10 },
    unlocks: { r: ['biomass_mycelia', 'solid_biofuel'] } },
  { id: 'r_hd_iron', tree: 'Hard Drives', name: 'Hard Drive: Iron Alternates', cost: { iron_plate: 200, wire: 200, screw: 200 },
    unlocks: { r: ['alt_stitched_plate', 'alt_bolted_frame'] } },
  { id: 'r_hd_steel', tree: 'Hard Drives', name: 'Hard Drive: Steel Alternates', cost: { steel_ingot: 100, coal: 200, rotor: 20 },
    unlocks: { r: ['alt_solid_steel', 'alt_iron_alloy', 'alt_steel_rotor'] } },
];

export const SHOP = [
  { id: 'inv_upgrade', name: 'Inventory Upgrade', desc: '+5 inventory slots for every Pioneer.', price: 3, max: 4 },
  { id: 'power_shard', name: 'Power Shard', desc: 'Overclock a machine by 50% per shard.', price: 2 },
  { id: 'blade_runners', name: 'Blade Runners', desc: 'Jump higher and sprint faster.', price: 8, max: 1 },
  { id: 'coupon_smart', name: 'Smart Plating x20', desc: 'A care package of Smart Plating.', price: 6 },
];

export function couponCost(earned) {
  return Math.min(20000, 500 + earned * 250);
}

export const MILESTONE_BY_ID = Object.assign(Object.create(null), Object.fromEntries(MILESTONES.map(m => [m.id, m])));
export const RESEARCH_BY_ID = Object.assign(Object.create(null), Object.fromEntries(RESEARCH.map(m => [m.id, m])));
