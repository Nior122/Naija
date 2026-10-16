# 3D Asset Pipeline Guide

**Stage 23 Implementation**  
**Date:** 2026-10-10  

---

## Overview

This guide explains how to add 3D assets to Naija: One World. All assets should follow these guidelines to ensure consistency, performance, and proper licensing.

---

## Asset Sources and Licensing

### Preferred Sources

1. **Original Assets (Best)**
   - Create your own models in Blender, Maya, etc.
   - Full control over licensing
   - Can be tailored to game's needs

2. **CC0 / Public Domain**
   - No attribution required
   - Free for commercial use
   - Examples: Poly Haven, AmbientCG

3. **CC-BY (Attribution Required)**
   - Must credit the original author
   - Free for commercial use
   - Examples: Sketchfab (filtered), OpenGameArt

4. **CC-BY-SA (Share Alike)**
   - Must credit author
   - Derivatives must use same license
   - Use with caution

### Prohibited Sources

- **CC-BY-NC** (Non-Commercial) - Game may be sold
- **CC-BY-ND** (No Derivatives) - Must modify assets
- **All Rights Reserved** - No permission
- **Pirated assets** - Legal liability

### Attribution Requirements

For CC-BY assets, include attribution in:
1. `docs/ASSET_SOURCES.md` - List all third-party assets
2. In-game credits (if applicable)
3. README or asset documentation

**Example Attribution:**
```
Model: "Nigerian House" by ArtistName
License: CC-BY 4.0
Source: https://sketchfab.com/...
Modified: Yes (optimized for game)
```

---

## Asset Creation Guidelines

### 3D Models

**Software:**
- **Blender** (Recommended, free, open-source)
- Maya (Professional, paid)
- 3ds Max (Professional, paid)

**Export Format:**
- **glTF 2.0 (.glb)** - Preferred
  - Single file with embedded textures
  - Godot native support
  - Good compression
  
- **glTF (.gltf + .bin + textures)** - Alternative
  - Separate files
  - Easier to edit textures
  
- **FBX (.fbx)** - Legacy
  - Requires import configuration
  - Larger file sizes

**Scale:**
- **1 unit = 1 meter**
- Character height: 1.8 units
- Door height: 2.1 units
- Ceiling height: 3.0 units
- Story height: 3.0 units

**Polygon Count:**
- **Small props:** <1,000 triangles
- **Buildings:** <10,000 triangles
- **Characters:** <5,000 triangles
- **Vehicles:** <8,000 triangles

**LOD Levels:**
```
High: 0-20m (full detail)
Medium: 20-50m (50% polygons)
Low: 50-100m (25% polygons)
Billboard: 100m+ (single quad)
```

### Textures

**Format:**
- **PNG** - Lossless, supports transparency
- **JPG** - Lossy, no transparency
- **WebP** - Modern, good compression

**Resolution:**
- **Mobile:** 512x512 or 1024x1024
- **PC:** 1024x1024 or 2048x2048
- **Hero assets:** 4096x4096 max

**Texture Types:**
- **Albedo/Diffuse** - Base color (required)
- **Normal Map** - Surface detail (optional)
- **Roughness** - Surface shininess (optional)
- **Metallic** - Metal mask (optional)
- **Emission** - Glow (optional)
- **AO** - Ambient occlusion (optional)

**PBR Workflow:**
- Use metallic/roughness workflow (Godot default)
- Keep textures in sRGB color space
- Normal maps in linear space

### Materials

**Godot Materials:**
- Use `StandardMaterial3D` for most objects
- Use `ShaderMaterial` for special effects

**Material Settings:**
```
Albedo: Base color or texture
Metallic: 0.0 (non-metal) or 1.0 (metal)
Roughness: 0.0 (shiny) to 1.0 (matte)
Emission: Glow color/intensity
Normal: Surface detail
AO: Ambient occlusion
```

**Optimization:**
- Share materials between similar objects
- Use texture atlases for small objects
- Avoid transparent materials when possible

### Animations

**Format:**
- **glTF embedded** - Preferred
- **Godot .anim** - Alternative

**Animation Types:**
- **Idle** - Standing still
- **Walk** - Walking cycle
- **Run** - Running cycle
- **Jump** - Jump animation
- **Interact** - Object interaction

