import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const DATA_PATH = join(process.cwd(), 'game', 'data');

async function generateCatalog() {
  // Load existing admin data
  const adminPath = join(DATA_PATH, 'geography', 'processed', 'nigeria-admin.json');
  const adminData = JSON.parse(await readFile(adminPath, 'utf-8'));
  
  // Load environment profiles
  const profilesPath = join(DATA_PATH, 'geography', 'regional-environment-profiles.json');
  const profilesData = JSON.parse(await readFile(profilesPath, 'utf-8'));
  
  // Build complete catalog
  const catalog = {
    schema_version: 1,
    world_id: 'nigeria-main',
    notice: 'Regional catalog for Naija: One World. Contains all 36 states plus FCT with metadata, LGAs, and environment profiles.',
    country: {
      id: 'NG',
      name: 'Nigeria',
      capital: 'Abuja',
      population: 223800000,
      area_km2: 923768
    },
    states: []
  };
  
  // Group LGAs by state
  const lgasByState = {};
  for (const lga of adminData.lgas) {
    if (!lgasByState[lga.state_id]) {
      lgasByState[lga.state_id] = [];
    }
    lgasByState[lga.state_id].push(lga.id);
  }
  
  // Build state entries
  for (const state of adminData.states) {
    const stateLgas = lgasByState[state.id] || [];
    const environment = profilesData.profiles[state.id];
    
    if (!environment) {
      console.warn(`Warning: No environment profile for ${state.id}`);
      continue;
    }
    
    // Calculate approximate bounds from LGA coordinates
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    let centerLat = 0, centerLon = 0;
    
    const stateLgaData = adminData.lgas.filter(l => l.state_id === state.id);
    
    for (const lga of stateLgaData) {
      const lat = lga.coordinate.latitude;
      const lon = lga.coordinate.longitude;
      
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      
      centerLat += lat;
      centerLon += lon;
    }
    
    if (stateLgaData.length > 0) {
      centerLat /= stateLgaData.length;
      centerLon /= stateLgaData.length;
    }
    
    const catalogState = {
      id: state.id,
      name: state.name,
      code: state.source_code || state.id.split(':')[2].substring(0, 2).toUpperCase(),
      capital: state.name, // Will use state name as placeholder
      region: getRegion(state.id, state.name),
      lgas: stateLgas,
      population: estimatePopulation(state.name, stateLgaData.length),
      area_km2: estimateArea(state.name),
      coordinates: {
        center: {
          latitude: Math.round(centerLat * 100) / 100,
          longitude: Math.round(centerLon * 100) / 100
        },
        bounds: {
          west: Math.round(minLon * 100) / 100,
          south: Math.round(minLat * 100) / 100,
          east: Math.round(maxLon * 100) / 100,
          north: Math.round(maxLat * 100) / 100
        }
      },
      environment
    };
    
    catalog.states.push(catalogState);
  }
  
  // Sort states by name
  catalog.states.sort((a, b) => a.name.localeCompare(b.name));
  
  // Write catalog
  const catalogPath = join(DATA_PATH, 'geography', 'regional-catalog.json');
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  
  console.log(`Generated catalog with ${catalog.states.length} states`);
  console.log(`Total LGAs: ${catalog.states.reduce((sum, s) => sum + s.lgas.length, 0)}`);
}

