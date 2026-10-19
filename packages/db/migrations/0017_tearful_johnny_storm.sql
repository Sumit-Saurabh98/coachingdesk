CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"file_key" text,
	"byte_size" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_exports_status_check" CHECK ("data_exports"."status" in ('queued', 'running', 'ready', 'failed', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "institutes" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_exports_one_in_progress_idx" ON "data_exports" USING btree ("institute_id") WHERE "data_exports"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "data_exports_institute_created_idx" ON "data_exports" USING btree ("institute_id","created_at");--> statement-breakpoint
CREATE INDEX "data_exports_status_created_idx" ON "data_exports" USING btree ("status","created_at");