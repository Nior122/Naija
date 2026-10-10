import type { CalendarDate } from "../life/types.js";
import type {
  PersistentTransportationMaps,
  OwnedVehicleRecord,
  VehicleOwnershipHistoryRecord,
  RoadNodeRecord,
  RoadSegmentRecord,
  TransportationFacilityRecord,
  TransportRouteRecord,
  TransportTripRecord,
  FuelPurchaseRecord,
  VehicleMaintenanceRecord,
  CargoShipmentRecord,
  DriverLicenseRecord,
  TransportationVehicleStatus,
  TransportationOwnershipType,
  TransportationFuelType,
  TransportationModeId,
  TransportationFacilityTypeId,
  TransportationRoadTypeId,
  TransportationVehicleCategoryId,
  TransportationTripStatus,
  TransportationCargoStatus,
} from "./types.js";
import { TransportationCatalogService } from "./catalog.js";

const uid = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const transportationUid = (prefix: string): string => `${prefix}_${uid()}_${Date.now().toString(36)}`;

export function emptyTransportationMaps(): PersistentTransportationMaps {
  return {
    ownedVehicles: {},
    vehicleOwnershipHistory: {},
    roadNodes: {},
    roadSegments: {},
    transportationFacilities: {},
    transportRoutes: {},
    transportTrips: {},
    fuelPurchases: {},
    vehicleMaintenanceRecords: {},
    cargoShipments: {},
    driverLicenses: {},
  };
}

