#!/bin/bash
#
# Database Backup & Restore Script
# Usage:
#   ./database-backup.sh backup              - Create new backup
#   ./database-backup.sh restore FILENAME    - Restore from specific backup
#   ./database-backup.sh list                - List available backups
#   ./database-backup.sh cleanup             - Remove old backups (keep last 10)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="$PROJECT_ROOT/backups"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get database credentials from .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

DB_NAME=${DB_NAME:-capital_tracker}
DB_USER=${DB_USERNAME:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}
DB_CONTAINER=${DB_CONTAINER:-capital_tracker_db}

# Create backup directory if not exists
mkdir -p "$BACKUP_DIR"

backup_database() {
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local backup_file="capital-tracker-backup-${timestamp}.sql.gz"
    local backup_path="$BACKUP_DIR/$backup_file"
    
    echo -e "${BLUE}💾 Creating database backup...${NC}"
    echo -e "${BLUE}Database: $DB_NAME${NC}"
    echo -e "${BLUE}Container: $DB_CONTAINER${NC}"
    
    # Check if container exists
    if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
        echo -e "${RED}❌ Container '$DB_CONTAINER' not found or not running${NC}"
        echo -e "${YELLOW}Available containers:${NC}"
        docker ps --format 'table {{.Names}}\t{{.Status}}'
        exit 1
    fi
    
    # Create backup
    docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$backup_path"
    
    local backup_size=$(du -h "$backup_path" | cut -f1)
    echo -e "${GREEN}✅ Backup created: $backup_file${NC}"
    echo -e "${GREEN}   Size: $backup_size${NC}"
    echo -e "${GREEN}   Path: $backup_path${NC}"
}

restore_database() {
    local backup_filename=$1
    
    if [ -z "$backup_filename" ]; then
        echo -e "${RED}❌ Please specify backup filename${NC}"
        echo -e "${YELLOW}Usage: $0 restore FILENAME${NC}"
        list_backups
        exit 1
    fi
    
    local backup_path="$BACKUP_DIR/$backup_filename"
    
    if [ ! -f "$backup_path" ]; then
        echo -e "${RED}❌ Backup file not found: $backup_path${NC}"
        list_backups
        exit 1
    fi
    
    echo -e "${YELLOW}⚠️  WARNING: This will REPLACE the current database!${NC}"
    echo -e "${YELLOW}Database: $DB_NAME${NC}"
    echo -e "${YELLOW}Backup: $backup_filename${NC}"
    read -p "Continue? (yes/no): " -r
    
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        echo -e "${BLUE}ℹ️  Restore cancelled${NC}"
        exit 0
    fi
    
    echo -e "${BLUE}💾 Restoring database from backup...${NC}"
    
    # Check if container exists
    if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
        echo -e "${RED}❌ Container '$DB_CONTAINER' not found or not running${NC}"
        exit 1
    fi
    
    # Terminate existing connections
    echo -e "${BLUE}Terminating existing connections...${NC}"
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" || true
    
    # Drop and recreate database
    echo -e "${BLUE}Recreating database...${NC}"
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" || true
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;"
    
    # Restore from backup
    echo -e "${BLUE}Restoring data...${NC}"
    gunzip -c "$backup_path" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
    
    echo -e "${GREEN}✅ Database restored successfully${NC}"
    echo -e "${GREEN}   From: $backup_filename${NC}"
}

list_backups() {
    echo -e "${BLUE}📋 Available backups in $BACKUP_DIR:${NC}"
    
    if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR"/*.sql.gz 2>/dev/null)" ]; then
        echo -e "${YELLOW}No backups found${NC}"
        return
    fi
    
    echo ""
    printf "%-40s %10s %20s\n" "FILENAME" "SIZE" "DATE"
    echo "────────────────────────────────────────────────────────────────────────"
    
    ls -lh "$BACKUP_DIR"/capital-tracker-backup-*.sql.gz 2>/dev/null | while read -r line; do
        size=$(echo "$line" | awk '{print $5}')
        date=$(echo "$line" | awk '{print $6, $7, $8}')
        filename=$(basename "$(echo "$line" | awk '{print $9}')")
        printf "%-40s %10s %20s\n" "$filename" "$size" "$date"
    done
    echo ""
}

cleanup_old_backups() {
    local keep_count=${1:-10}
    
    echo -e "${BLUE}🧹 Cleaning up old backups (keeping last $keep_count)...${NC}"
    
    if [ ! -d "$BACKUP_DIR" ]; then
        echo -e "${YELLOW}Backup directory does not exist${NC}"
        return
    fi
    
    cd "$BACKUP_DIR"
    local total_count=$(ls -1 capital-tracker-backup-*.sql.gz 2>/dev/null | wc -l)
    
    if [ "$total_count" -le "$keep_count" ]; then
        echo -e "${GREEN}✅ Only $total_count backups found, no cleanup needed${NC}"
        return
    fi
    
    local to_delete=$(( total_count - keep_count ))
    echo -e "${YELLOW}Deleting $to_delete old backup(s)...${NC}"
    
    ls -t capital-tracker-backup-*.sql.gz | tail -n +$(( keep_count + 1 )) | while read -r file; do
        echo -e "${YELLOW}  Removing: $file${NC}"
        rm "$file"
    done
    
    echo -e "${GREEN}✅ Cleanup complete. Kept $keep_count most recent backups${NC}"
}

# Main script
case "${1:-}" in
    backup)
        backup_database
        ;;
    restore)
        restore_database "$2"
        ;;
    list)
        list_backups
        ;;
    cleanup)
        cleanup_old_backups "${2:-10}"
        ;;
    *)
        echo "Database Backup & Restore Utility"
        echo ""
        echo "Usage:"
        echo "  $0 backup                    - Create new backup"
        echo "  $0 restore FILENAME          - Restore from specific backup"
        echo "  $0 list                      - List available backups"
        echo "  $0 cleanup [KEEP_COUNT]      - Remove old backups (default: keep last 10)"
        echo ""
        echo "Examples:"
        echo "  $0 backup"
        echo "  $0 list"
        echo "  $0 restore capital-tracker-backup-20251126-150000.sql.gz"
        echo "  $0 cleanup 5"
        exit 1
        ;;
esac

