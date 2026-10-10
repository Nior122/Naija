# Advanced 3D World Architecture

**Stage 23 Implementation**  
**Date:** 2026-10-10  
**Status:** Foundation Established

---

## Overview

This document describes the 3D world architecture for Naija: One World, implemented as a **hybrid 2D/3D system** that preserves the existing 2D game while establishing a 3D foundation for future expansion.

**Design Philosophy:**
- Preserve all existing 2D functionality (447 tests, 22 stages of features)
- Establish 3D architecture without breaking existing systems
- Provide a clear migration path for gradual 3D adoption
- Maintain single authoritative Nigeria world across both modes
- Integrate with Stage 22 regional environment data

---

## Architecture

### Hybrid 2D/3D System

The game operates in two modes:

1. **2D Mode (Default):** The existing complete 2D life-simulation game
   - Fully functional with all 22 stages of features
   - Node2D-based scenes
   - Procedural placeholder graphics
   - All gameplay systems operational

2. **3D Mode (Prototype):** A new 3D environment demonstration
   - Representative Nigerian environment
   - Node3D-based scenes
   - 3D terrain, buildings, characters
   - Day/night cycle and regional configuration

**Switching:** Press **F3** to toggle between 2D and 3D modes. State is preserved across transitions.

### Scene Hierarchy

```
main.tscn (Scene Switcher)
├── Mode2D (Container)
│   └── prototype.tscn (2D Game)
│       └── prototype_game.gd
└── Mode3D (Container)
    └── world_3d.tscn (3D World)
        ├── Environment
        │   ├── DirectionalLight3D (Sun)
        │   └── WorldEnvironment (Sky, fog, ambient)
        ├── Terrain
        │   └── Ground (MeshInstance3D)
        ├── Buildings
        │   └── [Dynamic building instances]
        ├── Props
        │   └── [Environmental props]
        ├── Characters
        │   ├── PlayerCharacter (CharacterBody3D)
        │   │   ├── CollisionShape3D
        │   │   └── CameraMount
        │   │       └── Camera3D (Third-person camera)
        │   └── [NPC instances]
        └── TimeOfDay (Day/night cycle controller)
```

### Core Systems

#### 1. Scene Switcher (`scene_switcher.gd`)
- Manages 2D/3D mode transitions
- Preserves shared state across modes
- Handles input for mode switching (F3 key)
- Ensures clean loading/unloading of scenes

**Key Methods:**
- `switch_to_2d()` - Unload 3D, load 2D
- `switch_to_3d()` - Unload 2D, load 3D
- `_save_2d_state()` / `_restore_2d_state()` - State preservation
- `_save_3d_state()` / `_restore_3d_state()` - State preservation

#### 2. World 3D Controller (`world_3d_controller.gd`)
- Manages the 3D environment
- Loads regional buildings and props
- Integrates with Stage 22 regional data
- Tracks performance metrics

**Key Methods:**
- `_configure_environment()` - Apply regional settings
- `_load_regional_buildings()` - Spawn buildings for current region
- `change_region(new_region_id)` - Switch to different region
- `get_performance_stats()` - Return FPS, frame time, etc.

#### 3. Camera 3D Controller (`camera_3d_controller.gd`)
- Third-person camera with collision detection
- Smooth following of player character
- Mouse-look controls (right-click + drag)
- First-person mode toggle

