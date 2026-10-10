# Stage 24 — Multiplayer Integration and One-World Scaling Test Plan

**Date:** 2026-10-10  
**Stage:** 24  
**Focus:** Multiplayer in 3D mode, cross-mode state persistence, one-world integration

---

## Overview

Stage 24 focuses on verifying that the 2D and 3D modes share the same authoritative world state, character progression, and multiplayer infrastructure. This test plan documents what must be verified and how.

---

## Test Environment Requirements

- Godot 4.7.2 installed
- Two or more client instances (for multiplayer testing)
- Backend server running (Node.js world-api)
- Network connectivity between clients

---

## Test Suite 1: Scene Switching and State Preservation

### Test 1.1: Mode Switching
**Objective:** Verify player can switch between 2D and 3D modes  
**Steps:**
1. Launch game (should start in 2D mode)
2. Press F3 key
3. Verify game switches to 3D mode
4. Press F3 again
5. Verify game switches back to 2D mode

**Expected Result:** Mode switches cleanly without crashes  
**Status:** [ ] PASS [ ] FAIL

---

### Test 1.2: Character State Preservation (2D → 3D)
**Objective:** Verify character data persists when switching from 2D to 3D  
**Setup:**
- Create a character in 2D mode
- Set money to 5000 Naira
- Add items to inventory
- Set position to a specific location
- Note character stats (hunger, energy, health)

**Steps:**
1. Note all character state values
2. Press F3 to switch to 3D mode
3. Verify character in 3D has same:
   - Money (5000 Naira)
   - Inventory items
   - Stats (hunger, energy, health)
   - Location (or reasonable default)

**Expected Result:** All state preserved  
**Status:** [ ] PASS [ ] FAIL

---

### Test 1.3: Character State Preservation (3D → 2D)
**Objective:** Verify character data persists when switching from 3D to 2D  
**Setup:**
- Switch to 3D mode
- Move character to new position
- Interact with environment (if interactions implemented)

**Steps:**
1. Note position and state in 3D
2. Press F3 to switch to 2D mode
3. Verify character in 2D has:
   - Same money
   - Same inventory
   - Same stats
   - Position restored (or safe default)

**Expected Result:** All state preserved  
**Status:** [ ] PASS [ ] FAIL

---

### Test 1.4: World Clock Synchronization
**Objective:** Verify time persists across mode switches  
**Steps:**
1. Note current time in 2D mode (e.g., 10:30 AM)
2. Switch to 3D mode
3. Verify time in 3D is same (10:30 AM)
4. Wait for time to advance (e.g., to 11:00 AM)
5. Switch back to 2D
6. Verify time in 2D is 11:00 AM

**Expected Result:** Time synchronized and advancing  
**Status:** [ ] PASS [ ] FAIL

---

## Test Suite 2: Multiplayer in 3D Mode

### Test 2.1: Multiplayer Connection in 3D
**Objective:** Verify player can connect to multiplayer server in 3D mode  
**Setup:**
- Start backend server
- Launch two game clients

**Steps:**
1. Client 1: Create character in 2D mode
2. Client 1: Switch to 3D mode
3. Client 1: Connect to multiplayer (if not auto-connected)
4. Client 2: Create character in 2D mode
5. Client 2: Switch to 3D mode
6. Client 2: Connect to multiplayer

**Expected Result:** Both clients connect successfully  
**Status:** [ ] PASS [ ] FAIL

---

### Test 2.2: Remote Player Visibility
**Objective:** Verify players see each other in 3D mode  
**Steps:**
1. Both clients in 3D mode and connected
2. Client 1: Look around
3. Verify Client 2's character is visible
4. Client 2: Look around
5. Verify Client 1's character is visible

**Expected Result:** Both players see each other  
**Status:** [ ] PASS [ ] FAIL

---

### Test 2.3: Position Synchronization
**Objective:** Verify player movements are synchronized  
**Steps:**
1. Both clients in 3D mode
2. Client 1: Move character
3. Client 2: Verify Client 1's character moves
4. Client 2: Move character
5. Client 1: Verify Client 2's character moves

**Expected Result:** Movements synchronized with minimal lag  
**Status:** [ ] PASS [ ] FAIL

---

### Test 2.4: No Duplicate Characters
**Objective:** Verify switching modes doesn't create duplicate characters  
**Steps:**
1. Client 1: Switch to 3D mode
2. Client 2: Verify only one Client 1 character visible
3. Client 1: Switch back to 2D mode
4. Client 1: Switch to 3D mode again
5. Client 2: Verify still only one Client 1 character

**Expected Result:** No duplicate characters  
**Status:** [ ] PASS [ ] FAIL

---

### Test 2.5: State Persistence Across Disconnect
**Objective:** Verify character state persists after disconnect/reconnect  
**Steps:**
1. Client 1: Note character state (money, inventory, position)
2. Client 1: Disconnect from multiplayer
3. Client 1: Reconnect to multiplayer
4. Verify character state is same

**Expected Result:** State preserved across disconnect  
**Status:** [ ] PASS [ ] FAIL

---

## Test Suite 3: One-World Integration

### Test 3.1: Shared Economy
**Objective:** Verify economy is shared between modes  
**Steps:**
1. Client 1: Note money in 2D (e.g., 5000 Naira)
2. Client 1: Switch to 3D
3. Verify money in 3D is 5000 Naira
4. Client 1: Simulate earning money (if possible)
5. Switch back to 2D
6. Verify money reflects earnings

**Expected Result:** Single authoritative economy  
**Status:** [ ] PASS [ ] FAIL