export function initializeTransportationWorldState(
  maps: PersistentTransportationMaps,
): void {
  // Initialize default road network for Akure South sample region
  if (Object.keys(maps.roadNodes).length === 0) {
    const defaultNodes: RoadNodeRecord[] = [
      {
        node_id: "node_akure_center",
        location_id: "ng:lga:on:akure-south",
        position: { x: 800, y: 450 },
        geographic_coordinate: { latitude: 7.25, longitude: 5.2 },
        elevation_m: 350,
        is_intersection: true,
        connected_nodes: ["node_akure_north", "node_akure_south", "node_akure_east"],
      },
      {
        node_id: "node_akure_north",
        location_id: "ng:lga:on:akure-south",
        position: { x: 800, y: 250 },
        geographic_coordinate: { latitude: 7.27, longitude: 5.2 },
        elevation_m: 340,
        is_intersection: true,
        connected_nodes: ["node_akure_center", "node_akure_highway_north"],
      },
      {
        node_id: "node_akure_south",
        location_id: "ng:lga:on:akure-south",
        position: { x: 800, y: 650 },
        geographic_coordinate: { latitude: 7.23, longitude: 5.2 },
        elevation_m: 360,
        is_intersection: true,
        connected_nodes: ["node_akure_center", "node_akure_highway_south"],
      },
      {
        node_id: "node_akure_east",
        location_id: "ng:lga:on:akure-south",
        position: { x: 1100, y: 450 },
        geographic_coordinate: { latitude: 7.25, longitude: 5.23 },
        elevation_m: 345,
        is_intersection: true,
        connected_nodes: ["node_akure_center"],
      },
      {
        node_id: "node_akure_highway_north",
        location_id: "ng:lga:on:akure-south",
        position: { x: 800, y: 100 },
        geographic_coordinate: { latitude: 7.29, longitude: 5.2 },
        elevation_m: 330,
        is_intersection: false,
        connected_nodes: ["node_akure_north"],
      },
      {
        node_id: "node_akure_highway_south",
        location_id: "ng:lga:on:akure-south",
        position: { x: 800, y: 800 },
        geographic_coordinate: { latitude: 7.21, longitude: 5.2 },
        elevation_m: 370,
        is_intersection: false,
        connected_nodes: ["node_akure_south"],
      },
    ];

    for (const node of defaultNodes) {
      maps.roadNodes[node.node_id] = node;
    }
  }

  if (Object.keys(maps.roadSegments).length === 0) {
    const defaultSegments: RoadSegmentRecord[] = [
      {
        segment_id: "segment_akure_main_1",
        name: "Akure Central Road",
        road_type: "urban_road",
        start_node_id: "node_akure_center",
        end_node_id: "node_akure_north",
        length_km: 2.5,
        condition: 0.85,
        traffic_congestion: 1.2,
        is_closed: false,
        closure_reason: null,
        speed_limit_kmh: 50,
        vehicle_restrictions: [],
      },
      {
        segment_id: "segment_akure_main_2",
        name: "Akure South Road",
        road_type: "urban_road",
        start_node_id: "node_akure_center",
        end_node_id: "node_akure_south",
        length_km: 2.5,
        condition: 0.8,
        traffic_congestion: 1.3,
        is_closed: false,
        closure_reason: null,
        speed_limit_kmh: 50,
        vehicle_restrictions: [],
      },
      {
        segment_id: "segment_akure_east",
        name: "Akure East Road",
        road_type: "urban_road",
        start_node_id: "node_akure_center",
        end_node_id: "node_akure_east",
        length_km: 3.2,
        condition: 0.75,
        traffic_congestion: 1.1,
        is_closed: false,
        closure_reason: null,
        speed_limit_kmh: 50,
        vehicle_restrictions: [],
      },
      {
        segment_id: "segment_highway_north",
        name: "Akure-Ibadan Expressway (North)",
        road_type: "expressway",
        start_node_id: "node_akure_north",
        end_node_id: "node_akure_highway_north",
        length_km: 5.0,
        condition: 0.9,
        traffic_congestion: 1.0,
        is_closed: false,
        closure_reason: null,
        speed_limit_kmh: 120,
        vehicle_restrictions: ["bicycle", "motorcycle", "tricycle"],
      },
      {
        segment_id: "segment_highway_south",
        name: "Akure-Ore Expressway (South)",
        road_type: "expressway",
        start_node_id: "node_akure_south",
        end_node_id: "node_akure_highway_south",
        length_km: 5.0,
        condition: 0.88,
        traffic_congestion: 1.05,
        is_closed: false,
        closure_reason: null,
        speed_limit_kmh: 120,
        vehicle_restrictions: ["bicycle", "motorcycle", "tricycle"],
      },
    ];

    for (const segment of defaultSegments) {
      maps.roadSegments[segment.segment_id] = segment;
    }
  }

  if (Object.keys(maps.transportationFacilities).length === 0) {
    const defaultFacilities: TransportationFacilityRecord[] = [
      {
        facility_id: "facility_fuel_station_1",
        facility_type: "fuel_station",
        name: "Akure Central Fuel Station",
        location_id: "ng:lga:on:akure-south",
        position: { x: 850, y: 430 },
        geographic_coordinate: { latitude: 7.252, longitude: 5.205 },
        owner_id: null,
        operator_id: "business_fuel_co_1",
        is_operational: true,
        services: ["fuel", "convenience_store"],
        fuel_types_available: ["petrol", "diesel"],
        fuel_price_per_liter_ngn: 750,
        capacity: null,
      },
      {
        facility_id: "facility_motor_park_1",
        facility_type: "motor_park",
        name: "Akure Central Motor Park",
        location_id: "ng:lga:on:akure-south",
        position: { x: 780, y: 460 },
        geographic_coordinate: { latitude: 7.248, longitude: 5.198 },
        owner_id: null,
        operator_id: null,
        is_operational: true,
        services: ["public_transport", "taxi"],
        fuel_types_available: [],
        fuel_price_per_liter_ngn: null,
        capacity: 50,
      },
      {
        facility_id: "facility_repair_garage_1",
        facility_type: "repair_garage",
        name: "Akure Auto Repair Center",
        location_id: "ng:lga:on:akure-south",
        position: { x: 820, y: 480 },
        geographic_coordinate: { latitude: 7.246, longitude: 5.208 },
        owner_id: null,
        operator_id: "business_repair_1",
        is_operational: true,
        services: ["mechanical_repair", "electrical", "tire_service", "oil_change"],
        fuel_types_available: [],
        fuel_price_per_liter_ngn: null,
        capacity: 10,
      },
      {
        facility_id: "facility_dealership_1",
        facility_type: "vehicle_dealership",
        name: "Akure Vehicle Dealership",
        location_id: "ng:lga:on:akure-south",
        position: { x: 900, y: 420 },
        geographic_coordinate: { latitude: 7.254, longitude: 5.212 },
        owner_id: null,
        operator_id: "business_dealership_1",
        is_operational: true,
        services: ["vehicle_sales", "vehicle_registration"],
        fuel_types_available: [],
        fuel_price_per_liter_ngn: null,
        capacity: 30,
      },
      {
        facility_id: "facility_intercity_terminal_1",
        facility_type: "intercity_terminal",
        name: "Akure Intercity Bus Terminal",
        location_id: "ng:lga:on:akure-south",
        position: { x: 750, y: 400 },
        geographic_coordinate: { latitude: 7.26, longitude: 5.19 },
        owner_id: null,
        operator_id: null,
        is_operational: true,
        services: ["intercity_transport", "ticketing", "luggage"],
        fuel_types_available: [],
        fuel_price_per_liter_ngn: null,
        capacity: 100,
      },
    ];

    for (const facility of defaultFacilities) {
      maps.transportationFacilities[facility.facility_id] = facility;
    }
  }

  if (Object.keys(maps.transportRoutes).length === 0) {
    const defaultRoutes: TransportRouteRecord[] = [
      {
        route_id: "route_akure_local_1",
        name: "Akure Central Loop",
        mode: "public_bus",
        operator_id: null,
        start_facility_id: "facility_motor_park_1",
        end_facility_id: "facility_motor_park_1",
        stops: [
          { facility_id: "facility_motor_park_1", order: 1 },
          { facility_id: "facility_fuel_station_1", order: 2 },
          { facility_id: "facility_repair_garage_1", order: 3 },
        ],
        distance_km: 8.5,
        estimated_duration_minutes: 25,
        base_fare_ngn: 200,
        fare_per_km_ngn: 50,
        is_active: true,
        schedule_notes: "Operates 6 AM - 10 PM daily",
      },
      {
        route_id: "route_akure_ibadan",
        name: "Akure-Ibadan Express",
        mode: "intercity_bus",
        operator_id: null,
        start_facility_id: "facility_intercity_terminal_1",
        end_facility_id: null,
        stops: [
          { facility_id: "facility_intercity_terminal_1", order: 1 },
        ],
        distance_km: 150,
        estimated_duration_minutes: 180,
        base_fare_ngn: 2000,
        fare_per_km_ngn: 40,
        is_active: true,
        schedule_notes: "Departs 7 AM, 12 PM, 4 PM daily",
      },
    ];

    for (const route of defaultRoutes) {
      maps.transportRoutes[route.route_id] = route;
    }
  }
}