**Animation Guidelines:**
- Use root motion for movement
- Loop walk/run cycles
- Keep animations <2 seconds
- Use FK for characters, IK for vehicles

---

## Import Process

### Step 1: Prepare Asset

1. **Model:**
   - Set scale to 1 unit = 1 meter
   - Apply transforms (Ctrl+A in Blender)
   - Remove unused materials
   - Optimize polygon count

2. **Textures:**
   - Resize to target resolution
   - Convert to PNG or JPG
   - Name consistently (albedo, normal, etc.)

3. **Animations:**
   - Bake animations
   - Remove unused animation channels
   - Set loop settings

### Step 2: Export

**Blender Export (glTF):**
```
File > Export > glTF 2.0 (.glb)

Settings:
- Format: glTF Binary (.glb)
- Include: Meshes, Armatures, Animation
- Compression: None (or Draco if supported)
```

### Step 3: Import to Godot

1. **Copy Files:**
   ```
   game/3d_world/assets/models/building_house.glb
   game/3d_world/assets/textures/wall_concrete.png
   ```

2. **Godot Import:**
   - Godot auto-imports .glb files
   - Check Import dock for settings
   - Set up materials if needed

3. **Material Setup:**
   - Open model in Godot
   - Assign materials
   - Configure PBR settings
   - Save as .tres if reusing

### Step 4: Create Prefab

1. **Create Scene:**
   - Create new scene (Node3D root)
   - Add MeshInstance3D
   - Assign mesh and material

2. **Add Collision:**
   - Add StaticBody3D
   - Add CollisionShape3D
   - Match collision to mesh

3. **Add Interaction:**
   - Add Area3D for interaction
   - Add script for interaction logic

4. **Save Prefab:**
   ```
   game/3d_world/buildings/house_residential.tscn
   ```

---

## Directory Structure

```
game/3d_world/assets/
├── models/
│   ├── buildings/
│   │   ├── house_residential.glb
│   │   ├── shop_small.glb
│   │   └── school_primary.glb
│   ├── characters/
│   │   ├── character_player.glb
│   │   └── npc_villager.glb
│   ├── props/
│   │   ├── tree_oak.glb
│   │   ├── bench_wooden.glb
│   │   └── streetlamp.glb
│   └── vehicles/
│       ├── car_sedan.glb
│       └── bus_public.glb
├── textures/
│   ├── buildings/
│   │   ├── wall_concrete.png
│   │   ├── roof_metal.png
│   │   └── window_glass.png
│   ├── characters/
│   │   ├── skin_tone_01.png
│   │   └── clothing_shirt.png
│   └── environment/
│       ├── ground_grass.png
│       ├── road_asphalt.png
│       └── tree_bark.png
├── materials/
│   ├── building_default.tres
│   ├── character_default.tres
│   └── prop_default.tres
└── animations/
    ├── character_idle.anim
    ├── character_walk.anim
    └── character_run.anim
```

---

## Naming Conventions

### Files

**Models:**
```
[type]_[description].glb

Examples:
building_house_residential.glb
character_player_male.glb
prop_tree_oak.glb
vehicle_car_sedan.glb
```

**Textures:**
```
[type]_[description].png

Examples:
albedo_wall_concrete.png
normal_wall_concrete.png
roughness_wall_concrete.png
```

**Materials:**
```
material_[description].tres

Examples:
material_building_default.tres
material_character_skin.tres
```

### Nodes

**In Scenes:**
```
[Type][Description]

Examples:
MeshInstance3D -> HouseMesh
StaticBody3D -> HouseCollision
Area3D -> HouseInteraction
```

---

## Optimization

### Model Optimization

**Reduce Polygons:**
- Use decimation for distant objects
- Remove hidden faces
- Merge overlapping vertices
- Use LOD system

**Texture Optimization:**
- Use texture atlases
- Compress textures (VRAM compression)
- Mipmaps for distant objects
- Reuse textures where possible

**Material Optimization:**
- Share materials between objects
- Use instancing for repeated objects
- Avoid transparent materials
- Minimize draw calls

### Performance Targets

**Frame Rate:**
- PC: 60 FPS
- Mobile: 30 FPS
- Low-end: 30 FPS

