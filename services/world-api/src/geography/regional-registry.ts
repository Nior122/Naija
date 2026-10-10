import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  RegionalCatalog,
  RegionalEnvironmentProfile,
  NigerianState,
  NigerianRegion,
  GeographicCoordinate,
  RegionQueryResult,
  NearestRegionResult
} from './types.js';
import { geographicDistanceMeters } from './coordinates.js';

/**
 * Calculate distance between two coordinates in kilometers.
 */
function distanceBetweenCoordinates(a: GeographicCoordinate, b: GeographicCoordinate): number {
  return geographicDistanceMeters(a, b) / 1000;
}

/**
 * Regional registry service for managing Nigerian states and regional data.
 * Provides spatial queries, region lookup, and environment profile access.
 */
export class RegionalRegistryService {
  private catalog: RegionalCatalog | null = null;
  private stateMap: Map<string, NigerianState> = new Map();
  private lgaToStateMap: Map<string, string> = new Map();
  private regionToStatesMap: Map<NigerianRegion, string[]> = new Map();
  private loaded = false;

  /**
   * Initialize the regional registry by loading catalog data.
   */
  async initialize(dataPath: string): Promise<void> {
    if (this.loaded) {
      return;
    }

    const catalogPath = join(dataPath, 'geography', 'regional-catalog.json');
    const catalogData = await readFile(catalogPath, 'utf-8');
    this.catalog = JSON.parse(catalogData) as RegionalCatalog;

    // Build lookup maps
    for (const state of this.catalog.states) {
      this.stateMap.set(state.id, state);
      
      // Map LGAs to their parent state
      for (const lga of state.lgas) {
        this.lgaToStateMap.set(lga, state.id);
      }

      // Group states by region
      if (!this.regionToStatesMap.has(state.region)) {
        this.regionToStatesMap.set(state.region, []);
      }
      this.regionToStatesMap.get(state.region)!.push(state.id);
    }

    this.loaded = true;
  }

  /**
   * Get the regional catalog.
   */
  getCatalog(): RegionalCatalog | null {
    return this.catalog;
  }

  /**
   * Get a state by ID.
   */
  getState(stateId: string): NigerianState | undefined {
    return this.stateMap.get(stateId);
  }

  /**
   * Get all states.
   */
  getAllStates(): NigerianState[] {
    return this.catalog?.states || [];
  }

  /**
   * Get all states in a specific region.
   */
  getStatesByRegion(region: NigerianRegion): NigerianState[] {
    const stateIds = this.regionToStatesMap.get(region) || [];
    return stateIds.map(id => this.stateMap.get(id)!).filter(Boolean);
  }

  /**
   * Get the state that contains a given LGA.
   */
  getStateByLga(lgaId: string): NigerianState | undefined {
    const stateId = this.lgaToStateMap.get(lgaId);
    return stateId ? this.stateMap.get(stateId) : undefined;
  }

  /**
   * Find the state containing or nearest to a coordinate.
   * Uses LGA coordinates from the admin data for accuracy.
   */
  findStateAtCoordinate(
    coordinate: GeographicCoordinate,
    lgaCoordinates: Map<string, GeographicCoordinate>
  ): RegionQueryResult | null {
    let nearestState: NigerianState | null = null;
    let minDistance = Infinity;
    let nearestLgaId: string | undefined;

    // Find the nearest LGA coordinate to the given point
    for (const [lgaId, lgaCoord] of lgaCoordinates) {
      const distance = distanceBetweenCoordinates(coordinate, lgaCoord);
      
      if (distance < minDistance) {
        minDistance = distance;
        const state = this.getStateByLga(lgaId);
        if (state) {
          nearestState = state;
          nearestLgaId = lgaId;
        }
      }
    }

    if (!nearestState) {
      return null;
    }

    const result: RegionQueryResult = {
      region_id: nearestState.id,
      state_id: nearestState.id,
      state_name: nearestState.name,
      distance_to_center: minDistance
    };

    if (nearestLgaId) {
      result.lga_id = nearestLgaId;
    }

    return result;
  }