export class TransportationService {
  private readonly catalog: TransportationCatalogService;
  private maps: PersistentTransportationMaps;

  constructor(maps: PersistentTransportationMaps, catalog?: TransportationCatalogService) {
    this.maps = maps;
    this.catalog = catalog ?? new TransportationCatalogService();
  }

  // Vehicle ownership management

  purchaseVehicle(params: {
    buyer_character_id: string;
    vehicle_definition_id: string;
    facility_id?: string;
    purchase_price_ngn?: number;
  }, worldDate: CalendarDate): OwnedVehicleRecord {
    const vehicleDef = this.catalog.getVehicleDefinition(params.vehicle_definition_id);
    if (!vehicleDef) {
      throw new Error("transportation_vehicle_not_found");
    }

    const price = params.purchase_price_ngn ?? vehicleDef.base_price_ngn;
    const vehicleId = transportationUid("vehicle");
    const now = new Date().toISOString();

    const vehicle: OwnedVehicleRecord = {
      vehicle_id: vehicleId,
      definition_id: params.vehicle_definition_id,
      owner_type: "character",
      owner_id: params.buyer_character_id,
      registration_number: null,
      acquisition_date: now,
      acquisition_price_ngn: price,
      condition: 100,
      current_fuel_liters: vehicleDef.fuel_capacity_liters * 0.8,
      odometer_km: 0,
      current_location_id: params.facility_id ?? "ng:lga:on:akure-south",
      status: "available",
      last_maintenance_date: null,
      last_maintenance_odometer_km: 0,
      created_at: now,
      updated_at: now,
    };

    this.maps.ownedVehicles[vehicleId] = vehicle;
    return vehicle;
  }

  getOwnedVehicle(vehicleId: string): OwnedVehicleRecord | undefined {
    return this.maps.ownedVehicles[vehicleId];
  }

  getVehiclesByOwner(ownerType: TransportationOwnershipType, ownerId: string): OwnedVehicleRecord[] {
    return Object.values(this.maps.ownedVehicles).filter(
      (v) => v.owner_type === ownerType && v.owner_id === ownerId
    );
  }

