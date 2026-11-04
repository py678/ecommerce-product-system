-- Preserve existing accounts' ability to manage their own products.
-- Future registrations retain the VIEWER column default.
UPDATE "users" SET "role" = 'OPERATOR'::"UserRole";
