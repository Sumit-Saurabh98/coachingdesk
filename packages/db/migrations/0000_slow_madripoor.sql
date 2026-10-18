CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"device_info" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_locale_check" CHECK ("users"."locale" in ('en', 'hi'))
);
--> statement-breakpoint
CREATE TABLE "institutes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"city" text,
	"logo_url" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"billing_day" smallint DEFAULT 1 NOT NULL,
	"due_after_days" smallint DEFAULT 6 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payout_account_id" text,
	"payout_status" text DEFAULT 'not_started' NOT NULL,
	"upi_vpa" text,
	"messaging_paused_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "institutes_type_check" CHECK ("institutes"."type" in ('tuition', 'academy', 'home_tutor')),
	CONSTRAINT "institutes_billing_day_check" CHECK ("institutes"."billing_day" between 1 and 28),
	CONSTRAINT "institutes_payout_status_check" CHECK ("institutes"."payout_status" in ('not_started', 'pending', 'active', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"institute_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"batch_scope" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_institute_id_user_id_pk" PRIMARY KEY("institute_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('owner', 'teacher', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutes" ADD CONSTRAINT "institutes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");