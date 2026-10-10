import type { CalendarDate } from "../life/types.js";
import type { Point2D } from "../multiplayer/types.js";

export type TransportationVehicleCategoryId = 
  | "bicycle"
  | "motorcycle"
  | "tricycle"
  | "compact_car"
  | "sedan"
  | "suv"
  | "pickup_truck"
  | "minibus"
  | "commercial_bus"
  | "delivery_van"
  | "heavy_truck"
  | "tanker_truck";

export type TransportationFuelType = "petrol" | "diesel" | "electricity" | "none";

export type TransportationRoadTypeId =
  | "residential_street"
  | "urban_road"
  | "arterial_road"
  | "highway"
  | "expressway"
  | "rural_road";

export type TransportationFacilityTypeId =
  | "bus_stop"
  | "motor_park"
  | "fuel_station"
  | "repair_garage"
  | "vehicle_dealership"
  | "intercity_terminal";

export type TransportationModeId =
  | "walking"
  | "private_vehicle"
  | "public_bus"
  | "taxi"
  | "ride_hailing"
  | "intercity_bus";

export type TransportationVehicleStatus =
  | "available"
  | "in_use"
  | "maintenance"
  | "disabled"
  | "scrapped";

export type TransportationTripStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export type TransportationCargoStatus =
  | "created"
  | "awaiting_pickup"
  | "assigned"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "failed";

export type TransportationOwnershipType = "character" | "business" | "npc" | "government";

export interface TransportationVehicleCategory {
  readonly id: TransportationVehicleCategoryId;
  readonly label: string;
  readonly requires_license: boolean;
  readonly minimum_age: number;
  readonly description: string;
}

export interface TransportationVehicleDefinition {
  readonly id: string;
  readonly category_id: TransportationVehicleCategoryId;
  readonly name: string;
  readonly capacity_passengers: number;
  readonly capacity_cargo_kg: number;
  readonly base_price_ngn: number;
  readonly fuel_type: TransportationFuelType;
  readonly fuel_capacity_liters: number;
  readonly fuel_consumption_liters_per_100km: number;
  readonly max_speed_kmh: number;
  readonly durability: number;
  readonly maintenance_cost_per_service_ngn: number;
  readonly requires_license: boolean;
}

export interface TransportationFuelTypeDefinition {
  readonly id: TransportationFuelType;
  readonly label: string;
  readonly base_price_per_liter_ngn: number;
  readonly energy_density_mj_per_liter: number;
}

export interface TransportationRoadType {
  readonly id: TransportationRoadTypeId;
  readonly label: string;
  readonly speed_limit_kmh: number;
  readonly base_travel_speed_kmh: number;
  readonly condition_factor: number;
  readonly vehicle_restrictions: readonly TransportationVehicleCategoryId[];
}

export interface TransportationFacilityType {
  readonly id: TransportationFacilityTypeId;
  readonly label: string;
  readonly description: string;
}

export interface TransportationMode {
  readonly id: TransportationModeId;
  readonly label: string;
  readonly speed_kmh: number;
  readonly requires_vehicle: boolean;
  readonly cost_per_km_ngn: number;
}

export interface TransportationRules {
  readonly currency: string;
  readonly currency_label: string;
  readonly currency_symbol: string;
  readonly minimum_driver_age: number;
  readonly commercial_driver_age: number;
  readonly heavy_vehicle_age: number;
  readonly maximum_vehicle_age_years: number;
  readonly fuel_consumption_base_liters_per_100km: number;
  readonly maintenance_interval_km: number;
  readonly minimum_fuel_liters: number;
  readonly maximum_fuel_liters: number;
  readonly traffic_congestion_multiplier_min: number;
  readonly traffic_congestion_multiplier_max: number;
  readonly road_condition_multiplier_min: number;
  readonly road_condition_multiplier_max: number;
}

export interface TransportationCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly rules: TransportationRules;
  readonly vehicle_categories: readonly TransportationVehicleCategory[];
  readonly vehicle_definitions: readonly TransportationVehicleDefinition[];
  readonly fuel_types: readonly TransportationFuelTypeDefinition[];
  readonly road_types: readonly TransportationRoadType[];
  readonly facility_types: readonly TransportationFacilityType[];
  readonly transport_modes: readonly TransportationMode[];
}

