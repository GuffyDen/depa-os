CREATE TABLE investment_accounts (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  name text NOT NULL,
  currency text DEFAULT 'RUB' NOT NULL,
  status text DEFAULT 'ACTIVE' NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT investment_accounts_owner_user_id_fkey FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT investment_accounts_owner_user_id_unique UNIQUE(owner_user_id),
  CONSTRAINT investment_accounts_status_check CHECK(status IN ('ACTIVE','INACTIVE')),
  CONSTRAINT investment_accounts_name_check CHECK(length(trim(name)) > 0)
);
--> statement-breakpoint
CREATE INDEX idx_investment_accounts_status ON investment_accounts(status);
--> statement-breakpoint
INSERT INTO investment_accounts(id,owner_user_id,name,currency,status,created_at,updated_at)
SELECT 'investment_account_' || id,id,
  CASE id WHEN 'user_owner_denis' THEN 'Инвестиция Дениса' ELSE 'Инвестиция Павла' END,
  'RUB','ACTIVE',CAST(EXTRACT(EPOCH FROM NOW()) AS integer),CAST(EXTRACT(EPOCH FROM NOW()) AS integer)
FROM users WHERE id IN ('user_owner_denis','user_owner_pavel') AND role='OWNER' AND status='ACTIVE'
ON CONFLICT(owner_user_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE financial_transactions ALTER COLUMN cashbox_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD COLUMN investment_account_id text;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_investment_account_id_fkey FOREIGN KEY(investment_account_id) REFERENCES investment_accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_transactions_investment_date ON financial_transactions(investment_account_id,transaction_date);
--> statement-breakpoint
ALTER TABLE financial_transactions DROP CONSTRAINT IF EXISTS financial_transactions_expense_shape_check;
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_expense_shape_check CHECK (
  type <> 'EXPENSE' OR (
    expense_type IN ('PROJECT','ADMIN') AND
    ((cashbox_id IS NOT NULL AND investment_account_id IS NULL) OR (cashbox_id IS NULL AND investment_account_id IS NOT NULL))
  )
);
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_source_shape_check CHECK (
  (type='EXPENSE') OR
  (type='INVESTMENT_REPAYMENT' AND cashbox_id IS NOT NULL AND investment_account_id IS NOT NULL) OR
  (type NOT IN ('EXPENSE','INVESTMENT_REPAYMENT') AND cashbox_id IS NOT NULL AND investment_account_id IS NULL)
);
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_investment_repayment_shape_check CHECK (
  type <> 'INVESTMENT_REPAYMENT' OR (destination_cashbox_id IS NULL AND project_id IS NULL AND client_id IS NULL AND order_id IS NULL AND original_transaction_id IS NULL AND show_to_client=0)
);
--> statement-breakpoint
CREATE TABLE investment_movements (
  id text PRIMARY KEY,
  investment_account_id text NOT NULL,
  financial_transaction_id text NOT NULL,
  type text NOT NULL,
  amount_kopecks integer NOT NULL,
  transaction_date integer NOT NULL,
  source_cashbox_id text,
  note text,
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT investment_movements_account_fkey FOREIGN KEY(investment_account_id) REFERENCES investment_accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT investment_movements_transaction_fkey FOREIGN KEY(financial_transaction_id) REFERENCES financial_transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT investment_movements_source_cashbox_fkey FOREIGN KEY(source_cashbox_id) REFERENCES cashboxes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT investment_movements_created_by_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT investment_movements_transaction_unique UNIQUE(financial_transaction_id),
  CONSTRAINT investment_movements_type_check CHECK(type IN ('CONTRIBUTION','REPAYMENT')),
  CONSTRAINT investment_movements_amount_check CHECK(amount_kopecks > 0),
  CONSTRAINT investment_movements_shape_check CHECK((type='CONTRIBUTION' AND source_cashbox_id IS NULL) OR (type='REPAYMENT' AND source_cashbox_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX idx_investment_movements_account_date ON investment_movements(investment_account_id,transaction_date);
--> statement-breakpoint
CREATE INDEX idx_investment_movements_source_cashbox ON investment_movements(source_cashbox_id);