  transferVehicle(params: {
    vehicle_id: string;
    from_owner_type: TransportationOwnershipType;
    from_owner_id: string;
    to_owner_type: TransportationOwnershipType;
    to_owner_id: string;
    transfer_price_ngn?: number;
    reason: "purchase" | "sale" | "gift" | "inheritance" | "repossesion";
  }, worldDate: CalendarDate): VehicleOwnershipHistoryRecord {
    const vehicle = this.maps.ownedVehicles[params.vehicle_id];
    if (!vehicle) {
      throw new Error("transportation_vehicle_not_found");
    }

    if (vehicle.owner_type !== params.from_owner_type || vehicle.owner_id !== params.from_owner_id) {
      throw new Error("transportation_unauthorized_transfer");
    }

    if (vehicle.status !== "available") {
      throw new Error("transportation_vehicle_not_available");
    }

    const historyId = transportationUid("vhist");
    const now = new Date().toISOString();

    const history: VehicleOwnershipHistoryRecord = {
      history_id: historyId,
      vehicle_id: params.vehicle_id,
      previous_owner_type: vehicle.owner_type,
      previous_owner_id: vehicle.owner_id,
      new_owner_type: params.to_owner_type,
      new_owner_id: params.to_owner_id,
      transfer_date: now,
      transfer_price_ngn: params.transfer_price_ngn ?? null,
      reason: params.reason,
    };

    this.maps.vehicleOwnershipHistory[historyId] = history;

    const updatedVehicle: OwnedVehicleRecord = {
      ...vehicle,
      owner_type: params.to_owner_type,
      owner_id: params.to_owner_id,
      updated_at: now,
    };

    this.maps.ownedVehicles[params.vehicle_id] = updatedVehicle;
    return history;
  }

  // Vehicle operations

  refuelVehicle(params: {
    vehicle_id: string;
    character_id: string;
    facility_id: string;
    fuel_type: TransportationFuelType;
    liters: number;
    price_per_liter_ngn: number;
  }, worldDate: CalendarDate): FuelPurchaseRecord {
    const vehicle = this.maps.ownedVehicles[params.vehicle_id];
    if (!vehicle) {
      throw new Error("transportation_vehicle_not_found");
    }

    if (vehicle.owner_type !== "character" || vehicle.owner_id !== params.character_id) {
      throw new Error("transportation_unauthorized_operation");
    }

    const vehicleDef = this.catalog.getVehicleDefinition(vehicle.definition_id);
    if (!vehicleDef) {
      throw new Error("transportation_vehicle_not_found");
    }

    if (vehicleDef.fuel_type !== params.fuel_type) {
      throw new Error("transportation_incompatible_fuel");
    }

    const rules = this.catalog.getRules();
    if (params.liters < rules.minimum_fuel_liters || params.liters > rules.maximum_fuel_liters) {
      throw new Error("transportation_invalid_fuel_amount");
    }

    const newFuelLevel = vehicle.current_fuel_liters + params.liters;
    if (newFuelLevel > vehicleDef.fuel_capacity_liters) {
      throw new Error("transportation_fuel_capacity_exceeded");
    }

    const purchaseId = transportationUid("fuel");
    const now = new Date().toISOString();

    const purchase: FuelPurchaseRecord = {
      purchase_id: purchaseId,
      vehicle_id: params.vehicle_id,
      character_id: params.character_id,
      facility_id: params.facility_id,
      fuel_type: params.fuel_type,
      liters_purchased: params.liters,
      price_per_liter_ngn: params.price_per_liter_ngn,
      total_cost_ngn: Math.round(params.liters * params.price_per_liter_ngn),
      purchase_date: now,
      vehicle_odometer_km: vehicle.odometer_km,
    };

    this.maps.fuelPurchases[purchaseId] = purchase;

    const updatedVehicle: OwnedVehicleRecord = {
      ...vehicle,
      current_fuel_liters: newFuelLevel,
      updated_at: now,
    };

    this.maps.ownedVehicles[params.vehicle_id] = updatedVehicle;
    return purchase;
  }