function getRegion(stateId, stateName) {
  // Map abbreviated state IDs to their geopolitical regions
  const regionMap = {
    'ng:state:ab': 'southeast',
    'ng:state:ad': 'northeast',
    'ng:state:ak': 'southsouth',
    'ng:state:an': 'southeast',
    'ng:state:ba': 'northeast',
    'ng:state:be': 'northcentral',
    'ng:state:bo': 'northeast',
    'ng:state:by': 'southsouth',
    'ng:state:cr': 'southsouth',
    'ng:state:de': 'southsouth',
    'ng:state:eb': 'southeast',
    'ng:state:ed': 'southsouth',
    'ng:state:ek': 'southwest',
    'ng:state:en': 'southeast',
    'ng:state:fc': 'northcentral',
    'ng:state:go': 'northeast',
    'ng:state:im': 'southeast',
    'ng:state:ji': 'northwest',
    'ng:state:kd': 'northwest',
    'ng:state:ke': 'northwest',
    'ng:state:kn': 'northwest',
    'ng:state:ko': 'northcentral',
    'ng:state:kt': 'northwest',
    'ng:state:kw': 'northcentral',
    'ng:state:la': 'southwest',
    'ng:state:na': 'northcentral',
    'ng:state:ni': 'northcentral',
    'ng:state:og': 'southwest',
    'ng:state:on': 'southwest',
    'ng:state:os': 'southwest',
    'ng:state:oy': 'southwest',
    'ng:state:pl': 'northcentral',
    'ng:state:ri': 'southsouth',
    'ng:state:so': 'northwest',
    'ng:state:ta': 'northeast',
    'ng:state:yo': 'northeast',
    'ng:state:za': 'northwest'
  };
  
  return regionMap[stateId] || 'northcentral';
}

function estimatePopulation(stateName, lgaCount) {
  // Rough population estimates based on known data
  const populationMap = {
    'Lagos': 15000000,
    'Kano': 13000000,
    'Kaduna': 8000000,
    'Katsina': 7500000,
    'Oyo': 7000000,
    'Rivers': 6500000,
    'Bauchi': 6500000,
    'Benue': 5700000,
    'Anambra': 5500000,
    'Borno': 5800000,
    'Delta': 5600000,
    'Akwa Ibom': 5400000,
    'Enugu': 4400000,
    'Sokoto': 4200000,
    'Cross River': 4400000,
    'Kwara': 3800000,
    'Edo': 4200000,
    'Niger': 5500000,
    'Ogun': 5200000,
    'Ekiti': 3500000,
    'Osun': 3500000,
    'Adamawa': 4200000,
    'Gombe': 3500000,
    'Plateau': 4200000,
    'Imo': 5400000,
    'Abia': 3700000,
    'Ebonyi': 2800000,
    'Taraba': 3800000,
    'Jigawa': 5200000,
    'Kogi': 4400000,
    'Nasarawa': 2500000,
    'Yobe': 3500000,
    'Zamfara': 4200000,
    'Kebbi': 4000000,
    'Bayelsa': 2200000,
    'Federal Capital Territory': 3500000
  };
  
  return populationMap[stateName] || (lgaCount * 300000);
}

function estimateArea(stateName) {
  // Rough area estimates in km²
  const areaMap = {
    'Niger': 76363,
    'Borno': 70898,
    'Bauchi': 45893,
    'Adamawa': 36116,
    'Taraba': 54473,
    'Benue': 34059,
    'Kaduna': 46053,
    'Kano': 20131,
    'Katsina': 24192,
    'Jigawa': 23154,
    'Sokoto': 25973,
    'Zamfara': 39761,
    'Kebbi': 36800,
    'Kwara': 36825,
    'Plateau': 30913,
    'Nasarawa': 27117,
    'Kogi': 29833,
    'Federal Capital Territory': 7315,
    'Lagos': 3577,
    'Ogun': 16981,
    'Oyo': 28454,
    'Osun': 9251,
    'Ekiti': 6353,
    'Ondo': 15500,
    'Edo': 17802,
    'Delta': 17663,
    'Rivers': 11077,
    'Akwa Ibom': 7081,
    'Cross River': 22961,
    'Bayelsa': 10773,
    'Abia': 6320,
    'Imo': 5530,
    'Anambra': 4844,
    'Enugu': 7161,
    'Ebonyi': 5934
  };
  
  return areaMap[stateName] || 10000;
}

generateCatalog().catch(console.error);