export interface OwnedVehicleRecord {
  readonly vehicle_id: string;
  readonly definition_id: string;
  readonly owner_type: TransportationOwnershipType;
  readonly owner_id: string;
  readonly registration_number: string | null;
  readonly acquisition_date: string;
  readonly acquisition_price_ngn: number;
  readonly condition: number;
  readonly current_fuel_liters: number;
  readonly odometer_km: number;
  readonly current_location_id: string;
  readonly status: TransportationVehicleStatus;
  readonly last_maintenance_date: string | null;
  readonly last_maintenance_odometer_km: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface VehicleOwnershipHistoryRecord {
  readonly history_id: string;
  readonly vehicle_id: string;
  readonly previous_owner_type: TransportationOwnershipType | null;
  readonly previous_owner_id: string | null;
  readonly new_owner_type: TransportationOwnershipType;
  readonly new_owner_id: string;
  readonly transfer_date: string;
  readonly transfer_price_ngn: number | null;
  readonly reason: "purchase" | "sale" | "gift" | "inheritance" | "repossesion";
}

export interface RoadNodeRecord {
  readonly node_id: string;
  readonly location_id: string;
  readonly position: Point2D;
  readonly geographic_coordinate: { latitude: number; longitude: number } | null;
  readonly elevation_m: number | null;
  readonly is_intersection: boolean;
  readonly connected_nodes: readonly string[];
}

export interface RoadSegmentRecord {
  readonly segment_id: string;
  readonly name: string | null;
  readonly road_type: TransportationRoadTypeId;
  readonly start_node_id: string;
  readonly end_node_id: string;
  readonly length_km: number;
  readonly condition: number;
  readonly traffic_congestion: number;
  readonly is_closed: boolean;
  readonly closure_reason: string | null;
  readonly speed_limit_kmh: number;
  readonly vehicle_restrictions: readonly TransportationVehicleCategoryId[];
}

export interface TransportationFacilityRecord {
  readonly facility_id: string;
  readonly facility_type: TransportationFacilityTypeId;
  readonly name: string;
  readonly location_id: string;
  readonly position: Point2D;
  readonly geographic_coordinate: { latitude: number; longitude: number } | null;
  readonly owner_id: string | null;
  readonly operator_id: string | null;
  readonly is_operational: boolean;
  readonly services: readonly string[];
  readonly fuel_types_available: readonly TransportationFuelType[];
  readonly fuel_price_per_liter_ngn: number | null;
  readonly capacity: number | null;
}

export interface TransportRouteRecord {
  readonly route_id: string;
  readonly name: string;
  readonly mode: TransportationModeId;
  readonly operator_id: string | null;
  readonly start_facility_id: string | null;
  readonly end_facility_id: string | null;
  readonly stops: readonly { facility_id: string; order: number }[];
  readonly distance_km: number;
  readonly estimated_duration_minutes: number;
  readonly base_fare_ngn: number;
  readonly fare_per_km_ngn: number;
  readonly is_active: boolean;
  readonly schedule_notes: string | null;
}

export interface TransportTripRecord {
  readonly trip_id: string;
  readonly route_id: string;
  readonly vehicle_id: string | null;
  readonly driver_character_id: string | null;
  readonly status: TransportationTripStatus;
  readonly start_time: string;
  readonly end_time: string | null;
  readonly actual_duration_minutes: number | null;
  readonly passengers: readonly { character_id: string; fare_paid_ngn: number }[];
  readonly start_location_id: string;
  readonly end_location_id: string;
  readonly distance_km: number;
  readonly revenue_ngn: number;
  readonly notes: string | null;
}

export interface FuelPurchaseRecord {
  readonly purchase_id: string;
  readonly vehicle_id: string;
  readonly character_id: string;
  readonly facility_id: string;
  readonly fuel_type: TransportationFuelType;
  readonly liters_purchased: number;
  readonly price_per_liter_ngn: number;
  readonly total_cost_ngn: number;
  readonly purchase_date: string;
  readonly vehicle_odometer_km: number;
}

export interface VehicleMaintenanceRecord {
  readonly maintenance_id: string;
  readonly vehicle_id: string;
  readonly character_id: string;
  readonly facility_id: string;
  readonly service_type: string;
  readonly cost_ngn: number;
  readonly service_date: string;
  readonly odometer_km: number;
  readonly condition_before: number;
  readonly condition_after: number;
  readonly notes: string | null;
}

export interface CargoShipmentRecord {
  readonly shipment_id: string;
  readonly cargo_type: string;
  readonly quantity_kg: number;
  readonly origin_location_id: string;
  readonly destination_location_id: string;
  readonly owner_character_id: string;
  readonly owner_business_id: string | null;
  readonly assigned_vehicle_id: string | null;
  readonly status: TransportationCargoStatus;
  readonly created_date: string;
  readonly pickup_date: string | null;
  readonly delivery_date: string | null;
  readonly expected_delivery_date: string | null;
  readonly transport_cost_ngn: number;
  readonly notes: string | null;
}

export interface DriverLicenseRecord {
  readonly license_id: string;
  readonly character_id: string;
  readonly license_class: string;
  readonly issue_date: string;
  readonly expiry_date: string;
  readonly is_valid: boolean;
  readonly restrictions: readonly string[];
}

export interface TransportationProfileSnapshot {
  readonly character_id: string;
  readonly owned_vehicles: readonly string[];
  readonly driver_licenses: readonly string[];
  readonly total_vehicles_owned: number;
  readonly active_trips: readonly string[];
}

export interface PersistentTransportationMaps {
  readonly ownedVehicles: Record<string, OwnedVehicleRecord>;
  readonly vehicleOwnershipHistory: Record<string, VehicleOwnershipHistoryRecord>;
  readonly roadNodes: Record<string, RoadNodeRecord>;
  readonly roadSegments: Record<string, RoadSegmentRecord>;
  readonly transportationFacilities: Record<string, TransportationFacilityRecord>;
  readonly transportRoutes: Record<string, TransportRouteRecord>;
  readonly transportTrips: Record<string, TransportTripRecord>;
  readonly fuelPurchases: Record<string, FuelPurchaseRecord>;
  readonly vehicleMaintenanceRecords: Record<string, VehicleMaintenanceRecord>;
  readonly cargoShipments: Record<string, CargoShipmentRecord>;
  readonly driverLicenses: Record<string, DriverLicenseRecord>;
}