**Features:**
- Collision detection (camera won't clip through walls)
- Adjustable pitch/yaw with limits
- Smooth interpolation for camera movement
- First-person/third-person toggle

#### 4. Character 3D (`character_3d.gd`)
- 3D character movement and physics
- Integration with existing character state
- Interaction system for buildings/objects
- Network state synchronization

**Movement:**
- WASD/Arrow keys for movement
- Shift to run
- Space to jump
- Physics-based movement with gravity

**Animation States:**
- Idle
- Walking
- Running
- Jumping

#### 5. Time of Day (`time_of_day.gd`)
- Day/night cycle system
- Dynamic lighting based on time
- Integration with existing WorldClock
- Four periods: dawn, day, dusk, night

**Features:**
- Adjustable time scale (1 real second = 60 game seconds)
- Sun rotation based on time
- Light color/intensity changes
- Ambient light adjustments

#### 6. Environment Config (`environment_config.gd`)
- Regional environment profiles
- Integration with Stage 22 data
- Dynamic visual settings per region
- Climate and terrain configuration

**Regional Profiles:**
- Lagos (coastal urban)
- Ondo (forest/suburban)
- Kaduna (savanna)
- Borno (arid)
- Plateau (montane)

---

## Integration with Existing Systems

### Stage 22 Geographic Integration

The 3D world connects to Stage 22's regional registry:

```gdscript
# Load environment profile from regional-catalog.json
var env_profile = _load_regional_environment_profile()

# Apply to 3D environment
environment_config.apply_profile(env_profile)
```

**Regional Data Used:**
- `climate` - Affects sky color, fog, lighting
- `terrain` - Affects ground texture, vegetation
- `building_density` - Affects building placement
- `vegetation_density` - Affects tree/prop spawning

### Character State Integration

The 3D character connects to the existing character state:

```gdscript
# Get character data from shared state
var character_data = shared_character_data

# Apply to 3D character
character_3d.set_character_state(character_data)
```

**Preserved Data:**
- Character ID
- Position (converted from 2D to 3D coordinates)
- Inventory
- Statistics (hunger, energy, health)
- Education/career state

### Multiplayer Integration

The 3D system is designed for multiplayer:

```gdscript
# Send character state to server
multiplayer_client.send_character_state(character_3d.get_character_state())

# Receive remote player states
for remote_state in remote_player_states:
    spawn_remote_player(remote_state)
```

**Network Protocol:**
- Position: Vector3 (x, y, z)
- Rotation: float (yaw)
- Velocity: Vector3
- Animation state: String
- Is running: bool
- Is jumping: bool

---

## Asset Pipeline

### Directory Structure

```
game/3d_world/
├── scenes/           # .tscn scene files
├── scripts/          # .gd scripts
├── assets/
│   ├── models/       # 3D models (.glb, .gltf, .obj)
│   ├── textures/     # Texture files (.png, .jpg)
│   ├── materials/    # Material resources (.tres)
│   └── animations/   # Animation files (.anim, .glb)
├── environments/     # Region-specific environment configs
├── buildings/        # Building prefabs
└── characters/       # Character models and animations
```

### Supported Formats

**Models:**
- **.glb / .gltf** (Preferred) - Godot 4 native support
- **.obj** - Basic mesh support
- **.fbx** - Requires import configuration

**Textures:**
- **.png** - Lossless, supports transparency
- **.jpg** - Lossy, no transparency
- **.webp** - Modern format, good compression

**Materials:**
- **.tres** - Godot resource files
- **.material** - Godot 4 material format

**Animations:**
- **.anim** - Godot animation format
- **.glb** - Embedded animations

### Asset Guidelines

**Scale:**
- 1 unit = 1 meter
- Character height: 1.8 units
- Door height: 2.1 units
- Ceiling height: 3.0 units

**Naming Conventions:**
- `building_house_residential.glb`
- `texture_wall_concrete.png`
- `material_building_default.tres`
- `animation_character_idle.anim`

**Optimization:**
- LOD levels: High (0-20m), Medium (20-50m), Low (50-100m)
- Texture resolution: 1024x1024 max for mobile
- Polygon count: <10k triangles per building
- Use instancing for repeated objects

---

## Performance

### Target Specifications

**Minimum Requirements:**
- CPU: Dual-core 2.0 GHz
- GPU: Integrated graphics (Intel HD 4000 or equivalent)
- RAM: 4 GB
- Storage: 500 MB for 3D assets

**Recommended Requirements:**
- CPU: Quad-core 2.5 GHz
- GPU: Dedicated GPU (GTX 1050 or equivalent)
- RAM: 8 GB
- Storage: 2 GB for 3D assets

### Optimization Strategies

1. **Level of Detail (LOD)**
   - High-poly models within 20m
   - Medium-poly models 20-50m
   - Low-poly models 50-100m
   - Billboard sprites beyond 100m

2. **Occlusion Culling**
   - Don't render objects behind buildings
   - Use Godot's built-in occlusion system

3. **Instancing**
   - Use MultiMeshInstance3D for repeated objects
   - Trees, props, fences use instancing

4. **Texture Atlasing**
   - Combine multiple textures into one
   - Reduce draw calls

5. **Asset Streaming**
   - Load assets on demand
   - Unload distant regions

### Performance Metrics

**Current Implementation:**
- FPS: 60 (target)
- Frame time: <16ms
- Draw calls: <100
- Triangles: <100k visible

---

## Regional Configuration

### Environment Profiles

Each Nigerian state has an environment profile:

```json
{
  "region_id": "ng:state:la",
  "climate": "tropical",
  "terrain": "coastal",
  "sky_color": [0.55, 0.75, 0.95],
  "fog_color": [0.75, 0.8, 0.85],
  "fog_density": 0.0015,
  "ambient_color": [0.65, 0.7, 0.8],
  "ambient_energy": 0.45,
  "building_density": "high",
  "vegetation": "sparse"
}
```

### Visual Variation

**Coastal (Lagos, Rivers, Delta):**
- Bright blue sky
- Higher humidity (more fog)
- Dense urban development
- Sparse vegetation

**Forest (Ondo, Cross River, Edo):**
- Green-tinted lighting
- Moderate fog
- Mixed building density
- Moderate vegetation

**Savanna (Kaduna, Kano, Katsina):**
- Bright, clear sky
- Low humidity (less fog)
- Medium building density
- Sparse vegetation

**Arid (Borno, Yobe, Sokoto):**
- Hazy, bright sky
- Very low humidity
- Low building density
- Very sparse vegetation

**Montane (Plateau):**
- Cooler lighting
- Higher fog (altitude)
- Low building density
- Dense vegetation

---

## Multiplayer Architecture

### Network Protocol

**Player State:**
```gdscript
{
  "character_id": "player_001",
  "position": Vector3(10, 0, 5),
  "rotation": 1.57,
  "velocity": Vector3(2, 0, 0),
  "animation_state": "walking",
  "is_running": false,
  "is_jumping": false
}
```

**Synchronization:**
- Client sends movement intent (not position)
- Server validates and broadcasts position
- Remote players interpolated for smoothness
- Animation state synchronized

### Region Management

**Region Loading:**
- Only load current region + adjacent regions
- Unload distant regions
- Preserve persistent state

**Player Distribution:**
- Server tracks player positions
- Clients only receive nearby players
- Region transitions coordinated by server

---

## Future Expansion

### Phase 2: Building Interiors
- Add interior scenes for buildings
- Seamless interior/exterior transitions
- Interior-specific gameplay

### Phase 3: Advanced NPCs
- Full NPC AI in 3D
- NPC schedules and routines
- NPC interactions

### Phase 4: Vehicles
- 3D vehicle models
- Driving physics
- Traffic system

### Phase 5: Weather System
- Rain, wind, storms
- Weather effects on gameplay
- Regional weather variation

### Phase 6: Full National Coverage
- All 37 states with 3D environments
- Region-specific architecture
- Cultural variation

---

## Testing

### Automated Tests

**Scene Integrity:**
- All scenes load without errors
- All assets resolve correctly
- No missing references

**Movement and Collision:**
- Character can move in all directions
- Collision prevents walking through walls
- Camera collision works correctly

**State Persistence:**
- Character state preserved across mode switches
- Position preserved across mode switches
- Inventory preserved across mode switches

**Performance:**
- FPS > 30 on minimum hardware
- Frame time < 33ms
- No memory leaks

### Manual Testing

**Visual Quality:**
- Lighting looks correct
- Materials render properly
- No visual artifacts

**Gameplay:**
- All interactions work
- UI is functional
- Sound effects play

**Multiplayer:**
- Remote players visible
- Movement synchronized
- No duplicate characters

---

## Known Limitations

1. **Placeholder Graphics:** All 3D assets are procedural placeholders
2. **Limited Regions:** Only 5 regional profiles implemented (of 37)
3. **No Interiors:** Building interiors not yet implemented
4. **Basic NPCs:** NPC system is placeholder only
5. **No Vehicles:** Vehicle system not yet implemented
6. **Simple Weather:** Weather system not yet implemented
7. **Performance:** Not yet optimized for mobile devices

---

## Migration Path

### For Developers

**Adding New Regions:**
1. Create environment profile in `environment_config.gd`
2. Add regional building prefabs
3. Configure vegetation/props
4. Test in 3D mode

**Adding New Buildings:**
1. Create 3D model (Blender, etc.)
2. Export as .glb
3. Import into `assets/models/`
4. Create prefab in `buildings/`
5. Add to regional building list

**Adding New Characters:**
1. Create character model
2. Rig for animation
3. Create animations (idle, walk, run)
4. Import into `assets/characters/`
5. Configure in character system

### For Players

**Current State:**
- 2D mode is fully functional and complete
- 3D mode is a prototype/demonstration
- Both modes can be used interchangeably

**Future State:**
- Gradual migration of features to 3D
- Eventually 3D will become the primary mode
- 2D mode will remain available as "classic mode"

---

## Conclusion

Stage 23 establishes a solid 3D foundation for Naija: One World while preserving the complete, functional 2D game. The hybrid approach allows:

- **Safe experimentation** with 3D without breaking existing features
- **Gradual migration** to 3D over future stages
- **Player choice** between 2D and 3D modes
- **Clear architecture** for future expansion

The 3D system is fully integrated with Stage 22's regional data and ready for expansion in Stages 24+.

---

**Document Version:** 1.0  
**Last Updated:** 2026-10-10  
**Author:** Arena AI Agent  
**Status:** Complete
