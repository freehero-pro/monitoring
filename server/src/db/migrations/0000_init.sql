CREATE TYPE "public"."check_outcome" AS ENUM('ok', 'degraded', 'fail');--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('unknown', 'up', 'degraded', 'down');--> statement-breakpoint
CREATE TYPE "public"."error_kind" AS ENUM('dns', 'connect', 'tls', 'timeout', 'http', 'assertion', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TABLE "check_channels" (
	"check_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	CONSTRAINT "check_channels_check_id_channel_id_pk" PRIMARY KEY("check_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "check_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"check_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "check_outcome" NOT NULL,
	"status_code" integer,
	"error_kind" "error_kind",
	"error_message" text,
	"dns_ms" integer,
	"connect_ms" integer,
	"tls_ms" integer,
	"ttfb_ms" integer,
	"total_ms" integer NOT NULL,
	"response_bytes" integer,
	"attempts" integer DEFAULT 1 NOT NULL,
	"failed_assertion" jsonb
);
--> statement-breakpoint
CREATE TABLE "check_stats_hourly" (
	"check_id" uuid NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"total" integer NOT NULL,
	"ok_count" integer NOT NULL,
	"degraded_count" integer NOT NULL,
	"fail_count" integer NOT NULL,
	"p50_ms" real,
	"p95_ms" real,
	"avg_ms" real,
	"max_ms" integer,
	CONSTRAINT "check_stats_hourly_check_id_bucket_pk" PRIMARY KEY("check_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body" text,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"retries" integer DEFAULT 1 NOT NULL,
	"follow_redirects" boolean DEFAULT true NOT NULL,
	"insecure_skip_tls_verify" boolean DEFAULT false NOT NULL,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"degraded_threshold_ms" integer,
	"failure_threshold" integer DEFAULT 2 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_status" "check_status" DEFAULT 'unknown' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"first_error_kind" "error_kind",
	"last_error_message" text,
	"failed_results_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'webhook' NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"events" jsonb DEFAULT '["incident.opened","incident.resolved"]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "tls_certificates" (
	"check_id" uuid PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"issuer" text,
	"subject" text,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"days_remaining" integer,
	"error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"incident_id" uuid,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status_code" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "check_channels" ADD CONSTRAINT "check_channels_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_channels" ADD CONSTRAINT "check_channels_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_stats_hourly" ADD CONSTRAINT "check_stats_hourly_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD CONSTRAINT "login_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_certificates" ADD CONSTRAINT "tls_certificates_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_results_check_time_idx" ON "check_results" USING btree ("check_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "checks_due_idx" ON "checks" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "incidents_check_started_idx" ON "incidents" USING btree ("check_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "login_tokens_hash_key" ON "login_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_idx" ON "webhook_deliveries" USING btree ("created_at" DESC NULLS LAST);