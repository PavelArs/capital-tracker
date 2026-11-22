-- Synthetic acceptance credentials only. The backend's runtime role, created the way the owner
-- creates it on the server (scripts/db-app-role-install.sh): it logs in and holds no
-- administrative attribute. migrate.js grants it data access (DB_APP_USERNAME).
CREATE ROLE capital_e2e_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'capital_e2e_app';
