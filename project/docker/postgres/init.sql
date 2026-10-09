-- ============================================================================
-- ANDX Web2 Assessment - Database Schemas & Optimization Indexes
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS api;
CREATE SCHEMA IF NOT EXISTS aggregator;
CREATE SCHEMA IF NOT EXISTS earnings;
CREATE SCHEMA IF NOT EXISTS classifier;

-- 1. api.campaigns
CREATE TABLE IF NOT EXISTS api.campaigns (
    campaign_id VARCHAR(32) PRIMARY KEY,
    brand VARCHAR(128) NOT NULL,
    cpm_cents INT NOT NULL,
    per_clip_cap_cents INT NOT NULL,
    budget_cents BIGINT NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. aggregator
CREATE TABLE IF NOT EXISTS aggregator.snapshots (
    clip_id VARCHAR(32) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    views BIGINT NOT NULL,
    campaign_id VARCHAR(32) NOT NULL,
    event_id VARCHAR(64) NOT NULL,
    PRIMARY KEY (clip_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_topclips 
    ON aggregator.snapshots (clip_id, observed_at DESC) 
    INCLUDE (views);

CREATE INDEX IF NOT EXISTS idx_snapshots_campaign_obs 
    ON aggregator.snapshots (campaign_id, observed_at);

CREATE TABLE IF NOT EXISTS aggregator.clip_state (
    clip_id VARCHAR(32) PRIMARY KEY,
    campaign_id VARCHAR(32) NOT NULL,
    creator_id VARCHAR(32) NOT NULL,
    v_end_at BIGINT NOT NULL DEFAULT 0,
    latest_observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) WITH (fillfactor = 70);

CREATE INDEX IF NOT EXISTS idx_clip_state_campaign 
    ON aggregator.clip_state (campaign_id);

CREATE TABLE IF NOT EXISTS aggregator.outbox_clip_views (
    id BIGSERIAL PRIMARY KEY,
    clip_id VARCHAR(32) NOT NULL,
    campaign_id VARCHAR(32) NOT NULL,
    creator_id VARCHAR(32) NOT NULL,
    observed_ms BIGINT NOT NULL,
    views BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) WITH (fillfactor = 70);

CREATE INDEX IF NOT EXISTS idx_outbox_pending 
    ON aggregator.outbox_clip_views (id) 
    WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS aggregator.dlq_entries (
    identity VARCHAR(64) PRIMARY KEY,
    reason VARCHAR(32) NOT NULL,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_reason 
    ON aggregator.dlq_entries (reason);

CREATE TABLE IF NOT EXISTS aggregator.stats (
    metric_name VARCHAR(64) PRIMARY KEY,
    metric_value BIGINT NOT NULL DEFAULT 0
);

INSERT INTO aggregator.stats (metric_name, metric_value)
VALUES 
    ('distinct_valid_events', 0),
    ('late_dropped', 0)
ON CONFLICT (metric_name) DO NOTHING;

-- 3. earnings
CREATE TABLE IF NOT EXISTS earnings.campaign_spend (
    campaign_id VARCHAR(32) PRIMARY KEY,
    budget_cents BIGINT NOT NULL,
    cpm_cents INT NOT NULL,
    per_clip_cap_cents INT NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    raw_earnings_cents BIGINT NOT NULL DEFAULT 0,
    spend_cents BIGINT NOT NULL DEFAULT 0,
    budget_exhausted BOOLEAN NOT NULL DEFAULT FALSE,
    paid_clips INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS earnings.clip_earnings (
    clip_id VARCHAR(32) PRIMARY KEY,
    campaign_id VARCHAR(32) NOT NULL,
    creator_id VARCHAR(32) NOT NULL,
    earned_cents BIGINT NOT NULL DEFAULT 0,
    paid_cents BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clip_earnings_campaign 
    ON earnings.clip_earnings (campaign_id);

CREATE INDEX IF NOT EXISTS idx_clip_earnings_creator 
    ON earnings.clip_earnings (creator_id, campaign_id);

-- 4. classifier
CREATE TABLE IF NOT EXISTS classifier.clip_relevance (
    clip_id VARCHAR(32) PRIMARY KEY,
    campaign_id VARCHAR(32) NOT NULL,
    on_brief BOOLEAN NOT NULL,
    score REAL NOT NULL,
    model VARCHAR(64) NOT NULL,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
