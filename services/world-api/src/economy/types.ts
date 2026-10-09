import type { CalendarDate } from "../life/types.js";

export type EconomyTransactionKind =
  | "salary_credit"
  | "market_purchase"
  | "bank_deposit"
  | "bank_withdrawal"
  | "bank_transfer"
  | "bank_fee"
  | "bank_interest"
  | "tax_payment"
  | "loan_disbursement"
  | "loan_repayment"
  | "loan_origination_fee"
  | "loan_late_fee"
  | "initial_credit"
  | "clinic_payment"
  | "bus_fare";

export type EconomyAccountKind = "cash" | "savings" | "current" | "fixed_deposit";
export type EconomyLoanStatus = "active" | "paid_off" | "defaulted" | "cancelled";
export type EconomyAccountStatus = "active" | "frozen" | "closed";

export interface EconomyTaxBand {
  readonly id: string;
  readonly label: string;
  readonly minimum_monthly_income_ngn: number;
  readonly maximum_monthly_income_ngn: number;
  readonly rate_percent: number;
}

export interface EconomyBankProduct {
  readonly id: string;
  readonly label: string;
  readonly kind: "savings" | "current" | "fixed_deposit";
  readonly interest_rate_monthly_percent: number;
  readonly minimum_balance_ngn: number;
  readonly monthly_fee_ngn: number;
  readonly withdrawal_fee_ngn: number;
  readonly transfer_fee_ngn: number;
  readonly max_withdrawal_daily_ngn: number;
}

export interface EconomyLoanProduct {
  readonly id: string;
  readonly label: string;
  readonly kind: "personal" | "student" | "business";
  readonly interest_rate_monthly_percent: number;
  readonly maximum_amount_ngn: number;
  readonly maximum_term_months: number;
  readonly minimum_credit_score: number;
  readonly origination_fee_percent: number;
  readonly late_payment_fee_ngn: number;
  readonly requires_employment: boolean;
}

export interface EconomyMarketGood {
  readonly id: string;
  readonly category: string;
  readonly label: string;
  readonly base_price_ngn: number;
  readonly unit: string;
  readonly hunger_restore: number;
  readonly location_ids: readonly string[];
}

export interface EconomyRules {
  readonly currency: string;
  readonly currency_label: string;
  readonly currency_symbol: string;
  readonly maximum_account_balance_ngn: number;
  readonly minimum_account_balance_ngn: number;
  readonly maximum_transaction_amount_ngn: number;
  readonly minimum_transaction_amount_ngn: number;
  readonly maximum_transfer_amount_ngn: number;
  readonly maximum_loan_amount_ngn: number;
  readonly maximum_transaction_history_per_account: number;
  readonly maximum_accounts_per_character: number;
  readonly minimum_credit_score: number;
  readonly maximum_credit_score: number;
  readonly starting_credit_score: number;
  readonly minimum_credit_score_for_loan: number;
  readonly transaction_idempotency_window_seconds: number;
}

export interface EconomyCatalog {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly rules: EconomyRules;
  readonly tax_bands: readonly EconomyTaxBand[];
  readonly bank_products: readonly EconomyBankProduct[];
  readonly loan_products: readonly EconomyLoanProduct[];
  readonly market_goods: readonly EconomyMarketGood[];
}

export interface EconomyAccountRecord {
  readonly account_id: string;
  readonly character_id: string;
  readonly kind: EconomyAccountKind;
  readonly bank_product_id: string | null;
  balance_ngn: number;
  status: EconomyAccountStatus;
  readonly created_at: string;
  readonly created_world_date: CalendarDate;
  updated_at: string;
  readonly opened_world_date: CalendarDate;
  last_interest_date: CalendarDate | null;
  total_deposited_ngn: number;
  total_withdrawn_ngn: number;
  total_fees_paid_ngn: number;
  total_interest_earned_ngn: number;
  daily_withdrawal_total_ngn: number;
  daily_withdrawal_date: CalendarDate | null;
}

