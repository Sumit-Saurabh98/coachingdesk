CREATE TABLE "attendance_records" (
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"institute_id" uuid NOT NULL,
	"status" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_session_id_student_id_pk" PRIMARY KEY("session_id","student_id"),
	CONSTRAINT "attendance_records_status_check" CHECK ("attendance_records"."status" in ('present', 'absent', 'late', 'leave'))
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"taken_by" uuid,
	"submitted_at" timestamp with time zone NOT NULL,
	"alerts_enqueued_at" timestamp with time zone,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_sessions_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "attendance_sessions_batch_date_unique" UNIQUE("batch_id","date"),
	CONSTRAINT "attendance_sessions_institute_id_id_unique" UNIQUE("institute_id","id")
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_same_institute_fk" FOREIGN KEY ("institute_id","session_id") REFERENCES "public"."attendance_sessions"("institute_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_same_institute_fk" FOREIGN KEY ("institute_id","student_id") REFERENCES "public"."students"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_batch_same_institute_fk" FOREIGN KEY ("institute_id","batch_id") REFERENCES "public"."batches"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_records_institute_student_idx" ON "attendance_records" USING btree ("institute_id","student_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_institute_date_idx" ON "attendance_sessions" USING btree ("institute_id","date");