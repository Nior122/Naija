# Outstanding Features Register

**Project:** Naija: One World  
**Last Updated:** 2026-10-10  
**Maintained By:** Development Team

---

## Purpose

This document tracks all features that are incomplete, partially implemented, or planned for future stages. Each entry includes current status, dependencies, proposed implementation stage, verification method, and blocking relationships.

**Rules:**
- Do not mark items complete until they are fully functional and tested
- Update status as work progresses
- Link to relevant documentation and code
- Track blocking dependencies explicitly

---

## Feature Categories

### 1. Visual Quality and 3D Content

#### 1.1 Production-Quality 3D Assets
**Status:** ❌ NOT STARTED  
**Current State:** Placeholder geometry (boxes, capsules, planes)  
**Target State:** Realistic Nigerian architecture, characters, vehicles, props  
**Dependencies:**
- Asset pipeline documentation (✅ Complete - `docs/3D_ASSET_PIPELINE.md`)
- 3D modeling software and skills
- Licensing clearance for any third-party assets
- Performance budget definition

**Proposed Stage:** Stage 25+ (content production stage)  
**Verification Method:**
- Visual inspection in Godot editor
- Frame rate testing with full assets
- Memory usage profiling

**Blocks:** None (gameplay works with placeholders)  
**Blocked By:** None

**Notes:**
- This is a content production task, not a code task
- Should be done incrementally as assets become available
- Do not block other work on this

---

#### 1.2 Enterable Buildings and Interiors
**Status:** ❌ NOT STARTED  
**Current State:** Buildings are exterior-only boxes with no interaction  
**Target State:** Players can enter buildings, see interiors, interact with objects  
**Dependencies:**
- Interior scene architecture (not designed)
- Seamless transition system (not implemented)
- Interior asset library (not created)
- State persistence across interior/exterior (not tested)

**Proposed Stage:** Stage 25+  
**Verification Method:**
- Player can walk through door
- Interior scene loads
- Player can exit back to exterior
- Position is preserved
- State is preserved

**Blocks:** None  
**Blocked By:** None

**Notes:**
- Requires new scene architecture for interiors
- Need to define which buildings have interiors
- Must preserve player state during transitions

---

#### 1.3 Complete Visual Profiles for All 37 Regions
**Status:** ⚠️ PARTIALLY COMPLETE (5/37)  
**Current State:** 5 regions have environment profiles (Lagos, Ondo, Kaduna, Borno, Plateau)  
**Target State:** All 36 states + FCT have environment profiles  
**Dependencies:**
- Regional environment data from Stage 22 (✅ Complete)
- Environment configuration system (✅ Complete)
- Asset variation per region (❌ Not started - all use same placeholder assets)

**Proposed Stage:** Stage 25+ (can be done incrementally)  
**Verification Method:**
- Each region loads with correct environment settings
- Sky color, fog, lighting match profile
- Building density varies per region
- Vegetation varies per region

**Blocks:** None  
**Blocked By:** None

**Notes:**
- Can be done incrementally (add 5-10 regions per stage)
- Code infrastructure exists, just need data
- Asset variation requires actual 3D assets first

---

### 2. NPC and Population Systems

#### 2.1 NPC AI and Daily Routines
**Status:** ❌ NOT STARTED  
**Current State:** No NPC spawning in 3D mode. 2D mode has NPC system from Stage 20.  
**Target State:** NPCs populate 3D world, follow schedules, interact with environment  
**Dependencies:**
- NPC system from Stage 20 (✅ Complete in 2D)
- 3D NPC controller (not created)
- Navigation system for 3D (not implemented)
- NPC spawning system for 3D (not implemented)
- Schedule integration with 3D time system (not connected)

**Proposed Stage:** Stage 25+  
**Verification Method:**
- NPCs spawn in 3D world
- NPCs follow daily schedules
- NPCs navigate around obstacles
- NPCs interact with environment
- Performance acceptable with 50+ NPCs