  /**
   * Find the nearest state to a given coordinate.
   */
  findNearestState(coordinate: GeographicCoordinate): NearestRegionResult | null {
    if (!this.catalog) {
      return null;
    }

    let nearestState: NigerianState | null = null;
    let minDistance = Infinity;
    let bearing = 0;

    for (const state of this.catalog.states) {
      const distance = distanceBetweenCoordinates(coordinate, state.coordinates.center);
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestState = state;
        
        // Calculate bearing
        const lat1 = coordinate.latitude * Math.PI / 180;
        const lat2 = state.coordinates.center.latitude * Math.PI / 180;
        const deltaLon = (state.coordinates.center.longitude - coordinate.longitude) * Math.PI / 180;
        
        const y = Math.sin(deltaLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - 
                  Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
        bearing = Math.atan2(y, x) * 180 / Math.PI;
        bearing = (bearing + 360) % 360;
      }
    }

    if (!nearestState) {
      return null;
    }

    return {
      region_id: nearestState.id,
      state_id: nearestState.id,
      state_name: nearestState.name,
      distance_km: minDistance,
      bearing_degrees: bearing
    };
  }

  /**
   * Get the environment profile for a state.
   */
  getEnvironmentProfile(stateId: string): RegionalEnvironmentProfile | undefined {
    const state = this.stateMap.get(stateId);
    return state?.environment;
  }

  /**
   * Check if a coordinate is within a state's bounds.
   */
  isCoordinateInState(coordinate: GeographicCoordinate, stateId: string): boolean {
    const state = this.stateMap.get(stateId);
    if (!state) {
      return false;
    }

    const { bounds } = state.coordinates;
    return (
      coordinate.longitude >= bounds.west &&
      coordinate.longitude <= bounds.east &&
      coordinate.latitude >= bounds.south &&
      coordinate.latitude <= bounds.north
    );
  }

  /**
   * Get all states within a given radius from a coordinate.
   */
  getStatesWithinRadius(
    coordinate: GeographicCoordinate,
    radiusKm: number
  ): Array<{ state: NigerianState; distance_km: number }> {
    if (!this.catalog) {
      return [];
    }

    const results: Array<{ state: NigerianState; distance_km: number }> = [];

    for (const state of this.catalog.states) {
      const distance = distanceBetweenCoordinates(coordinate, state.coordinates.center);
      
      if (distance <= radiusKm) {
        results.push({ state, distance_km: distance });
      }
    }

    return results.sort((a, b) => a.distance_km - b.distance_km);
  }

  /**
   * Get statistics about the regional catalog.
   */
  getStatistics(): {
    total_states: number;
    total_lgas: number;
    total_population: number;
    total_area_km2: number;
    states_by_region: Record<NigerianRegion, number>;
  } {
    if (!this.catalog) {
      return {
        total_states: 0,
        total_lgas: 0,
        total_population: 0,
        total_area_km2: 0,
        states_by_region: {} as Record<NigerianRegion, number>
      };
    }

    const statesByRegion: Record<string, number> = {};
    for (const [region, states] of this.regionToStatesMap.entries()) {
      statesByRegion[region] = states.length;
    }

    return {
      total_states: this.catalog.states.length,
      total_lgas: this.catalog.states.reduce((sum, s) => sum + s.lgas.length, 0),
      total_population: this.catalog.states.reduce((sum, s) => sum + s.population, 0),
      total_area_km2: this.catalog.states.reduce((sum, s) => sum + s.area_km2, 0),
      states_by_region: statesByRegion as Record<NigerianRegion, number>
    };
  }

  /**
   * Check if the registry is loaded.
   */
  isLoaded(): boolean {
    return this.loaded;
  }
}

// Export singleton instance
export const regionalRegistry = new RegionalRegistryService();
