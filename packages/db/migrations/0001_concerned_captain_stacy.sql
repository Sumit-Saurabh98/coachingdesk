CREATE TABLE "subscriptions" (
	"institute_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"interval" text,
	"provider" text,
	"provider_sub_id" text,
	"current_period_end" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_plan_check" CHECK ("subscriptions"."plan" in ('free', 'starter', 'pro', 'academy')),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('trialing', 'active', 'past_due', 'cancelled', 'free')),
	CONSTRAINT "subscriptions_interval_check" CHECK ("subscriptions"."interval" is null or "subscriptions"."interval" in ('month', 'year')),
	CONSTRAINT "subscriptions_period_end_check" CHECK ("subscriptions"."status" not in ('trialing', 'active', 'past_due') or "subscriptions"."current_period_end" is not null)
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;