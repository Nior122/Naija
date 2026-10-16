import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionalRegistry } from '../dist/geography/regional-registry.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up from test/ to services/world-api, then up to Naija root, then into game/data
const DATA_PATH = join(__dirname, '..', '..', '..', 'game', 'data');

test('RegionalRegistryService - initialization', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  assert.equal(regionalRegistry.isLoaded(), true, 'Registry should be loaded');
});

test('RegionalRegistryService - catalog structure', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  const catalog = regionalRegistry.getCatalog();
  
  assert.ok(catalog, 'Catalog should exist');
  assert.equal(catalog.schema_version, 1, 'Schema version should be 1');
  assert.equal(catalog.world_id, 'nigeria-main', 'World ID should be nigeria-main');
  assert.ok(catalog.country, 'Country data should exist');
  assert.equal(catalog.country.id, 'NG', 'Country ID should be NG');
  assert.equal(catalog.country.name, 'Nigeria', 'Country name should be Nigeria');
});

test('RegionalRegistryService - state count', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  const states = regionalRegistry.getAllStates();
  
  assert.equal(states.length, 37, 'Should have 37 states (36 + FCT)');
});

test('RegionalRegistryService - get state by ID', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  const lagos = regionalRegistry.getState('ng:state:la');
  assert.ok(lagos, 'Lagos state should exist');
  assert.equal(lagos.name, 'Lagos', 'State name should be Lagos');
  assert.ok(lagos.code, 'State code should exist');
  assert.ok(lagos.capital, 'Capital should exist');
  assert.equal(lagos.region, 'southwest', 'Region should be southwest');
  assert.ok(lagos.lgas.length > 0, 'Should have LGAs');
  assert.ok(lagos.population > 0, 'Should have population');
  assert.ok(lagos.area_km2 > 0, 'Should have area');
  assert.ok(lagos.coordinates.center, 'Should have center coordinates');
  assert.ok(lagos.coordinates.bounds, 'Should have bounds');
  assert.ok(lagos.environment, 'Should have environment profile');
});

test('RegionalRegistryService - FCT exists', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  const fct = regionalRegistry.getState('ng:state:fc');
  assert.ok(fct, 'FCT should exist');
  assert.ok(fct.name.includes('Federal') || fct.name === 'Abuja', 'Name should indicate FCT or Abuja');
  assert.ok(fct.code, 'Code should exist');
});

test('RegionalRegistryService - states by region', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  const southwest = regionalRegistry.getStatesByRegion('southwest');
  assert.ok(southwest.length > 0, 'Should have states in southwest');
  
  const northeast = regionalRegistry.getStatesByRegion('northeast');
  assert.ok(northeast.length > 0, 'Should have states in northeast');
  
  // Verify Lagos is in southwest
  const lagosInSouthwest = southwest.find(s => s.id === 'ng:state:la');
  assert.ok(lagosInSouthwest, 'Lagos should be in southwest region');
});

test('RegionalRegistryService - LGA to state mapping', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  // Get Lagos and check an LGA
  const lagos = regionalRegistry.getState('ng:state:la');
  assert.ok(lagos, 'Lagos should exist');
  assert.ok(lagos.lgas.length > 0, 'Lagos should have LGAs');
  
  // Get first LGA
  const firstLga = lagos.lgas[0];
  const stateFromLga = regionalRegistry.getStateByLga(firstLga);
  assert.ok(stateFromLga, 'Should find state from LGA');
  assert.equal(stateFromLga.id, lagos.id, 'Should map back to Lagos');
});

test('RegionalRegistryService - environment profiles', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  const lagosEnv = regionalRegistry.getEnvironmentProfile('ng:state:la');
  assert.ok(lagosEnv, 'Lagos environment should exist');
  assert.equal(lagosEnv.climate, 'tropical', 'Climate should be tropical');
  assert.equal(lagosEnv.terrain, 'coastal', 'Terrain should be coastal');
  assert.ok(lagosEnv.primary_industries.includes('commerce'), 'Should include commerce');
  assert.ok(lagosEnv.primary_industries.includes('finance'), 'Should include finance');
  assert.ok(lagosEnv.languages.includes('yoruba'), 'Should include Yoruba');
  assert.ok(lagosEnv.languages.includes('english'), 'Should include English');
  assert.ok(lagosEnv.cultural_significance.length > 0, 'Should have cultural significance');
  assert.ok(lagosEnv.gameplay_features.length > 0, 'Should have gameplay features');
});

test('RegionalRegistryService - coordinate bounds check', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  // Point inside Lagos bounds (approximately)
  const insidePoint = { latitude: 6.50, longitude: 3.40 };
  assert.equal(
    regionalRegistry.isCoordinateInState(insidePoint, 'ng:state:la'),
    true,
    'Point should be inside Lagos bounds'
  );
  
  // Point outside Lagos bounds (in Abuja area)
  const outsidePoint = { latitude: 9.06, longitude: 7.49 };
  assert.equal(
    regionalRegistry.isCoordinateInState(outsidePoint, 'ng:state:la'),
    false,
    'Point should be outside Lagos bounds'
  );
});

test('RegionalRegistryService - find nearest state', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  // Point near Lagos
  const nearLagos = { latitude: 6.50, longitude: 3.40 };
  const nearest = regionalRegistry.findNearestState(nearLagos);
  
  assert.ok(nearest, 'Should find nearest state');
  assert.equal(nearest.state_id, 'ng:state:la', 'Nearest should be Lagos');
  assert.ok(nearest.distance_km < 100, 'Distance should be reasonable');
  assert.ok(nearest.bearing_degrees >= 0 && nearest.bearing_degrees < 360, 'Bearing should be valid');
});

