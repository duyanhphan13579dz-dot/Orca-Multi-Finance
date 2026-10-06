-- W4: personal finance sync blob on user_preferences
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS personal_finance jsonb;
