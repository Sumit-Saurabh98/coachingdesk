DROP INDEX "students_institute_name_idx";--> statement-breakpoint
CREATE INDEX "students_institute_name_c_idx" ON "students" USING btree ("institute_id",(lower("name") collate "C"),"id");