test('RegionalRegistryService - states within radius', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  // Center of Nigeria (approximately)
  const center = { latitude: 9.06, longitude: 7.49 }; // Abuja
  
  const statesNearby = regionalRegistry.getStatesWithinRadius(center, 300);
  assert.ok(statesNearby.length > 0, 'Should find states within 300km');
  
  // Abuja should be closest
  const closest = statesNearby[0];
  assert.ok(closest, 'Should have closest state');
  assert.ok(closest.distance_km < 50, 'Closest should be very near');
  
  // All should be sorted by distance
  for (let i = 1; i < statesNearby.length; i++) {
    assert.ok(
      statesNearby[i].distance_km >= statesNearby[i - 1].distance_km,
      'States should be sorted by distance'
    );
  }
});

test('RegionalRegistryService - statistics', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  const stats = regionalRegistry.getStatistics();
  
  assert.equal(stats.total_states, 37, 'Should have 37 states');
  assert.ok(stats.total_lgas > 700, 'Should have 700+ LGAs');
  assert.ok(stats.total_population > 150000000, 'Population should be 150M+');
  assert.ok(stats.total_area_km2 > 800000, 'Area should be 800k+ km²');
  assert.ok(Object.keys(stats.states_by_region).length > 0, 'Should have region breakdown');
  
  // Check that all regions are represented
  const regions = Object.keys(stats.states_by_region);
  assert.ok(regions.includes('southwest'), 'Should include southwest');
  assert.ok(regions.includes('northeast'), 'Should include northeast');
  assert.ok(regions.includes('northcentral'), 'Should include northcentral');
});

test('RegionalRegistryService - all states have required data', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  const states = regionalRegistry.getAllStates();
  
  for (const state of states) {
    assert.ok(state.id, 'State should have ID');
    assert.ok(state.name, 'State should have name');
    assert.ok(state.code, 'State should have code');
    assert.ok(state.capital, 'State should have capital');
    assert.ok(state.region, 'State should have region');
    assert.ok(Array.isArray(state.lgas), 'State should have LGA array');
    assert.ok(state.lgas.length > 0, 'State should have at least one LGA');
    assert.ok(state.population > 0, 'State should have population');
    assert.ok(state.area_km2 > 0, 'State should have area');
    assert.ok(state.coordinates.center, 'State should have center coordinates');
    assert.ok(state.coordinates.bounds, 'State should have bounds');
    assert.ok(state.environment, 'State should have environment profile');
    
    // Check environment profile
    const env = state.environment;
    assert.ok(env.climate, 'Environment should have climate');
    assert.ok(env.terrain, 'Environment should have terrain');
    assert.ok(Array.isArray(env.primary_industries), 'Environment should have industries array');
    assert.ok(Array.isArray(env.languages), 'Environment should have languages array');
    assert.ok(env.cultural_significance, 'Environment should have cultural significance');
    assert.ok(Array.isArray(env.gameplay_features), 'Environment should have gameplay features');
    assert.ok(Array.isArray(env.restrictions), 'Environment should have restrictions array');
  }
});

test('RegionalRegistryService - geographic diversity', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  const states = regionalRegistry.getAllStates();
  
  // Check for climate diversity
  const climates = new Set(states.map(s => s.environment.climate));
  assert.ok(climates.size >= 3, 'Should have at least 3 climate types');
  
  // Check for terrain diversity
  const terrains = new Set(states.map(s => s.environment.terrain));
  assert.ok(terrains.size >= 4, 'Should have at least 4 terrain types');
  
  // Check for regional diversity
  const regions = new Set(states.map(s => s.region));
  assert.ok(regions.size >= 6, 'Should have at least 6 regions');
});

test('RegionalRegistryService - coordinate validation', async () => {
  await regionalRegistry.initialize(DATA_PATH);
  
  const states = regionalRegistry.getAllStates();
  
  for (const state of states) {
    const { center, bounds } = state.coordinates;
    
    // Validate center coordinates
    assert.ok(center.latitude >= -90 && center.latitude <= 90, 'Center latitude should be valid');
    assert.ok(center.longitude >= -180 && center.longitude <= 180, 'Center longitude should be valid');
    
    // Validate bounds
    assert.ok(bounds.west <= bounds.east, 'West should be <= east');
    assert.ok(bounds.south <= bounds.north, 'South should be <= north');
    
    // Center should be within bounds
    assert.ok(
      center.longitude >= bounds.west && center.longitude <= bounds.east,
      'Center longitude should be within bounds'
    );
    assert.ok(
      center.latitude >= bounds.south && center.latitude <= bounds.north,
      'Center latitude should be within bounds'
    );
    
    // Bounds should be reasonable for Nigeria (roughly 2-15°E, 4-14°N)
    assert.ok(bounds.west >= 2 && bounds.west <= 13, 'West bound should be reasonable');
    assert.ok(bounds.east >= 3 && bounds.east <= 15, 'East bound should be reasonable');
    assert.ok(bounds.south >= 3 && bounds.south <= 13, 'South bound should be reasonable');
    assert.ok(bounds.north >= 4 && bounds.north <= 14, 'North bound should be reasonable');
  }
});
