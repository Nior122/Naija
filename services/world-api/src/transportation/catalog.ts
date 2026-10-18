import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  TransportationCatalog,
  TransportationVehicleCategory,
  TransportationVehicleDefinition,
  TransportationFuelTypeDefinition,
  TransportationRoadType,
  TransportationFacilityType,
  TransportationMode,
  TransportationRules,
  TransportationVehicleCategoryId,
  TransportationFuelType,
  TransportationRoadTypeId,
  TransportationFacilityTypeId,
  TransportationModeId,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_FILE = "game/data/transportation/catalog.json";

function repositoryRoot(): string {
  return join(__dirname, "../../../..");
}

let cached: TransportationCatalog | null = null;

export function loadTransportationCatalog(): TransportationCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as TransportationCatalog;
  cached = parsed;
  return parsed;
}

export class TransportationCatalogService {
  private readonly catalog: TransportationCatalog;
  private readonly vehicleCategoriesById: Map<TransportationVehicleCategoryId, TransportationVehicleCategory>;
  private readonly vehicleDefinitionsById: Map<string, TransportationVehicleDefinition>;
  private readonly fuelTypesById: Map<TransportationFuelType, TransportationFuelTypeDefinition>;
  private readonly roadTypesById: Map<TransportationRoadTypeId, TransportationRoadType>;
  private readonly facilityTypesById: Map<TransportationFacilityTypeId, TransportationFacilityType>;
  private readonly transportModesById: Map<TransportationModeId, TransportationMode>;

  constructor() {
    this.catalog = loadTransportationCatalog();
    
    this.vehicleCategoriesById = new Map();
    for (const category of this.catalog.vehicle_categories) {
      this.vehicleCategoriesById.set(category.id, category);
    }

    this.vehicleDefinitionsById = new Map();
    for (const vehicle of this.catalog.vehicle_definitions) {
      this.vehicleDefinitionsById.set(vehicle.id, vehicle);
    }

    this.fuelTypesById = new Map();
    for (const fuelType of this.catalog.fuel_types) {
      this.fuelTypesById.set(fuelType.id, fuelType);
    }

    this.roadTypesById = new Map();
    for (const roadType of this.catalog.road_types) {
      this.roadTypesById.set(roadType.id, roadType);
    }

    this.facilityTypesById = new Map();
    for (const facilityType of this.catalog.facility_types) {
      this.facilityTypesById.set(facilityType.id, facilityType);
    }

    this.transportModesById = new Map();
    for (const mode of this.catalog.transport_modes) {
      this.transportModesById.set(mode.id, mode);
    }
  }

  getRules(): TransportationRules {
    return this.catalog.rules;
  }

  hasVehicleCategory(id: TransportationVehicleCategoryId): boolean {
    return this.vehicleCategoriesById.has(id);
  }

  getVehicleCategory(id: TransportationVehicleCategoryId): TransportationVehicleCategory | undefined {
    return this.vehicleCategoriesById.get(id);
  }

  hasVehicleDefinition(id: string): boolean {
    return this.vehicleDefinitionsById.has(id);
  }

  getVehicleDefinition(id: string): TransportationVehicleDefinition | undefined {
    return this.vehicleDefinitionsById.get(id);
  }

  getVehicleDefinitionsByCategory(categoryId: TransportationVehicleCategoryId): TransportationVehicleDefinition[] {
    return Array.from(this.vehicleDefinitionsById.values()).filter(
      (vehicle) => vehicle.category_id === categoryId
    );
  }

  hasFuelType(id: TransportationFuelType): boolean {
    return this.fuelTypesById.has(id);
  }

  getFuelType(id: TransportationFuelType): TransportationFuelTypeDefinition | undefined {
    return this.fuelTypesById.get(id);
  }

  hasRoadType(id: TransportationRoadTypeId): boolean {
    return this.roadTypesById.has(id);
  }

  getRoadType(id: TransportationRoadTypeId): TransportationRoadType | undefined {
    return this.roadTypesById.get(id);
  }

  hasFacilityType(id: TransportationFacilityTypeId): boolean {
    return this.facilityTypesById.has(id);
  }

  getFacilityType(id: TransportationFacilityTypeId): TransportationFacilityType | undefined {
    return this.facilityTypesById.get(id);
  }

  hasTransportMode(id: TransportationModeId): boolean {
    return this.transportModesById.has(id);
  }

  getTransportMode(id: TransportationModeId): TransportationMode | undefined {
    return this.transportModesById.get(id);
  }

  validateVehicleAge(characterAge: number, vehicleDefinitionId: string): boolean {
    const vehicle = this.getVehicleDefinition(vehicleDefinitionId);
    if (!vehicle) return false;
    const category = this.getVehicleCategory(vehicle.category_id);
    if (!category) return false;
    return characterAge >= category.minimum_age;
  }

  validateVehicleLicense(required: boolean, hasLicense: boolean): boolean {
    if (required && !hasLicense) return false;
    return true;
  }

  calculateFuelCost(fuelType: TransportationFuelType, liters: number): number {
    const fuel = this.getFuelType(fuelType);
    if (!fuel) return 0;
    return Math.round(liters * fuel.base_price_per_liter_ngn);
  }

  calculateFare(distanceKm: number, mode: TransportationModeId, baseFare: number = 0): number {
    const transportMode = this.getTransportMode(mode);
    if (!transportMode) return 0;
    return Math.round(baseFare + distanceKm * transportMode.cost_per_km_ngn);
  }

  calculateTravelTime(distanceKm: number, mode: TransportationModeId): number {
    const transportMode = this.getTransportMode(mode);
    if (!transportMode) return 0;
    return Math.round((distanceKm / transportMode.speed_kmh) * 60);
  }

  getAllVehicleCategories(): TransportationVehicleCategory[] {
    return Array.from(this.vehicleCategoriesById.values());
  }

  getAllVehicleDefinitions(): TransportationVehicleDefinition[] {
    return Array.from(this.vehicleDefinitionsById.values());
  }

  getAllFuelTypes(): TransportationFuelTypeDefinition[] {
    return Array.from(this.fuelTypesById.values());
  }

  getAllRoadTypes(): TransportationRoadType[] {
    return Array.from(this.roadTypesById.values());
  }

  getAllFacilityTypes(): TransportationFacilityType[] {
    return Array.from(this.facilityTypesById.values());
  }

  getAllTransportModes(): TransportationMode[] {
    return Array.from(this.transportModesById.values());
  }
}
