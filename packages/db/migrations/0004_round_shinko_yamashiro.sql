CREATE TABLE "students" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"name" text NOT NULL,
	"guardian_name" text,
	"guardian_phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_on" date NOT NULL,
	"left_on" date,
	"notes" text,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_status_check" CHECK ("students"."status" in ('active', 'left')),
	CONSTRAINT "students_guardian_phone_check" CHECK ("students"."erased_at" is not null or "students"."guardian_phone" is not null),
	CONSTRAINT "students_left_on_check" CHECK (("students"."status" = 'left') = ("students"."left_on" is not null)),
	CONSTRAINT "students_left_after_joined_check" CHECK ("students"."left_on" is null or "students"."left_on" >= "students"."joined_on")
);
--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "students_institute_status_idx" ON "students" USING btree ("institute_id","status");--> statement-breakpoint
CREATE INDEX "students_institute_guardian_phone_idx" ON "students" USING btree ("institute_id","guardian_phone");--> statement-breakpoint
CREATE INDEX "students_institute_name_idx" ON "students" USING btree ("institute_id",lower("name"),"id");