  maintainVehicle(params: {
    vehicle_id: string;
    character_id: string;
    facility_id: string;
    service_type: string;
    cost_ngn: number;
    notes?: string;
  }, worldDate: CalendarDate): VehicleMaintenanceRecord {
    const vehicle = this.maps.ownedVehicles[params.vehicle_id];
    if (!vehicle) {
      throw new Error("transportation_vehicle_not_found");
    }

    if (vehicle.owner_type !== "character" || vehicle.owner_id !== params.character_id) {
      throw new Error("transportation_unauthorized_operation");
    }

    const maintenanceId = transportationUid("maint");
    const now = new Date().toISOString();

    const conditionBefore = vehicle.condition;
    const conditionAfter = Math.min(100, conditionBefore + 30);

    const maintenance: VehicleMaintenanceRecord = {
      maintenance_id: maintenanceId,
      vehicle_id: params.vehicle_id,
      character_id: params.character_id,
      facility_id: params.facility_id,
      service_type: params.service_type,
      cost_ngn: params.cost_ngn,
      service_date: now,
      odometer_km: vehicle.odometer_km,
      condition_before: conditionBefore,
      condition_after: conditionAfter,
      notes: params.notes ?? null,
    };

    this.maps.vehicleMaintenanceRecords[maintenanceId] = maintenance;

    const updatedVehicle: OwnedVehicleRecord = {
      ...vehicle,
      condition: conditionAfter,
      last_maintenance_date: now,
      last_maintenance_odometer_km: vehicle.odometer_km,
      updated_at: now,
    };

    this.maps.ownedVehicles[params.vehicle_id] = updatedVehicle;
    return maintenance;
  }

  updateVehicleStatus(vehicleId: string, status: TransportationVehicleStatus): void {
    const vehicle = this.maps.ownedVehicles[vehicleId];
    if (!vehicle) {
      throw new Error("transportation_vehicle_not_found");
    }

    this.maps.ownedVehicles[vehicleId] = {
      ...vehicle,
      status,
      updated_at: new Date().toISOString(),
    };
  }

  // Trip management

  startTrip(params: {
    route_id: string;
    vehicle_id?: string;
    driver_character_id?: string;
    start_location_id: string;
    passengers?: { character_id: string; fare_paid_ngn: number }[];
  }, worldDate: CalendarDate): TransportTripRecord {
    const route = this.maps.transportRoutes[params.route_id];
    if (!route) {
      throw new Error("transportation_route_not_found");
    }

    if (!route.is_active) {
      throw new Error("transportation_route_not_active");
    }

    const tripId = transportationUid("trip");
    const now = new Date().toISOString();

    const trip: TransportTripRecord = {
      trip_id: tripId,
      route_id: params.route_id,
      vehicle_id: params.vehicle_id ?? null,
      driver_character_id: params.driver_character_id ?? null,
      status: "in_progress",
      start_time: now,
      end_time: null,
      actual_duration_minutes: null,
      passengers: params.passengers ?? [],
      start_location_id: params.start_location_id,
      end_location_id: route.end_facility_id ?? params.start_location_id,
      distance_km: route.distance_km,
      revenue_ngn: (params.passengers ?? []).reduce((sum, p) => sum + p.fare_paid_ngn, 0),
      notes: null,
    };

    this.maps.transportTrips[tripId] = trip;
    return trip;
  }

  completeTrip(tripId: string, endLocationId: string, worldDate: CalendarDate): TransportTripRecord {
    const trip = this.maps.transportTrips[tripId];
    if (!trip) {
      throw new Error("transportation_trip_not_found");
    }

    if (trip.status !== "in_progress") {
      throw new Error("transportation_trip_not_in_progress");
    }

    const now = new Date().toISOString();
    const startTime = new Date(trip.start_time).getTime();
    const endTime = new Date(now).getTime();
    const durationMinutes = Math.round((endTime - startTime) / 60000);

    const updatedTrip: TransportTripRecord = {
      ...trip,
      status: "completed",
      end_time: now,
      actual_duration_minutes: durationMinutes,
      end_location_id: endLocationId,
    };

    this.maps.transportTrips[tripId] = updatedTrip;
    return updatedTrip;
  }

  getTrip(tripId: string): TransportTripRecord | undefined {
    return this.maps.transportTrips[tripId];
  }

  // Cargo management

