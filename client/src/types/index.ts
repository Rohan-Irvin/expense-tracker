// Mirror of server types used by the frontend

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
}

export interface CategoryWithChildren extends Category {
  children: Category[];
}

export interface Account {
  id: number;
  name: string;
  currency: 'AUD' | 'USD';
  created_at: string;
}

export interface ColumnMap {
  hasHeader: boolean;
  date: string;
  amount_type: 'single' | 'split';
  amount?: string;
  debit?: string;
  credit?: string;
  description: string;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYYMMDD';
  sign_convention?: 'negative_is_debit' | 'positive_is_debit';
}

export interface ImportBatch {
  id: number;
  account_id: number;
  filename: string;
  imported_at: string;
  row_count: number;
  status: 'pending_review' | 'approved' | 'partial';
  column_map: string;
}

export interface Expense {
  id: number;
  batch_id: number;
  account_id: number;
  date: string;
  description: string;
  amount_original: number;
  currency_original: 'AUD' | 'USD';
  exchange_rate: number | null;
  amount_aud: number;
  category_id: number | null;
  subcategory_id: number | null;
  split_parent_id: number | null;
  review_status: 'pending' | 'approved' | 'skipped' | 'split';
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseWithSuggestion extends Expense {
  suggested_category_id: number | null;
  suggested_subcategory_id: number | null;
  confidence: string | null;
  llm_reasoning: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  suggested_category_name: string | null;
  suggested_subcategory_name: string | null;
  children?: Expense[];
}

export interface IncomeEntry {
  id: number;
  date: string;
  source: string;
  amount_original: number;
  currency_original: 'AUD' | 'USD';
  exchange_rate: number | null;
  amount_aud: number;
  entry_type: 'csv_import' | 'manual';
  batch_id: number | null;
  note: string | null;
  category_id: number | null;
  category_name: string | null;
  created_at: string;
}

export interface AmazonOrder {
  id: number;
  order_id: string;
  order_date: string;
  total_owed: number;
  currency: string;
  matched_expense_id: number | null;
  imported_at: string;
  items?: AmazonOrderItem[];
  matched_expense?: Expense | null;
}

export interface AmazonOrderItem {
  id: number;
  order_id: number;
  product_name: string;
  asin: string | null;
  amazon_category: string | null;
  quantity: number;
  unit_price: number;
  item_subtotal: number;
  suggested_category_id: number | null;
  suggested_subcategory_id: number | null;
}

export interface MerchantRule {
  id: number;
  description_pattern: string;
  category_id: number;
  subcategory_id: number | null;
  match_count: number;
  last_matched_at: string;
  created_at: string;
  category_name?: string;
  subcategory_name?: string;
}

export interface AppSettings {
  lm_studio_base_url: string;
  lm_studio_model: string;
  lm_studio_context_length: string;
  default_currency: string;
  llm_batch_size: string;
}

export interface MonthlyTrendPoint {
  month: string;
  total_expenses: number;
  total_income: number;
  savings: number;
}

export interface CategoryBreakdown {
  category_id: number;
  category_name: string;
  subcategory_id: number | null;
  subcategory_name: string | null;
  total_aud: number;
  percentage_of_income: number;
}

export interface DashboardSummary {
  monthly_trend: MonthlyTrendPoint[];
  category_breakdown: CategoryBreakdown[];
  selected_month_total_expenses: number;
  selected_month_total_income: number;
  selected_month_savings: number;
}

export interface CsvParseResult {
  hasHeader: boolean;
  columns: string[];
  sampleRows: Record<string, string>[];
  suggestedMapping: Partial<ColumnMap> | null;
}

export interface SplitRow {
  description: string;
  amount_aud: number;
  category_id: number | null;
  subcategory_id: number | null;
}

export interface MatchResult {
  amazon_order_id: number;
  order_id_text: string;
  expense_id: number;
  confidence: 'high' | 'low';
  date_diff_days: number;
  amount_diff_pct: number;
}
