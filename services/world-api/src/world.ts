/**
 * Metadata for the one logical Nigeria.
 * The current bounded simulation is a prototype, not full national game state.
 */
export const worldDescriptor = Object.freeze({
  id: "nigeria-main",
  name: "Nigeria",
  projectName: "Naija: One World",
  topology: "single-logical-world",
  implementationStage: 8,
  simulationImplemented: true,
  simulationScope: "bounded-multiplayer-prototype",
  geographyImplemented: true,
  educationImplemented: true,
  educationScope: "fictional-configurable-education-prototype",
  lifeSimulationImplemented: true,
  lifeSimulationScope: "configurable-calendar-family-relationships-and-life-history-foundation",
  careersImplemented: true,
  careersScope: "server-authoritative-configurable-vacancies-employment-work-sessions-and-payroll-prototype",
  economyImplemented: true,
  economyScope: "naira-denominated-ledger-banking-market-goods-tax-estimation-and-credit-prototype",
  businessesImplemented: true,
  businessesScope: "configurable-business-templates-products-inventory-sales-production-expenses-and-ownership-prototype",
  geographicCoverage: "national-admin-registry-plus-bounded-akure-south-sample",
  fullNationalGeography: false,
  fullNationalSimulation: false,
} as const);
