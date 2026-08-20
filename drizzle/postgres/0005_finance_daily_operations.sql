ALTER TABLE cashboxes ADD COLUMN opening_balance_kopecks integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE cashboxes c SET opening_balance_kopecks = c.balance_kopecks - COALESCE((
  SELECT SUM(CASE
    WHEN ft.type IN ('INCOME','REFUND') AND ft.cashbox_id=c.id THEN ft.amount_kopecks
    WHEN ft.type='EXPENSE' AND ft.cashbox_id=c.id THEN -ft.amount_kopecks
    WHEN ft.type='TRANSFER' AND ft.cashbox_id=c.id THEN -ft.amount_kopecks
    WHEN ft.type='TRANSFER' AND ft.destination_cashbox_id=c.id THEN ft.amount_kopecks
    ELSE 0 END)
  FROM financial_transactions ft
  WHERE ft.cashbox_id=c.id OR ft.destination_cashbox_id=c.id
),0);
--> statement-breakpoint
UPDATE financial_transactions SET category=CASE category
  WHEN 'Материалы' THEN 'MATERIALS'
  WHEN 'Работа / подряд' THEN 'CONTRACTOR_WORK'
  WHEN 'Доставка и логистика' THEN 'DELIVERY'
  WHEN 'Аренда оборудования' THEN 'EQUIPMENT_RENTAL'
  WHEN 'Переделка / брак' THEN 'REWORK'
  WHEN 'Прочее' THEN 'OTHER'
  WHEN 'Реклама' THEN 'ADVERTISING'
  WHEN 'Офис' THEN 'OFFICE'
  WHEN 'Бухгалтерия' THEN 'ACCOUNTING'
  WHEN 'Программное обеспечение' THEN 'SOFTWARE'
  WHEN 'Инструмент' THEN 'TOOLS'
  WHEN 'Транспорт' THEN 'TRANSPORT'
  WHEN 'Связь' THEN 'COMMUNICATION'
  ELSE category END
WHERE type='EXPENSE';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_allocations_transaction_project ON transaction_allocations(transaction_id,project_id);
--> statement-breakpoint
ALTER TABLE transaction_allocations ADD CONSTRAINT transaction_allocations_amount_check CHECK (amount_kopecks>0);
--> statement-breakpoint
CREATE INDEX idx_transactions_type_date ON financial_transactions(type,transaction_date);
--> statement-breakpoint
CREATE INDEX idx_transactions_category_date ON financial_transactions(category,transaction_date);
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_expense_shape_check CHECK (
  type <> 'EXPENSE' OR expense_type IN ('PROJECT','ADMIN')
);
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_transfer_shape_check CHECK (
  type <> 'TRANSFER' OR (destination_cashbox_id IS NOT NULL AND destination_cashbox_id <> cashbox_id AND project_id IS NULL AND client_id IS NULL)
);
--> statement-breakpoint
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_admin_shape_check CHECK (
  expense_type <> 'ADMIN' OR (project_id IS NULL AND client_id IS NULL AND show_to_client=0)
);
