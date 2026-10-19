CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"schedule" jsonb NOT NULL,
	"default_fee_paise" bigint DEFAULT 0 NOT NULL,
	"default_fee_cycle" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_default_fee_cycle_check" CHECK ("batches"."default_fee_cycle" in ('monthly', 'quarterly', 'one_time', 'none')),
	CONSTRAINT "batches_default_fee_paise_check" CHECK ("batches"."default_fee_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_institute_id_active_idx" ON "batches" USING btree ("institute_id") WHERE "batches"."archived_at" is null;