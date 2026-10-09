# Stage 9 — Housing and Property System

> **Future agents: read this file before changing the property system.** It documents the implemented housing and property simulation, its integration with Stage 6 (careers), Stage 7 (economy), and Stage 8 (businesses), and the boundaries that later stages (government, land registry, etc.) must respect.

## Scope

Stage 9 adds a configurable housing and property system where players can purchase, rent, sell, manage, furnish, and maintain properties within the shared Nigerian world. Properties connect to Stage 7 (economy) for financial operations and Stage 8 (businesses) for commercial property compatibility. It is implemented inside the same `nigeria-main` world and does not introduce a second property or payment system.

### Implemented

- **Property catalogue:** Configurable templates across 4 categories (residential, commercial, land, public) with 19 property types, 10 seed locations, 10 seed properties, and 10 furniture items.
- **Property types:** Single rooms, self-contained, studios, 1–3 bedroom apartments, bungalows, detached houses, duplexes, small shops, market stalls, offices, restaurants, warehouses, workshops, residential plots, commercial plots, agricultural land, and government buildings (not purchasable).
- **Property locations:** 10 configurable locations across Akure, Lagos, Abuja, Ibadan, Enugu, Kano, and Benin City with price/rent multipliers and demand levels.
- **Property ownership:** Player, NPC, business, government, community, and joint ownership types. Server-side authorization on every action.
- **Property marketplace:** Browse, filter by location/category/listing type/price/bedrooms/condition. Separate sale and rent listings.
- **Property purchase:** Atomic purchase flow with funds deduction, ownership transfer, and sale recording. Idempotent against duplicate requests.
- **Property sales listing:** Owners can list owned properties for sale with configurable asking prices within rule bounds.
- **Rental system:** Rental listings, agreements, and payment processing. Deposits, rent periods, and tenant limits enforced. Rent payments integrate with Stage 7 economy.
- **Rental termination:** Tenants or landlords can terminate agreements, re-listing the property for rent.
- **Property maintenance:** Owners can record maintenance events that update property condition and charge the owner.
- **Furnishing:** Owners can purchase and place furniture items from the catalogue, with quantity tracking and space limits.
- **Ownership transfer:** Free transfer of property between characters.
- **NPC property seeding:** 10 seed properties with NPC owners, pre-populated on first world initialization.
- **Character snapshot integration:** Property profiles and rental agreements included in authenticated character snapshots.
- **Schema v6 persistence:** `PersistentWorldState` upgraded from schema 5 to schema 6, adding nine new property maps. Schema 1–5 states auto-migrate to v6.

### Not implemented

- No player-to-player offer, negotiation, escrow, or bidding system.
- No construction simulation (building on land parcels).
- No utilities simulation (water, electricity billing).
- No property tax system.
- No government land registry integration.
- No advanced zoning or land-use regulations.
- No NPC autonomous property trading or market simulation.
- No mortgage/financing system.
- No insurance system.
- No inheritance of property through the life/death system.
- Godot client/runtime verification remains blocked (same as Stages 1–8).

## Data boundaries

The property catalogue and rules are stored in `game/data/properties/catalog.json`. Runtime state lives in `world-state.json` alongside all other stage data. No separate property database or duplicate financial system is created.

- **Property types:** Template definitions with category, model, premises type, capacity, and age rules.
- **Property locations:** Configurable price/rent multipliers and demand levels.
- **Property rules:** Age limits (18+), max properties per character (10), max land (5), max active rentals per tenant (3), price/rent bounds, deposit bounds, furniture limits, maintenance limits.
- **Seed data:** 10 pre-configured properties with NPC owners for initial marketplace population.

## Persistence

Stage 9 adds nine new maps to `PersistentWorldState` under schema version 6:

| Map | Purpose |
|---|---|
| `properties` | Property records (type, location, condition, amenities, status). |
| `propertyOwnership` | Ownership records (owner, share, acquisition, status). |
| `propertyListings` | Active sale/rent listings with prices and availability. |
| `rentalAgreements` | Tenant-landlord rental contracts with payment history. |
| `rentalPayments` | Individual rent payment records. |
| `propertySales` | Completed sale transactions. |
| `propertyMaintenance` | Maintenance/repair records with condition changes. |
| `propertyFurnishings` | Placed furniture items with quantities. |
| `propertyEvents` | Audit log of property lifecycle events. |

Schema versions 1–5 auto-migrate to version 6 with empty property maps.

## WebSocket API

The server accepts `property.action` commands over the existing authenticated WebSocket session.

| Action | Description |
|---|---|
| `market` | Browse available property listings with optional filters (location, category, listing_type, min/max price, min bedrooms, condition). |
| `view` | View a full property profile by property ID. |
| `my_properties` | List properties the character owns. |
| `my_rentals` | List rental agreements where the character is the tenant. |
| `purchase` | Purchase a property from a sale listing. |
| `list_for_sale` | List an owned property for sale. |
| `list_for_rent` | List an owned property for rent. |
| `rent` | Enter a rental agreement from a rent listing. |
| `pay_rent` | Make a recurring rent payment on an active agreement. |
| `terminate_rental` | Terminate a rental agreement (tenant or landlord). |
| `maintain` | Record maintenance and update property condition. |
| `furnish` | Purchase and place furniture in an owned property. |
| `remove_furnishing` | Remove a placed furniture item. |
| `transfer` | Transfer property ownership to another character. |

## Checks

```sh
npm run check                    # lint + 105 Node tests (48 retained + 16 economy + 22 business + 19 property)
node --test services/world-api/test/properties.test.mjs   # focused Stage 9 suite
```
