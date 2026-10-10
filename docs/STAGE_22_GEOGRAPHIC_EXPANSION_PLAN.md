# Stage 22 — Full Nigeria Geographic Expansion and Regional World Integration

## Overview

Stage 22 expands the geographic system from a single bounded region (Akure South) to support all 36 Nigerian states plus the Federal Capital Territory (FCT) as a unified, navigable world. This stage establishes the foundation for regional gameplay, travel between states, and location-aware systems across the entire country.

## Current State (Post-Stage 21)

The geography system currently supports:
- A single detailed region: Akure South LGA, Ondo State
- Coordinate system with WGS84 ↔ game position conversion
- Chunk-based spatial organization
- Ward-level granularity within the sample region
- Basic location validation and conversion utilities

## Stage 22 Objectives

### Primary Goals

1. **Multi-Region Architecture**: Support all 37 administrative regions (36 states + FCT)
2. **Regional Environment Profiles**: Define unique characteristics for each state/region
3. **Spatial Queries**: Enable efficient queries across the entire country
4. **Region Transitions**: Implement safe movement between regions
5. **System Integration**: Connect geography to government, economy, transport, and other systems
6. **Scalable Loading**: Support progressive loading of regional data

### Secondary Goals

7. **Regional Metadata**: Population, economy, climate, and cultural data
8. **Travel System Foundation**: Support for inter-state and intra-state travel
9. **Location-Based Services**: Enable region-aware gameplay features
10. **Performance Optimization**: Efficient spatial indexing and caching

## Architecture

### Geographic Hierarchy

```
Nigeria (Country)
├── State/FCT (37 regions)
│   ├── LGA (774 total)
│   │   ├── Ward
│   │   │   ├── Settlement
│   │   │   │   ├── Neighborhood
│   │   │   │   └── Point of Interest
```

### Regional Registry

A new `RegionalRegistryService` manages all Nigerian regions:
- Loads regional metadata from catalog
- Provides region lookup by ID, name, or coordinates
- Handles region transitions and validation
- Caches frequently accessed regional data

### Regional Environment Profiles

Each state/region has a profile containing:
- **Administrative**: Capital, LGAs, population
- **Geographic**: Coordinates, area, terrain type
- **Economic**: Primary industries, economic indicators
- **Cultural**: Languages, ethnic groups, cultural significance
- **Environmental**: Climate zone, rainfall, temperature ranges
- **Gameplay**: Available features, restrictions, special rules

### Spatial Query System

Enhanced spatial queries support:
- Point-in-region detection
- Nearest region/feature finding
- Region intersection tests
- Bounding box queries
- Distance calculations between regions

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

1. **Extend Geography Types**
   - Add `NigerianState` and `NigerianRegion` types
   - Create `RegionalEnvironmentProfile` interface
   - Define `RegionalRegistry` data structures

2. **Create Regional Catalog**
   - Build comprehensive catalog with all 37 states
   - Include LGA mappings and metadata
   - Define regional environment profiles

3. **Implement Regional Registry Service**
   - Region loading and caching
   - Lookup by ID, name, coordinates
   - Region validation and transitions

### Phase 2: Spatial Operations (Week 2)

4. **Enhance Coordinate System**
   - Support multi-region coordinate conversion
   - Add region-aware position validation
   - Implement cross-region distance calculations

5. **Spatial Query Engine**
   - Point-in-region detection
   - Nearest neighbor queries
   - Region intersection tests
   - Spatial indexing for performance

6. **Region Transition System**
   - Safe region boundary crossing
   - State persistence during transitions
   - Event notifications for region changes

### Phase 3: System Integration (Week 3)

7. **Government Integration**
   - State-level policy enforcement
   - LGA-specific regulations
   - Regional government structures

8. **Economy Integration**
   - Regional price variations
   - State-specific markets
   - Inter-state trade

9. **Transport Integration**
   - Inter-state travel routes
   - Regional transport networks
   - Location-based transport availability

10. **NPC and Population**
    - Regional population distribution
    - State-specific NPC behaviors
    - Migration patterns

### Phase 4: Testing and Documentation (Week 4)

11. **Comprehensive Testing**
    - Regional lookup and validation
    - Spatial query accuracy
    - Region transition safety
    - Performance benchmarks

12. **Documentation**
    - Architecture documentation
    - API reference
    - Integration guides
    - Performance characteristics

## Data Model

### NigerianState

```typescript
interface NigerianState {
  id: string;
  name: string;
  code: string;
  capital: string;
  region: "northwest" | "northeast" | "northcentral" | "southwest" | "southsoutheast" | "southsouth";
  lgas: string[];
  population: number;
  area_km2: number;
  coordinates: {
    center: GeographicCoordinate;
    bounds: GeographicBounds;
  };
  environment: RegionalEnvironmentProfile;
}
```

### RegionalEnvironmentProfile

```typescript
interface RegionalEnvironmentProfile {
  climate: "arid" | "semi-arid" | "tropical" | "montane";
  terrain: "coastal" | "plains" | "plateau" | "mountains" | "forest" | "savanna";
  primary_industries: string[];
  languages: string[];
  cultural_significance: string;
  gameplay_features: string[];
  restrictions: string[];
}
```

