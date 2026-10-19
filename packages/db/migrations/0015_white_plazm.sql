CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"batch_ids" uuid[] NOT NULL,
	"content" jsonb NOT NULL,
	"sent_by" uuid,
	"recipients" integer NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notices_kind_check" CHECK ("notices"."kind" in ('general', 'holiday', 'schedule_change')),
	CONSTRAINT "notices_recipients_check" CHECK ("notices"."recipients" >= 0)
);
--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_institute_day_idx" ON "notices" USING btree ("institute_id","day");