import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const DATA_PATH = join(process.cwd(), 'game', 'data');

// Mapping of abbreviated IDs to full state names
const idMapping = {
  'ng:state:ab': 'ng:state:abia',
  'ng:state:ad': 'ng:state:adamawa',
  'ng:state:ak': 'ng:state:akwa-ibom',
  'ng:state:an': 'ng:state:anambra',
  'ng:state:ba': 'ng:state:bauchi',
  'ng:state:be': 'ng:state:benue',
  'ng:state:bo': 'ng:state:borno',
  'ng:state:by': 'ng:state:bayelsa',
  'ng:state:cr': 'ng:state:cross-river',
  'ng:state:de': 'ng:state:delta',
  'ng:state:eb': 'ng:state:ebonyi',
  'ng:state:ed': 'ng:state:edo',
  'ng:state:ek': 'ng:state:ekiti',
  'ng:state:en': 'ng:state:enugu',
  'ng:state:fc': 'ng:fct:abuja',
  'ng:state:go': 'ng:state:gombe',
  'ng:state:im': 'ng:state:imo',
  'ng:state:ji': 'ng:state:jigawa',
  'ng:state:kd': 'ng:state:kaduna',
  'ng:state:ke': 'ng:state:kebbi',
  'ng:state:kn': 'ng:state:kano',
  'ng:state:ko': 'ng:state:kogi',
  'ng:state:kt': 'ng:state:katsina',
  'ng:state:kw': 'ng:state:kwara',
  'ng:state:la': 'ng:state:lagos',
  'ng:state:na': 'ng:state:nasarawa',
  'ng:state:ni': 'ng:state:niger',
  'ng:state:og': 'ng:state:ogun',
  'ng:state:on': 'ng:state:ondo',
  'ng:state:os': 'ng:state:osun',
  'ng:state:oy': 'ng:state:oyo',
  'ng:state:pl': 'ng:state:plateau',
  'ng:state:ri': 'ng:state:rivers',
  'ng:state:so': 'ng:state:sokoto',
  'ng:state:ta': 'ng:state:taraba',
  'ng:state:yo': 'ng:state:yobe',
  'ng:state:za': 'ng:state:zamfara'
};

async function updateProfiles() {
  const profilesPath = join(DATA_PATH, 'geography', 'regional-environment-profiles.json');
  const profiles = JSON.parse(await readFile(profilesPath, 'utf-8'));
  
  const newProfiles = {
    schema_version: 1,
    world_id: 'nigeria-main',
    notice: 'Regional environment profiles for Nigerian states.',
    profiles: {}
  };
  
  for (const [abbrevId, fullId] of Object.entries(idMapping)) {
    if (profiles.profiles[fullId]) {
      newProfiles.profiles[abbrevId] = profiles.profiles[fullId];
    }
  }
  
  await writeFile(profilesPath, JSON.stringify(newProfiles, null, 2));
  console.log(`Updated ${Object.keys(newProfiles.profiles).length} profiles`);
}

updateProfiles().catch(console.error);