**Draw Calls:**
- Target: <100 per frame
- Maximum: 200 per frame

**Triangle Count:**
- Visible: <100k triangles
- Total scene: <500k triangles

**Memory:**
- Textures: <512 MB VRAM
- Models: <256 MB RAM
- Total: <1 GB

---

## Validation

### Automated Checks

**Asset Validation Script:**
```gdscript
# Validate all assets in project
func validate_assets():
    var errors = []
    
    # Check for missing textures
    for material in all_materials:
        if not material.albedo_texture:
            errors.append("Missing albedo texture: " + material.name)
    
    # Check for oversized textures
    for texture in all_textures:
        if texture.get_width() > 4096:
            errors.append("Texture too large: " + texture.resource_path)
    
    # Check for unoptimized models
    for mesh in all_meshes:
        if mesh.get_surface_count() > 10:
            errors.append("Too many surfaces: " + mesh.resource_path)
    
    return errors
```

### Manual Checks

**Visual Quality:**
- [ ] Textures look correct
- [ ] Materials render properly
- [ ] No visual artifacts
- [ ] Lighting looks natural

**Functionality:**
- [ ] Collision works correctly
- [ ] Interactions work
- [ ] Animations play correctly
- [ ] LOD switches correctly

**Performance:**
- [ ] Frame rate is acceptable
- [ ] No frame rate spikes
- [ ] Memory usage is reasonable
- [ ] Loading time is acceptable

---

## Best Practices

### Do's

✅ **Use consistent scale** (1 unit = 1 meter)  
✅ **Optimize for target platform** (mobile vs PC)  
✅ **Use PBR materials** for realistic look  
✅ **Instance repeated objects** (trees, props)  
✅ **Use LOD** for distant objects  
✅ **Test on target hardware** regularly  
✅ **Document asset sources** and licenses  
✅ **Version control** large assets carefully  

### Don'ts

❌ **Don't use unlicensed assets**  
❌ **Don't exceed polygon budgets**  
❌ **Don't use 4K textures for small objects**  
❌ **Don't ignore mobile performance**  
❌ **Don't hardcode asset paths**  
❌ **Don't skip collision testing**  
❌ **Don't forget to optimize**  
❌ **Don't commit large binaries without LFS**  

---

## Troubleshooting

### Common Issues

**Issue: Model appears black**
- **Cause:** Missing or incorrect material
- **Fix:** Assign material with albedo color/texture

**Issue: Model is huge/tiny**
- **Cause:** Incorrect scale
- **Fix:** Set scale in 3D software, re-export

**Issue: Textures look blurry**
- **Cause:** Mipmaps or compression
- **Fix:** Adjust import settings, use higher resolution

**Issue: Collision doesn't match mesh**
- **Cause:** Collision shape misaligned
- **Fix:** Adjust collision shape, use convex decomposition

**Issue: Animations don't play**
- **Cause:** Animation not imported correctly
- **Fix:** Check import settings, re-import

**Issue: Performance is poor**
- **Cause:** Too many polygons/textures
- **Fix:** Optimize models, reduce texture size, use LOD

---

## Tools and Resources

### 3D Modeling

- **Blender** - Free, open-source, powerful
- **MagicaVoxel** - Free, voxel-based
- **Blockbench** - Free, low-poly models

### Texture Creation

- **GIMP** - Free, open-source image editor
- **Krita** - Free, digital painting
- **Substance Painter** - Professional, paid

### Asset Sources

- **Poly Haven** - CC0 assets
- **AmbientCG** - CC0 textures
- **Sketchfab** - CC-licensed models
- **OpenGameArt** - Game assets

### Godot Resources

- **Godot Documentation** - Official docs
- **Godot Asset Library** - Free assets
- **Godot Shaders** - Shader library

---

## Conclusion

Following this guide ensures that all 3D assets are:
- **Legally licensed** - No copyright issues
- **Optimized** - Good performance
- **Consistent** - Unified look and feel
- **Maintainable** - Easy to update and extend

For questions or clarifications, consult the development team or refer to the main architecture documentation.

---

**Document Version:** 1.0  
**Last Updated:** 2026-10-10  
**Author:** Arena AI Agent