**Blocks:** None  
**Blocked By:** None

**Notes:**
- 2D NPC system exists but is not connected to 3D
- Need to port/adapt NPC system for 3D
- Performance optimization critical for many NPCs

---

#### 2.2 Population Density and Distribution
**Status:** ❌ NOT STARTED  
**Current State:** No population system  
**Target State:** Realistic population distribution across regions  
**Dependencies:**
- Regional population data (available from Stage 22)
- NPC spawning system (❌ Not started)
- Performance optimization (❌ Not started)

**Proposed Stage:** Stage 25+  
**Verification Method:**
- Population density varies by region
- Urban areas have more NPCs
- Rural areas have fewer NPCs
- Performance acceptable

**Blocks:** None  
**Blocked By:** None

---

### 3. Vehicles and Transportation

#### 3.1 Vehicles and Traffic
**Status:** ❌ NOT STARTED  
**Current State:** No vehicle system  
**Target State:** Players can drive vehicles, NPCs drive, traffic flows  
**Dependencies:**
- Vehicle models (❌ Not created)
- Vehicle physics (❌ Not implemented)
- Road network (❌ Not implemented in 3D)
- Traffic AI (❌ Not implemented)
- Integration with transportation system from Stage 19 (2D only)

**Proposed Stage:** Stage 26+  
**Verification Method:**
- Player can enter/exit vehicle
- Vehicle drives with physics
- Traffic flows on roads
- Performance acceptable

**Blocks:** None  
**Blocked By:** None

**Notes:**
- Transportation system exists in 2D (Stage 19)
- Need to port to 3D with vehicle physics
- Complex task, should be separate stage

---

### 4. Environmental Effects

#### 4.1 Weather and Environmental Effects
**Status:** ⚠️ PARTIALLY COMPLETE (day/night only)  
**Current State:** Day/night cycle implemented. No rain, wind, storms, fog variations.  
**Target State:** Dynamic weather system with rain, storms, wind, fog  
**Dependencies:**
- Weather data system (not designed)
- Particle effects for rain/snow (not created)
- Sound effects for weather (not created)
- Gameplay effects of weather (not designed)

**Proposed Stage:** Stage 25+  
**Verification Method:**
- Weather changes over time
- Rain/storm effects visible
- Sound effects play
- Gameplay affected (e.g., reduced visibility)

**Blocks:** None  
**Blocked By:** None

**Notes:**
- Day/night cycle exists (time_of_day.gd)
- Weather is extension of this system
- Can be done incrementally

---

### 5. Multiplayer and Synchronization

#### 5.2 Multiplayer Testing and Synchronization in 3D
**Status:** ❌ NOT STARTED  
**Current State:** 3D character has network methods but no multiplayer client integration  
**Target State:** Multiple players can interact in 3D world, state synchronized  
**Dependencies:**
- Multiplayer client in 3D scene (❌ Not implemented)
- Remote player spawning in 3D (❌ Not implemented)
- Network state synchronization loop (❌ Not implemented)
- Server-side validation for 3D movement (❌ Not implemented)
- Integration with existing multiplayer system (❌ Not connected)

**Proposed Stage:** **Stage 24** (current focus)  
**Verification Method:**
- 2+ players can connect in 3D mode
- Players see each other
- Movement synchronized
- Position validated by server
- No duplicate characters
- State persists across disconnects

**Blocks:** None  
**Blocked By:**
- Scene switcher integration (❌ Must fix first)
- State preservation across modes (❌ Must fix first)

**Notes:**
- **CRITICAL FOR STAGE 24**
- Multiplayer system exists in 2D (Stage 2)
- Must port to 3D and test
- This is the main focus of Stage 24

---

