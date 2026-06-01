-- ═══════════════════════════════════════════════════════════════════════════════
-- EWS Notification Database — Full Schema for Turso
-- 
-- Upload this file when creating your Turso database.
-- It consolidates all migrations (0001–0008) into a single script.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Core Notification Signups ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_signups (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'stripe',
  email_cipher TEXT,
  email_hash TEXT,
  account_email_cipher TEXT,
  account_email_hash TEXT,
  account_email_source TEXT,
  phone_cipher TEXT,
  phone_hash TEXT,
  phone_country TEXT,
  wants_email INTEGER NOT NULL DEFAULT 0,
  wants_sms INTEGER NOT NULL DEFAULT 0,
  sms_consent_at TEXT,
  sms_consent_ip_hash TEXT,
  sms_consent_user_agent_hash TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  stripe_cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  checkout_url TEXT,
  checkout_created_at TEXT,
  checkout_completed_at TEXT,
  current_period_end TEXT,
  canceled_at TEXT,
  contact_redacted_at TEXT,
  sms_opted_out_at TEXT,
  sms_opt_out_source TEXT,
  email_opted_out_at TEXT,
  email_opt_out_source TEXT,
  welcome_email_sent_at TEXT,
  welcome_sms_sent_at TEXT,
  manual_note TEXT,
  admin_history_viewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_signups_status
  ON notification_signups (status);

CREATE INDEX IF NOT EXISTS idx_notification_signups_email_hash
  ON notification_signups (email_hash);

CREATE INDEX IF NOT EXISTS idx_notification_signups_phone_hash
  ON notification_signups (phone_hash);

CREATE INDEX IF NOT EXISTS idx_notification_signups_account_email_hash
  ON notification_signups (account_email_hash);

CREATE INDEX IF NOT EXISTS idx_notification_signups_stripe_checkout
  ON notification_signups (stripe_checkout_session_id);

CREATE INDEX IF NOT EXISTS idx_notification_signups_stripe_subscription
  ON notification_signups (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_notification_signups_source_status
  ON notification_signups (source, status);

-- ─── Notification Alerts ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  level INTEGER,
  slot_key TEXT,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  email_sent_count INTEGER NOT NULL DEFAULT 0,
  sms_sent_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_alerts_kind_created
  ON notification_alerts (kind, created_at);

-- ─── Notification Deliveries ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  subscriber_id TEXT,
  channel TEXT NOT NULL,
  destination_hash TEXT,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  provider_status TEXT,
  error TEXT,
  message_text_cipher TEXT,
  subject TEXT,
  carrier TEXT,
  line_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY (alert_id) REFERENCES notification_alerts (id)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_alert
  ON notification_deliveries (alert_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_subscriber
  ON notification_deliveries (subscriber_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_provider
  ON notification_deliveries (provider_message_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel_status
  ON notification_deliveries (channel, status);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_provider_status
  ON notification_deliveries (provider_status);

-- ─── Notification Meta (key-value store) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Inbound SMS Messages ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_inbound_messages (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  provider_event_id TEXT,
  subscriber_id TEXT,
  channel TEXT NOT NULL DEFAULT 'sms',
  phone_hash TEXT,
  from_phone_hash TEXT,
  from_phone_cipher TEXT,
  to_phone_hash TEXT,
  to_phone_cipher TEXT,
  message_text_cipher TEXT,
  action TEXT,
  status TEXT,
  error TEXT,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT,
  UNIQUE(provider, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_inbound_messages_phone
  ON notification_inbound_messages (phone_hash, received_at);

CREATE INDEX IF NOT EXISTS idx_notification_inbound_messages_subscriber
  ON notification_inbound_messages (subscriber_id, received_at);

CREATE INDEX IF NOT EXISTS idx_notification_inbound_messages_provider_event
  ON notification_inbound_messages (provider, provider_event_id);

-- ─── Renewal Reminders ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_renewal_reminders (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  alert_id TEXT,
  email_hash TEXT,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscriber_id) REFERENCES notification_signups (id),
  FOREIGN KEY (alert_id) REFERENCES notification_alerts (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_renewal_reminders_subscription_period
  ON notification_renewal_reminders (stripe_subscription_id, current_period_end);

CREATE INDEX IF NOT EXISTS idx_notification_renewal_reminders_status
  ON notification_renewal_reminders (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_notification_renewal_reminders_subscriber
  ON notification_renewal_reminders (subscriber_id);
