CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"fee_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"fee_cycle" text NOT NULL,
	"cycle_anchor" date,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_student_batch_start_unique" UNIQUE("student_id","batch_id","start_date"),
	CONSTRAINT "enrollments_fee_cycle_check" CHECK ("enrollments"."fee_cycle" in ('monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time', 'none')),
	CONSTRAINT "enrollments_fee_paise_check" CHECK ("enrollments"."fee_paise" >= 0),
	CONSTRAINT "enrollments_discount_paise_check" CHECK ("enrollments"."discount_paise" >= 0 and "enrollments"."discount_paise" <= "enrollments"."fee_paise"),
	CONSTRAINT "enrollments_end_after_start_check" CHECK ("enrollments"."end_date" is null or "enrollments"."end_date" >= "enrollments"."start_date")
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_same_institute_fk" FOREIGN KEY ("institute_id","student_id") REFERENCES "public"."students"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_batch_same_institute_fk" FOREIGN KEY ("institute_id","batch_id") REFERENCES "public"."batches"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_one_open_per_student_batch" ON "enrollments" USING btree ("student_id","batch_id") WHERE "enrollments"."end_date" is null;--> statement-breakpoint
CREATE INDEX "enrollments_institute_batch_idx" ON "enrollments" USING btree ("institute_id","batch_id");--> statement-breakpoint
CREATE INDEX "enrollments_institute_student_idx" ON "enrollments" USING btree ("institute_id","student_id");