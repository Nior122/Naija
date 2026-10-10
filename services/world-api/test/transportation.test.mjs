import { describe, test } from "node:test";
import assert from "node:assert";
import { TransportationService, TransportationCatalogService, emptyTransportationMaps, initializeTransportationWorldState } from "../dist/transportation/index.js";

describe("Transportation System", () => {
  const calendarDate = { year: 2025, month: 1, day: 1, hour: 12, minute: 0 };

  test("creates a transportation service with empty maps", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    assert.ok(service);
    assert.strictEqual(Object.keys(maps.ownedVehicles).length, 0);
  });

  test("initializes transportation world state with default road network", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    assert.ok(Object.keys(maps.roadNodes).length > 0);
    assert.ok(Object.keys(maps.roadSegments).length > 0);
    assert.ok(Object.keys(maps.transportationFacilities).length > 0);
    assert.ok(Object.keys(maps.transportRoutes).length > 0);
  });

  test("catalog service loads vehicle definitions", () => {
    const catalog = new TransportationCatalogService();
    const vehicles = catalog.getAllVehicleDefinitions();
    assert.ok(vehicles.length > 0);
    assert.ok(catalog.hasVehicleDefinition("bicycle_standard"));
    assert.ok(catalog.hasVehicleDefinition("motorcycle_basic"));
    assert.ok(catalog.hasVehicleDefinition("compact_hatchback"));
  });

  test("catalog service validates vehicle age requirements", () => {
    const catalog = new TransportationCatalogService();
    assert.strictEqual(catalog.validateVehicleAge(18, "motorcycle_basic"), true);
    assert.strictEqual(catalog.validateVehicleAge(16, "motorcycle_basic"), false);
    assert.strictEqual(catalog.validateVehicleAge(12, "bicycle_standard"), true);
    assert.strictEqual(catalog.validateVehicleAge(10, "bicycle_standard"), false);
  });

  test("purchases a vehicle successfully", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "motorcycle_basic",
    }, calendarDate);

    assert.ok(vehicle);
    assert.strictEqual(vehicle.owner_type, "character");
    assert.strictEqual(vehicle.owner_id, "char-1");
    assert.strictEqual(vehicle.definition_id, "motorcycle_basic");
    assert.strictEqual(vehicle.status, "available");
    assert.strictEqual(maps.ownedVehicles[vehicle.vehicle_id], vehicle);
  });

  test("retrieves owned vehicles by owner", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    
    service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "motorcycle_basic",
    }, calendarDate);

    service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "compact_hatchback",
    }, calendarDate);

    const vehicles = service.getVehiclesByOwner("character", "char-1");
    assert.strictEqual(vehicles.length, 2);
  });

  test("transfers vehicle ownership successfully", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "motorcycle_basic",
    }, calendarDate);

    const history = service.transferVehicle({
      vehicle_id: vehicle.vehicle_id,
      from_owner_type: "character",
      from_owner_id: "char-1",
      to_owner_type: "character",
      to_owner_id: "char-2",
      transfer_price_ngn: 200000,
      reason: "sale",
    }, calendarDate);

    assert.ok(history);
    assert.strictEqual(history.previous_owner_id, "char-1");
    assert.strictEqual(history.new_owner_id, "char-2");
    assert.strictEqual(history.reason, "sale");

    const updatedVehicle = service.getOwnedVehicle(vehicle.vehicle_id);
    assert.strictEqual(updatedVehicle.owner_id, "char-2");
  });

  test("prevents unauthorized vehicle transfer", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "motorcycle_basic",
    }, calendarDate);

    assert.throws(() => {
      service.transferVehicle({
        vehicle_id: vehicle.vehicle_id,
        from_owner_type: "character",
        from_owner_id: "char-2", // Wrong owner
        to_owner_type: "character",
        to_owner_id: "char-3",
        reason: "sale",
      }, calendarDate);
    }, /transportation_unauthorized_transfer/);
  });

  test("refuels vehicle successfully", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "motorcycle_basic",
    }, calendarDate);

    const initialFuel = vehicle.current_fuel_liters;
    const purchase = service.refuelVehicle({
      vehicle_id: vehicle.vehicle_id,
      character_id: "char-1",
      facility_id: "facility_fuel_station_1",
      fuel_type: "petrol",
      liters: 3,
      price_per_liter_ngn: 750,
    }, calendarDate);

    assert.ok(purchase);
    assert.strictEqual(purchase.liters_purchased, 3);
    assert.strictEqual(purchase.total_cost_ngn, 2250);

    const updatedVehicle = service.getOwnedVehicle(vehicle.vehicle_id);
    assert.strictEqual(updatedVehicle.current_fuel_liters, initialFuel + 3);
  });

  test("prevents refueling with incompatible fuel type", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "motorcycle_basic", // Uses petrol
    }, calendarDate);

    assert.throws(() => {
      service.refuelVehicle({
        vehicle_id: vehicle.vehicle_id,
        character_id: "char-1",
        facility_id: "facility_fuel_station_1",
        fuel_type: "diesel", // Wrong fuel type
        liters: 10,
        price_per_liter_ngn: 950,
      }, calendarDate);
    }, /transportation_incompatible_fuel/);
  });

  test("maintains vehicle successfully", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "motorcycle_basic",
    }, calendarDate);

    // Reduce vehicle condition
    maps.ownedVehicles[vehicle.vehicle_id] = {
      ...vehicle,
      condition: 70,
    };

    const maintenance = service.maintainVehicle({
      vehicle_id: vehicle.vehicle_id,
      character_id: "char-1",
      facility_id: "facility_repair_garage_1",
      service_type: "oil_change",
      cost_ngn: 5000,
      notes: "Regular maintenance",
    }, calendarDate);

    assert.ok(maintenance);
    assert.strictEqual(maintenance.service_type, "oil_change");
    assert.strictEqual(maintenance.cost_ngn, 5000);
    assert.ok(maintenance.condition_after > maintenance.condition_before);

    const updatedVehicle = service.getOwnedVehicle(vehicle.vehicle_id);
    assert.strictEqual(updatedVehicle.condition, maintenance.condition_after);
  });

  test("starts a trip successfully", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const trip = service.startTrip({
      route_id: "route_akure_local_1",
      start_location_id: "ng:lga:on:akure-south",
      passengers: [
        { character_id: "char-1", fare_paid_ngn: 200 },
        { character_id: "char-2", fare_paid_ngn: 200 },
      ],
    }, calendarDate);

    assert.ok(trip);
    assert.strictEqual(trip.route_id, "route_akure_local_1");
    assert.strictEqual(trip.status, "in_progress");
    assert.strictEqual(trip.passengers.length, 2);
    assert.strictEqual(trip.revenue_ngn, 400);
  });

  test("completes a trip successfully", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const trip = service.startTrip({
      route_id: "route_akure_local_1",
      start_location_id: "ng:lga:on:akure-south",
    }, calendarDate);

    const completedTrip = service.completeTrip(
      trip.trip_id,
      "ng:lga:on:akure-south",
      calendarDate
    );

    assert.ok(completedTrip);
    assert.strictEqual(completedTrip.status, "completed");
    assert.ok(completedTrip.end_time);
    assert.ok(completedTrip.actual_duration_minutes !== null);
  });

  test("creates a cargo shipment successfully", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const shipment = service.createCargoShipment({
      cargo_type: "agricultural_products",
      quantity_kg: 500,
      origin_location_id: "ng:lga:on:akure-south",
      destination_location_id: "ng:lga:on:akure-north",
      owner_character_id: "char-1",
      transport_cost_ngn: 15000,
      notes: "Fresh produce delivery",
    }, calendarDate);

    assert.ok(shipment);
    assert.strictEqual(shipment.cargo_type, "agricultural_products");
    assert.strictEqual(shipment.quantity_kg, 500);
    assert.strictEqual(shipment.status, "created");
    assert.strictEqual(shipment.transport_cost_ngn, 15000);
  });

  test("assigns vehicle to cargo shipment", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "pickup_standard",
    }, calendarDate);

    const shipment = service.createCargoShipment({
      cargo_type: "construction_materials",
      quantity_kg: 800,
      origin_location_id: "ng:lga:on:akure-south",
      destination_location_id: "ng:lga:on:akure-north",
      owner_character_id: "char-1",
      transport_cost_ngn: 20000,
    }, calendarDate);

    const updatedShipment = service.assignVehicleToShipment(
      shipment.shipment_id,
      vehicle.vehicle_id
    );

    assert.ok(updatedShipment);
    assert.strictEqual(updatedShipment.assigned_vehicle_id, vehicle.vehicle_id);
    assert.strictEqual(updatedShipment.status, "assigned");
  });

  test("prevents assigning oversized cargo to vehicle", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "compact_hatchback", // 300kg capacity
    }, calendarDate);

    const shipment = service.createCargoShipment({
      cargo_type: "heavy_machinery",
      quantity_kg: 1000, // Exceeds capacity
      origin_location_id: "ng:lga:on:akure-south",
      destination_location_id: "ng:lga:on:akure-north",
      owner_character_id: "char-1",
      transport_cost_ngn: 50000,
    }, calendarDate);

    assert.throws(() => {
      service.assignVehicleToShipment(shipment.shipment_id, vehicle.vehicle_id);
    }, /transportation_cargo_capacity_exceeded/);
  });

  test("issues a driver license successfully", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    
    const license = service.issueDriverLicense({
      character_id: "char-1",
      license_class: "motorcycle",
      validity_years: 5,
      restrictions: [],
    }, calendarDate);

    assert.ok(license);
    assert.strictEqual(license.character_id, "char-1");
    assert.strictEqual(license.license_class, "motorcycle");
    assert.strictEqual(license.is_valid, true);
  });

  test("checks valid driver license", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    
    service.issueDriverLicense({
      character_id: "char-1",
      license_class: "motorcycle",
      validity_years: 5,
    }, calendarDate);

    const hasLicense = service.hasValidLicense("char-1", "motorcycle");
    assert.strictEqual(hasLicense, true);

    const hasInvalidLicense = service.hasValidLicense("char-1", "heavy_truck");
    assert.strictEqual(hasInvalidLicense, false);
  });

  test("finds route between connected nodes", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const route = service.findRoute("node_akure_center", "node_akure_north");
    
    assert.ok(route);
    assert.ok(route.path.length > 0);
    assert.ok(route.distance_km > 0);
    assert.ok(route.estimated_time_minutes > 0);
  });

  test("returns null for disconnected route", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    // Create an isolated node
    maps.roadNodes["node_isolated"] = {
      node_id: "node_isolated",
      location_id: "ng:lga:on:akure-south",
      position: { x: 0, y: 0 },
      geographic_coordinate: null,
      elevation_m: 300,
      is_intersection: false,
      connected_nodes: [],
    };

    const route = service.findRoute("node_akure_center", "node_isolated");
    assert.strictEqual(route, null);
  });

  test("respects vehicle restrictions in routing", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    // Try to find route for bicycle on expressway (which restricts bicycles)
    const route = service.findRoute(
      "node_akure_north",
      "node_akure_highway_north",
      "bicycle"
    );
    
    // Should return null because the only path goes through an expressway
    assert.strictEqual(route, null);
  });

  test("retrieves facilities by type", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const fuelStations = service.getFacilitiesByType("fuel_station");
    assert.ok(fuelStations.length > 0);
    assert.strictEqual(fuelStations[0].facility_type, "fuel_station");
  });

  test("retrieves active routes", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const activeRoutes = service.getActiveRoutes();
    assert.ok(activeRoutes.length > 0);
    assert.ok(activeRoutes.every(r => r.is_active));
  });

  test("retrieves routes by transport mode", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const busRoutes = service.getRoutesByMode("public_bus");
    assert.ok(busRoutes.length > 0);
    assert.ok(busRoutes.every(r => r.mode === "public_bus"));
  });

  test("updates vehicle status", () => {
    const maps = emptyTransportationMaps();
    const service = new TransportationService(maps);
    
    const vehicle = service.purchaseVehicle({
      buyer_character_id: "char-1",
      vehicle_definition_id: "motorcycle_basic",
    }, calendarDate);

    service.updateVehicleStatus(vehicle.vehicle_id, "maintenance");
    
    const updatedVehicle = service.getOwnedVehicle(vehicle.vehicle_id);
    assert.strictEqual(updatedVehicle.status, "maintenance");
  });

  test("updates shipment status correctly", () => {
    const maps = emptyTransportationMaps();
    initializeTransportationWorldState(maps, calendarDate);
    const service = new TransportationService(maps);
    
    const shipment = service.createCargoShipment({
      cargo_type: "food",
      quantity_kg: 200,
      origin_location_id: "ng:lga:on:akure-south",
      destination_location_id: "ng:lga:on:akure-north",
      owner_character_id: "char-1",
      transport_cost_ngn: 10000,
    }, calendarDate);

    const inTransit = service.updateShipmentStatus(shipment.shipment_id, "in_transit");
    assert.strictEqual(inTransit.status, "in_transit");
    assert.ok(inTransit.pickup_date);

    const delivered = service.updateShipmentStatus(shipment.shipment_id, "delivered");
    assert.strictEqual(delivered.status, "delivered");
    assert.ok(delivered.delivery_date);
  });

  test("catalog calculates fuel cost correctly", () => {
    const catalog = new TransportationCatalogService();
    const cost = catalog.calculateFuelCost("petrol", 20);
    assert.strictEqual(cost, 20 * 750); // 20 liters * 750 NGN/liter
  });

  test("catalog calculates fare correctly", () => {
    const catalog = new TransportationCatalogService();
    const fare = catalog.calculateFare(10, "public_bus", 200);
    assert.strictEqual(fare, 200 + 10 * 50); // base fare + (distance * cost per km)
  });

  test("catalog calculates travel time correctly", () => {
    const catalog = new TransportationCatalogService();
    const time = catalog.calculateTravelTime(50, "public_bus");
    assert.strictEqual(time, Math.round((50 / 40) * 60)); // 50km at 40 km/h
  });
});