### RegionalRegistry

```typescript
interface RegionalRegistry {
  schema_version: number;
  world_id: "nigeria-main";
  states: NigerianState[];
  lgas: NigerianLGA[];
  regions: RegionalEnvironmentProfile[];
}
```

## Spatial Query Examples

### Point-in-Region Detection

```typescript
const state = registry.getStateAtCoordinate({ latitude: 9.057, longitude: 7.495 });
// Returns: Abuja FCT
```

### Nearest Region

```typescript
const nearest = registry.findNearestState(currentPosition, { exclude: [currentStateId] });
// Returns: Nearest state to current position
```

### Regional Features

```typescript
const features = registry.getRegionalFeatures(stateId, "markets");
// Returns: All markets in the specified state
```

## Integration Points

### Government System
- State-level policies apply within state boundaries
- LGA regulations enforced at LGA level
- Regional government offices located in capitals

### Economy System
- Regional price variations based on location
- State-specific tax rates
- Inter-state trade routes

### Transportation System
- Inter-state travel requires region transitions
- Regional transport networks
- Location-based route planning

### NPC System
- Regional population distribution
- State-specific NPC behaviors and schedules
- Migration between regions

### World Events System
- Region-scoped events
- State-level announcements
- Localized incidents

## Performance Considerations

### Caching Strategy
- Cache all 37 state profiles in memory (~2MB)
- LRU cache for LGA data (most recently accessed)
- Pre-computed spatial indexes for fast lookups

### Lazy Loading
- Detailed regional data loaded on demand
- Progressive loading based on player proximity
- Background loading of adjacent regions

### Spatial Indexing
- R-tree index for region boundaries
- Grid-based indexing for fast point queries
- Pre-computed neighbor relationships

## Testing Strategy

### Unit Tests
- Regional registry operations
- Spatial query accuracy
- Coordinate conversion
- Region validation

### Integration Tests
- Region transitions with state persistence
- Multi-system integration (government + geography)
- Cross-regional travel
- Event propagation across regions

### Performance Tests
- Lookup latency benchmarks
- Memory usage profiling
- Concurrent access testing
- Large-scale spatial queries

## Migration Path

### Phase 1: Backward Compatibility
- Existing Akure South region remains functional
- New registry wraps existing catalog
- Gradual migration of dependent systems

### Phase 2: Parallel Operation
- Old and new systems run in parallel
- Validation ensures consistency
- Performance comparison

### Phase 3: Full Cutover
- All systems use new regional registry
- Old region-specific code removed
- Comprehensive testing validates migration

## Deliverables

1. **Regional Catalog** (`game/data/geography/regional-catalog.json`)
   - All 37 states with metadata
   - LGA mappings
   - Regional environment profiles

2. **Regional Registry Service** (`services/world-api/src/geography/regional-registry.ts`)
   - Region management
   - Spatial queries
   - Caching and optimization

3. **Enhanced Geography Types** (`services/world-api/src/geography/types.ts`)
   - Extended type definitions
   - Regional interfaces
   - Spatial query types

4. **Integration Layer** (`services/world-api/src/geography/integration.ts`)
   - System integration utilities
   - Region-scoped operations
   - Cross-system coordination

5. **Comprehensive Tests** (`services/world-api/test/geography.test.mjs`)
   - Regional operations
   - Spatial queries
   - Integration tests
   - Performance benchmarks

6. **Documentation**
   - Architecture overview
   - API reference
   - Integration guides
   - Performance characteristics

## Success Criteria

- [ ] All 37 states loadable and queryable
- [ ] Spatial queries complete in <10ms
- [ ] Region transitions preserve all state
- [ ] Government policies respect regional boundaries
- [ ] Economy reflects regional variations
- [ ] Transport routes respect regional geography
- [ ] NPCs exhibit regional behaviors
- [ ] 100% test coverage for new code
- [ ] Performance benchmarks meet targets
- [ ] Documentation complete and accurate

## Timeline

- **Week 1**: Core infrastructure and catalog
- **Week 2**: Spatial operations and queries
- **Week 3**: System integration
- **Week 4**: Testing, optimization, and documentation

## Risks and Mitigations

### Risk: Performance Degradation
**Mitigation**: Aggressive caching, spatial indexing, lazy loading

### Risk: Data Accuracy
**Mitigation**: Use authoritative sources, validate all data, provide correction mechanisms

### Risk: Integration Complexity
**Mitigation**: Phased rollout, parallel operation, comprehensive testing

### Risk: Memory Usage
**Mitigation**: Efficient data structures, lazy loading, memory monitoring

## Future Enhancements (Post-Stage 22)

- **Stage 23**: Detailed 3D environments for each region
- **Stage 24**: Real-time weather and environmental effects
- **Stage 25**: Advanced transportation networks
- **Stage 26**: Dynamic regional economies
- **Stage 27**: Cultural and linguistic diversity simulation

## Conclusion

Stage 22 transforms the geography system from a single-region prototype to a comprehensive, nationwide framework. This enables rich, location-aware gameplay across all of Nigeria while maintaining performance and scalability. The foundation laid in this stage supports all future geographic and regional features.