  createCargoShipment(params: {
    cargo_type: string;
    quantity_kg: number;
    origin_location_id: string;
    destination_location_id: string;
    owner_character_id: string;
    owner_business_id?: string;
    transport_cost_ngn: number;
    expected_delivery_date?: string;
    notes?: string;
  }, worldDate: CalendarDate): CargoShipmentRecord {
    const shipmentId = transportationUid("cargo");
    const now = new Date().toISOString();

    const shipment: CargoShipmentRecord = {
      shipment_id: shipmentId,
      cargo_type: params.cargo_type,
      quantity_kg: params.quantity_kg,
      origin_location_id: params.origin_location_id,
      destination_location_id: params.destination_location_id,
      owner_character_id: params.owner_character_id,
      owner_business_id: params.owner_business_id ?? null,
      assigned_vehicle_id: null,
      status: "created",
      created_date: now,
      pickup_date: null,
      delivery_date: null,
      expected_delivery_date: params.expected_delivery_date ?? null,
      transport_cost_ngn: params.transport_cost_ngn,
      notes: params.notes ?? null,
    };

    this.maps.cargoShipments[shipmentId] = shipment;
    return shipment;
  }

  assignVehicleToShipment(shipmentId: string, vehicleId: string): CargoShipmentRecord {
    const shipment = this.maps.cargoShipments[shipmentId];
    if (!shipment) {
      throw new Error("transportation_shipment_not_found");
    }

    const vehicle = this.maps.ownedVehicles[vehicleId];
    if (!vehicle) {
      throw new Error("transportation_vehicle_not_found");
    }

    const vehicleDef = this.catalog.getVehicleDefinition(vehicle.definition_id);
    if (!vehicleDef) {
      throw new Error("transportation_vehicle_not_found");
    }

    if (shipment.quantity_kg > vehicleDef.capacity_cargo_kg) {
      throw new Error("transportation_cargo_capacity_exceeded");
    }

    const updatedShipment: CargoShipmentRecord = {
      ...shipment,
      assigned_vehicle_id: vehicleId,
      status: "assigned",
    };

    this.maps.cargoShipments[shipmentId] = updatedShipment;
    return updatedShipment;
  }

  updateShipmentStatus(shipmentId: string, status: TransportationCargoStatus): CargoShipmentRecord {
    const shipment = this.maps.cargoShipments[shipmentId];
    if (!shipment) {
      throw new Error("transportation_shipment_not_found");
    }

    const now = new Date().toISOString();
    let pickupDate = shipment.pickup_date;
    let deliveryDate = shipment.delivery_date;

    if (status === "in_transit" && !pickupDate) {
      pickupDate = now;
    }
    if (status === "delivered") {
      deliveryDate = now;
    }

    const updatedShipment: CargoShipmentRecord = {
      ...shipment,
      status,
      pickup_date: pickupDate,
      delivery_date: deliveryDate,
    };

    this.maps.cargoShipments[shipmentId] = updatedShipment;
    return updatedShipment;
  }

  getShipment(shipmentId: string): CargoShipmentRecord | undefined {
    return this.maps.cargoShipments[shipmentId];
  }

  // Road network queries

  getRoadNode(nodeId: string): RoadNodeRecord | undefined {
    return this.maps.roadNodes[nodeId];
  }

  getRoadSegment(segmentId: string): RoadSegmentRecord | undefined {
    return this.maps.roadSegments[segmentId];
  }

  getAllRoadNodes(): RoadNodeRecord[] {
    return Object.values(this.maps.roadNodes);
  }

  getAllRoadSegments(): RoadSegmentRecord[] {
    return Object.values(this.maps.roadSegments);
  }

  // Facility queries

  getFacility(facilityId: string): TransportationFacilityRecord | undefined {
    return this.maps.transportationFacilities[facilityId];
  }

  getFacilitiesByType(type: TransportationFacilityTypeId): TransportationFacilityRecord[] {
    return Object.values(this.maps.transportationFacilities).filter(
      (f) => f.facility_type === type
    );
  }

  getAllFacilities(): TransportationFacilityRecord[] {
    return Object.values(this.maps.transportationFacilities);
  }

  // Route queries

  getRoute(routeId: string): TransportRouteRecord | undefined {
    return this.maps.transportRoutes[routeId];
  }

  getActiveRoutes(): TransportRouteRecord[] {
    return Object.values(this.maps.transportRoutes).filter((r) => r.is_active);
  }