---

### Test 3.2: Shared Inventory
**Objective:** Verify inventory is shared between modes  
**Steps:**
1. Client 1: Note inventory in 2D
2. Switch to 3D
3. Verify same inventory
4. Add item (if possible)
5. Switch back to 2D
6. Verify item present

**Expected Result:** Single authoritative inventory  
**Status:** [ ] PASS [ ] FAIL

---

### Test 3.3: Shared World Events
**Objective:** Verify world events affect both modes  
**Setup:**
- Trigger a world event (e.g., weather change, NPC announcement)

**Steps:**
1. Client 1: Observe event in 2D
2. Switch to 3D
3. Verify event still active/visible
4. Switch back to 2D
5. Verify event consequences persist

**Expected Result:** Events shared across modes  
**Status:** [ ] PASS [ ] FAIL

---

### Test 3.4: Server Authority
**Objective:** Verify server validates all state changes  
**Steps:**
1. Client 1: Try to modify money directly (if possible)
2. Verify server rejects unauthorized changes
3. Client 1: Perform legitimate action (e.g., buy item)
4. Verify server validates and updates state

**Expected Result:** Server maintains authority  
**Status:** [ ] PASS [ ] FAIL

---

## Test Suite 4: Performance and Stability

### Test 4.1: Mode Switch Performance
**Objective:** Verify mode switches complete in reasonable time  
**Steps:**
1. Switch from 2D to 3D
2. Measure time (should be < 2 seconds)
3. Switch back to 2D
4. Measure time (should be < 2 seconds)

**Expected Result:** Fast mode switches  
**Status:** [ ] PASS [ ] FAIL

---

### Test 4.2: Memory Stability
**Objective:** Verify no memory leaks during mode switching  
**Steps:**
1. Monitor memory usage
2. Switch modes 10 times
3. Monitor memory usage
4. Verify no significant increase

**Expected Result:** Stable memory usage  
**Status:** [ ] PASS [ ] FAIL

---

### Test 4.3: Multiplayer Performance
**Objective:** Verify acceptable performance with multiple players  
**Setup:**
- 4 clients connected in 3D mode

**Steps:**
1. All clients move simultaneously
2. Measure frame rate (should be > 30 FPS)
3. Verify smooth movement
4. Verify no lag spikes

**Expected Result:** Acceptable performance  
**Status:** [ ] PASS [ ] FAIL

---

## Test Execution Checklist

### Pre-Test Setup
- [ ] Godot 4.7.2 installed and working
- [ ] Backend server running
- [ ] Test accounts created
- [ ] Network connectivity verified

### Test Execution
- [ ] Test Suite 1: Scene Switching (4 tests)
- [ ] Test Suite 2: Multiplayer in 3D (5 tests)
- [ ] Test Suite 3: One-World Integration (4 tests)
- [ ] Test Suite 4: Performance (3 tests)

### Post-Test
- [ ] All results documented
- [ ] Failures investigated
- [ ] Bug reports created for failures
- [ ] Test plan updated with lessons learned

---

## Automated Test Scripts

### Script 1: State Preservation Test
```gdscript
# test_state_preservation.gd
extends Node

func test_state_preservation():
    var scene_switcher = $SceneSwitcher
    
    # Get initial state
    var initial_state = scene_switcher.get_shared_state()
    
    # Switch modes
    scene_switcher.switch_to_3d()
    await get_tree().create_timer(1.0).timeout
    
    # Verify state
    var state_3d = scene_switcher.get_shared_state()
    assert(initial_state.character.money == state_3d.character.money, "Money not preserved")
    
    # Switch back
    scene_switcher.switch_to_2d()
    await get_tree().create_timer(1.0).timeout
    
    # Verify state again
    var state_2d = scene_switcher.get_shared_state()
    assert(initial_state.character.money == state_2d.character.money, "Money not preserved after round trip")
    
    print("State preservation test PASSED")
```

### Script 2: Multiplayer Integration Test
```gdscript
# test_multiplayer_3d.gd
extends Node

func test_multiplayer_3d():
    var multiplayer_manager = $World3D/Multiplayer3DManager
    
    # Wait for connection
    await multiplayer_manager.session_ready
    
    # Verify remote players
    var remote_count = multiplayer_manager.get_remote_player_count()
    assert(remote_count > 0, "No remote players detected")
    
    print("Multiplayer integration test PASSED")
```

---

## Known Limitations

1. **Godot Testing:** Godot tests require the engine to be running, cannot be fully automated in CI
2. **Multiplayer Testing:** Requires multiple clients and server, difficult to automate
3. **Visual Verification:** Some tests require visual inspection (remote player visibility)
4. **Performance Testing:** Requires specific hardware, results may vary

---

## Success Criteria

Stage 24 is successful if:
- ✅ All Test Suite 1 tests pass (scene switching works)
- ✅ All Test Suite 2 tests pass (multiplayer works in 3D)
- ✅ All Test Suite 3 tests pass (one-world integration verified)
- ✅ Test Suite 4 tests pass or have acceptable results
- ✅ No critical bugs introduced
- ✅ Existing 2D gameplay still works

---

## Documentation Requirements

After testing, update:
- `OUTSTANDING_FEATURES_REGISTER.md` - Mark completed features
- `STAGE_24_COMPLETION_REPORT.md` - Document results
- `STAGE_24_TEST_RESULTS.md` - Detailed test results

---

**Test Plan Created:** 2026-10-10  
**Test Plan Version:** 1.0  
**Next Step:** Execute tests when Godot is available