#### 5.3 Cross-Mode State Persistence
**Status:** ❌ NOT IMPLEMENTED  
**Current State:** Scene switcher has framework but methods don't exist  
**Target State:** Character state, inventory, money, position persist when switching 2D ↔ 3D  
**Dependencies:**
- `get_shared_state()` in 2D scene (❌ Not implemented)
- `set_shared_state()` in 2D scene (❌ Not implemented)
- `get_shared_state()` in 3D scene (❌ Not implemented)
- `set_shared_state()` in 3D scene (❌ Not implemented)
- Testing of state preservation (❌ Not tested)

**Proposed Stage:** **Stage 24** (current focus)  
**Verification Method:**
- Switch from 2D to 3D, character data preserved
- Switch from 3D to 2D, character data preserved
- Inventory preserved
- Money preserved
- Position preserved (or reset to safe location)
- No crashes

**Blocks:**
- Multiplayer in 3D (must be able to switch modes first)

**Blocked By:** None

**Notes:**
- **CRITICAL FOR STAGE 24**
- Framework exists but methods not implemented
- Must fix before multiplayer testing

---

### 6. Performance Optimization

#### 6.1 Performance Optimization for Both Visual Modes
**Status:** ❌ NOT STARTED  
**Current State:** No optimization implemented  
**Target State:** 60 FPS on target hardware, efficient memory usage  
**Dependencies:**
- Performance profiling tools (not configured)
- LOD system (not implemented)
- Occlusion culling (not implemented)
- Asset streaming (not implemented)
- Optimization of NPC rendering (❌ Blocked by NPC system)

**Proposed Stage:** Stage 26+  
**Verification Method:**
- Frame rate > 60 FPS on target hardware
- Memory usage < 2 GB
- Load time < 5 seconds
- No frame drops during gameplay

**Blocks:** None  
**Blocked By:** None

**Notes:**
- Can be done incrementally
- Profile first, then optimize
- Don't optimize prematurely

---

## Summary Table

| # | Feature | Status | Stage | Priority | Blocks |
|---|---------|--------|-------|----------|--------|
| 1.1 | Production 3D assets | ❌ Not started | 25+ | Low | None |
| 1.2 | Building interiors | ❌ Not started | 25+ | Low | None |
| 1.3 | All 37 regional profiles | ⚠️ 5/37 | 25+ | Low | None |
| 2.1 | NPC AI and routines | ❌ Not started | 25+ | Medium | None |
| 2.2 | Population distribution | ❌ Not started | 25+ | Low | None |
| 3.1 | Vehicles and traffic | ❌ Not started | 26+ | Low | None |
| 4.1 | Weather effects | ⚠️ Partial | 25+ | Low | None |
| **5.2** | **Multiplayer in 3D** | **❌ Not started** | **24** | **High** | **None** |
| **5.3** | **Cross-mode persistence** | **❌ Not implemented** | **24** | **High** | **5.2** |
| 6.1 | Performance optimization | ❌ Not started | 26+ | Medium | None |

**Bold items are Stage 24 priorities.**

---

## Update Log

| Date | Feature | Change | By |
|------|---------|--------|-----|
| 2026-10-10 | All | Initial register created | Arena AI Agent |
| 2026-10-10 | 5.2, 5.3 | Marked as Stage 24 priorities | Arena AI Agent |

---

## How to Use This Document

### Adding a New Feature
1. Choose appropriate category
2. Fill in all fields
3. Assign to proposed stage
4. Update summary table
5. Add to update log

### Updating Status
1. Change status emoji and text
2. Update current state
3. Add to update log with date and change description

### Marking Complete
1. Change status to ✅ COMPLETE
2. Update current state to final implementation
3. Add verification results
4. Add to update log
5. Move to archive (future)

### Checking Dependencies
1. Look at "Dependencies" field
2. Check status of each dependency
3. If dependency is ❌ or ⚠️, this feature may be blocked

### Planning Work
1. Sort by stage number
2. Prioritize by "Blocks" column (features that block others first)
3. Consider dependencies
4. Plan incrementally

---

**Document Maintainer:** Development Team  
**Review Frequency:** End of each stage  
**Next Review:** After Stage 24 completion