  getRoutesByMode(mode: TransportationModeId): TransportRouteRecord[] {
    return Object.values(this.maps.transportRoutes).filter(
      (r) => r.mode === mode && r.is_active
    );
  }

  // Driver license management

  issueDriverLicense(params: {
    character_id: string;
    license_class: string;
    validity_years: number;
    restrictions?: string[];
  }, worldDate: CalendarDate): DriverLicenseRecord {
    const licenseId = transportationUid("license");
    const now = new Date();
    const expiryDate = new Date(now);
    expiryDate.setFullYear(expiryDate.getFullYear() + params.validity_years);

    const license: DriverLicenseRecord = {
      license_id: licenseId,
      character_id: params.character_id,
      license_class: params.license_class,
      issue_date: now.toISOString(),
      expiry_date: expiryDate.toISOString(),
      is_valid: true,
      restrictions: params.restrictions ?? [],
    };

    this.maps.driverLicenses[licenseId] = license;
    return license;
  }

  getDriverLicenses(characterId: string): DriverLicenseRecord[] {
    return Object.values(this.maps.driverLicenses).filter(
      (l) => l.character_id === characterId && l.is_valid
    );
  }

  hasValidLicense(characterId: string, licenseClass: string): boolean {
    const licenses = this.getDriverLicenses(characterId);
    return licenses.some((l) => l.license_class === licenseClass);
  }

  // Routing and pathfinding

  findRoute(
    startNodeId: string,
    endNodeId: string,
    vehicleCategoryId?: TransportationVehicleCategoryId,
  ): { path: string[]; distance_km: number; estimated_time_minutes: number } | null {
    const startNode = this.maps.roadNodes[startNodeId];
    const endNode = this.maps.roadNodes[endNodeId];

    if (!startNode || !endNode) {
      return null;
    }

    // Simple BFS/Dijkstra implementation for connected nodes
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: string[]; distance: number }> = [
      { nodeId: startNodeId, path: [startNodeId], distance: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.nodeId === endNodeId) {
        return {
          path: current.path,
          distance_km: current.distance,
          estimated_time_minutes: Math.round((current.distance / 50) * 60),
        };
      }

      if (visited.has(current.nodeId)) continue;
      visited.add(current.nodeId);

      const node = this.maps.roadNodes[current.nodeId];
      if (!node) continue;

      for (const connectedNodeId of node.connected_nodes) {
        if (visited.has(connectedNodeId)) continue;

        // Find the segment connecting these nodes
        const segment = Object.values(this.maps.roadSegments).find(
          (s) =>
            (s.start_node_id === current.nodeId && s.end_node_id === connectedNodeId) ||
            (s.end_node_id === current.nodeId && s.start_node_id === connectedNodeId)
        );

        if (!segment || segment.is_closed) continue;

        // Check vehicle restrictions
        if (vehicleCategoryId && segment.vehicle_restrictions.includes(vehicleCategoryId)) {
          continue;
        }

        queue.push({
          nodeId: connectedNodeId,
          path: [...current.path, connectedNodeId],
          distance: current.distance + segment.length_km,
        });
      }
    }

    return null;
  }

  // Utility methods

  getCatalog(): TransportationCatalogService {
    return this.catalog;
  }

  getAllMaps(): PersistentTransportationMaps {
    return this.maps;
  }

  static errorMessage(errorCode: string): string {
    const messages: Record<string, string> = {
      transportation_vehicle_not_found: "Vehicle not found",
      transportation_unauthorized_transfer: "Unauthorized vehicle transfer",
      transportation_vehicle_not_available: "Vehicle is not available",
      transportation_unauthorized_operation: "Unauthorized operation",
      transportation_incompatible_fuel: "Incompatible fuel type",
      transportation_invalid_fuel_amount: "Invalid fuel amount",
      transportation_fuel_capacity_exceeded: "Fuel capacity exceeded",
      transportation_route_not_found: "Route not found",
      transportation_route_not_active: "Route is not active",
      transportation_trip_not_found: "Trip not found",
      transportation_trip_not_in_progress: "Trip is not in progress",
      transportation_shipment_not_found: "Shipment not found",
      transportation_cargo_capacity_exceeded: "Cargo capacity exceeded",
    };
    return messages[errorCode] ?? errorCode;
  }
}
