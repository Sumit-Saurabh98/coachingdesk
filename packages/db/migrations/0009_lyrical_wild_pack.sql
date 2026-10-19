CREATE TABLE "guardian_contacts" (
	"institute_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"opt_in_status" text DEFAULT 'unknown' NOT NULL,
	"opt_in_source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardian_contacts_institute_id_phone_pk" PRIMARY KEY("institute_id","phone"),
	CONSTRAINT "guardian_contacts_opt_in_status_check" CHECK ("guardian_contacts"."opt_in_status" in ('unknown', 'opted_in', 'opted_out'))
);
--> statement-breakpoint
CREATE TABLE "message_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"to_phone" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"template" text NOT NULL,
	"params" jsonb NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"error_message" text,
	"skip_reason" text,
	"priority" smallint NOT NULL,
	"expires_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"related_type" text,
	"related_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_outbox_provider_message_id_unique" UNIQUE("provider_message_id"),
	CONSTRAINT "message_outbox_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "message_outbox_channel_check" CHECK ("message_outbox"."channel" in ('whatsapp', 'sms')),
	CONSTRAINT "message_outbox_locale_check" CHECK ("message_outbox"."locale" in ('en', 'hi')),
	CONSTRAINT "message_outbox_category_check" CHECK ("message_outbox"."category" in ('fee_reminder', 'receipt', 'absence', 'result', 'notice', 'otp')),
	CONSTRAINT "message_outbox_status_check" CHECK ("message_outbox"."status" in ('queued', 'scheduled', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
	CONSTRAINT "message_outbox_priority_check" CHECK ("message_outbox"."priority" between 1 and 4),
	CONSTRAINT "message_outbox_attempts_check" CHECK ("message_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_opt_outs" (
	"phone" text PRIMARY KEY NOT NULL,
	"opted_out_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guardian_contacts" ADD CONSTRAINT "guardian_contacts_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_outbox_due_idx" ON "message_outbox" USING btree ("status","priority","scheduled_for");--> statement-breakpoint
CREATE INDEX "message_outbox_institute_created_idx" ON "message_outbox" USING btree ("institute_id","created_at");