export interface EconomyTransactionRecord {
  readonly transaction_id: string;
  readonly account_id: string;
  readonly character_id: string;
  readonly kind: EconomyTransactionKind;
  readonly amount_ngn: number;
  readonly balance_before_ngn: number;
  readonly balance_after_ngn: number;
  readonly fee_ngn: number;
  readonly description: string;
  readonly world_date: CalendarDate;
  readonly minute_of_day: number;
  readonly posted_at: string;
  readonly reference_id: string | null;
  readonly counterparty_account_id: string | null;
  readonly idempotency_key: string;
}

export interface EconomyLoanRecord {
  readonly loan_id: string;
  readonly character_id: string;
  readonly loan_product_id: string;
  readonly principal_ngn: number;
  remaining_principal_ngn: number;
  readonly interest_rate_monthly_percent: number;
  readonly term_months: number;
  readonly monthly_payment_ngn: number;
  readonly origination_fee_ngn: number;
  status: EconomyLoanStatus;
  readonly start_date: CalendarDate;
  readonly end_date: CalendarDate;
  next_payment_date: CalendarDate;
  payments_made: number;
  payments_missed: number;
  total_paid_ngn: number;
  readonly created_at: string;
  updated_at: string;
  readonly disbursement_account_id: string;
}

export interface EconomyCreditScoreRecord {
  readonly character_id: string;
  score: number;
  readonly history: readonly EconomyCreditScoreEntry[];
  updated_at: string;
  readonly updated_world_date: CalendarDate;
}

export interface EconomyCreditScoreEntry {
  readonly score: number;
  readonly reason: string;
  readonly world_date: CalendarDate;
  readonly recorded_at: string;
}

export interface EconomyEventRecord {
  readonly event_id: string;
  readonly character_id: string;
  readonly type: string;
  readonly world_date: CalendarDate;
  readonly minute_of_day: number;
  readonly summary: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  readonly created_at: string;
  readonly account_id?: string;
  readonly loan_id?: string;
  readonly transaction_id?: string;
}

export interface PersistentEconomyMaps {
  economyAccounts: Record<string, EconomyAccountRecord>;
  economyTransactions: Record<string, EconomyTransactionRecord>;
  economyLoans: Record<string, EconomyLoanRecord>;
  economyCreditScores: Record<string, EconomyCreditScoreRecord>;
  economyEvents: Record<string, EconomyEventRecord>;
}

export interface EconomyAccountSnapshot {
  readonly account_id: string;
  readonly kind: EconomyAccountKind;
  readonly bank_product_id: string | null;
  readonly bank_product_label: string | null;
  readonly balance_ngn: number;
  readonly status: EconomyAccountStatus;
  readonly created_world_date: CalendarDate;
  readonly total_deposited_ngn: number;
  readonly total_withdrawn_ngn: number;
  readonly total_fees_paid_ngn: number;
  readonly total_interest_earned_ngn: number;
  readonly interest_rate_monthly_percent: number;
}

export interface EconomyLoanSnapshot {
  readonly loan_id: string;
  readonly loan_product_id: string;
  readonly loan_product_label: string;
  readonly principal_ngn: number;
  readonly remaining_principal_ngn: number;
  readonly interest_rate_monthly_percent: number;
  readonly term_months: number;
  readonly monthly_payment_ngn: number;
  readonly status: EconomyLoanStatus;
  readonly start_date: CalendarDate;
  readonly end_date: CalendarDate;
  readonly next_payment_date: CalendarDate;
  readonly payments_made: number;
  readonly payments_missed: number;
  readonly total_paid_ngn: number;
}

export interface EconomyProfileSnapshot {
  readonly schema_version: 1;
  readonly character_id: string;
  readonly currency: string;
  readonly currency_label: string;
  readonly currency_symbol: string;
  readonly cash_balance_ngn: number;
  readonly total_bank_balance_ngn: number;
  readonly total_wealth_ngn: number;
  readonly credit_score: number;
  readonly accounts: readonly EconomyAccountSnapshot[];
  readonly loans: readonly EconomyLoanSnapshot[];
  readonly recent_transactions: readonly EconomyTransactionRecord[];
  readonly events: readonly EconomyEventRecord[];
}
