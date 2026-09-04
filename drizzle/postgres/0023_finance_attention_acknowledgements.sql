CREATE TABLE finance_attention_acknowledgements (
  id text PRIMARY KEY,
  transaction_id text NOT NULL,
  issue_type text NOT NULL,
  status text NOT NULL,
  previous_status text NOT NULL,
  accepted_by_user_id text NOT NULL,
  accepted_at integer NOT NULL,
  acceptance_comment text,
  reverted_by_user_id text,
  reverted_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT finance_attention_acknowledgements_transaction_fkey FOREIGN KEY(transaction_id) REFERENCES financial_transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT finance_attention_acknowledgements_accepted_by_fkey FOREIGN KEY(accepted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT finance_attention_acknowledgements_reverted_by_fkey FOREIGN KEY(reverted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT finance_attention_acknowledgements_transaction_issue_unique UNIQUE(transaction_id, issue_type),
  CONSTRAINT finance_attention_acknowledgements_status_check CHECK(status IN ('OPEN','ACCEPTED')),
  CONSTRAINT finance_attention_acknowledgements_previous_status_check CHECK(previous_status IN ('OPEN','ACCEPTED')),
  CONSTRAINT finance_attention_acknowledgements_comment_check CHECK(acceptance_comment IS NULL OR length(acceptance_comment) <= 1000),
  CONSTRAINT finance_attention_acknowledgements_state_check CHECK(
    (status='ACCEPTED' AND reverted_by_user_id IS NULL AND reverted_at IS NULL) OR
    (status='OPEN' AND reverted_by_user_id IS NOT NULL AND reverted_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX idx_finance_attention_acknowledgements_transaction ON finance_attention_acknowledgements(transaction_id);
--> statement-breakpoint
CREATE INDEX idx_finance_attention_acknowledgements_status ON finance_attention_acknowledgements(status, issue_type);
