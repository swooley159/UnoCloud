# UnoCloud

On-premise to SharePoint file migration tool for Azure tenants. Automate file synchronization from local file servers to SharePoint Online across multiple client tenants.

## Features

- **Multi-tenant support**: Manage multiple Azure AD tenants, each with their own credentials
- **Flexible mappings**: Map local directories to SharePoint sites/libraries
- **Incremental sync**: Only upload new or changed files (based on file hash)
- **Large file support**: Chunked uploads for files over 4MB (up to 250GB)
- **Progress tracking**: SQLite database tracks sync state and history
- **Dry run mode**: Preview changes before uploading
- **CLI interface**: Easy-to-use command line tool

## Installation

```bash
# Clone the repository
git clone https://github.com/swooley159/UnoCloud.git
cd UnoCloud

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional)
npm link
```

## Quick Start

### 1. Register an Azure AD Application

For each client tenant, register an application in Azure AD:

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Click "New registration"
3. Name: `UnoCloud Migration`
4. Supported account types: "Accounts in this organizational directory only"
5. Click "Register"

Grant API permissions:
- Microsoft Graph → Application permissions:
  - `Sites.ReadWrite.All`
  - `Files.ReadWrite.All`
- Click "Grant admin consent"

Create a client secret:
- Certificates & secrets → New client secret
- Copy the secret value (you won't see it again!)

### 2. Add a Tenant

```bash
unocloud tenant add \
  --name "Contoso" \
  --tenant-id "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
  --client-id "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
  --client-secret "your-secret-here" \
  --test
```

### 3. Add a Mapping

```bash
unocloud mapping add contoso \
  --source /path/to/local/files \
  --site https://contoso.sharepoint.com/sites/Documents \
  --library "Shared Documents" \
  --folder "Migrated/2024"
```

### 4. Run Sync

```bash
# Dry run first
unocloud sync run contoso --dry-run

# Actual sync
unocloud sync run contoso
```

## CLI Commands

### Tenant Management

```bash
# Add a tenant
unocloud tenant add -n <name> -t <tenant-id> -c <client-id> -s <secret>

# List tenants
unocloud tenant list

# Show tenant details
unocloud tenant show <tenant-id>

# Test authentication
unocloud tenant test <tenant-id>

# Remove a tenant
unocloud tenant remove <tenant-id> --force
```

### Mapping Management

```bash
# Add a mapping
unocloud mapping add <tenant-id> \
  --source <local-path> \
  --site <sharepoint-url> \
  --library <library-name> \
  [--folder <folder-path>] \
  [--include "*.docx,*.xlsx"] \
  [--exclude "*.tmp,~*"]

# List mappings
unocloud mapping list <tenant-id>

# Remove a mapping
unocloud mapping remove <tenant-id> <mapping-index>

# Enable/disable a mapping
unocloud mapping toggle <tenant-id> <mapping-index> --disable
```

### Sync Operations

```bash
# Sync a specific tenant
unocloud sync run <tenant-id>

# Sync with dry run
unocloud sync run <tenant-id> --dry-run

# Sync specific mapping only
unocloud sync run <tenant-id> --mapping 1

# Sync all tenants
unocloud sync all

# Verbose output
unocloud sync run <tenant-id> --verbose
```

### Status & History

```bash
# Show sync status
unocloud status show <tenant-id>

# List failed files
unocloud status failed <tenant-id>

# Clear sync history
unocloud status clear <tenant-id> --force
```

## Configuration

Configuration is stored in `.unocloud/` directory:

```
.unocloud/
├── tenants.json      # Tenant configurations (secrets encrypted)
├── data/
│   └── unocloud.db   # SQLite sync tracking database
└── logs/
    ├── combined.log  # All logs
    └── error.log     # Error logs only
```

### Environment Variables

```bash
UNOCLOUD_CONFIG_DIR   # Override config directory
UNOCLOUD_DATA_DIR     # Override data directory
UNOCLOUD_LOG_DIR      # Override log directory
LOG_LEVEL             # Log level: debug, info, warn, error
```

## Sync Options

Configure per-tenant sync behavior:

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `incremental` | `full` or `incremental` |
| `deleteAfterSync` | `false` | Delete local files after successful sync |
| `preserveFolderStructure` | `true` | Maintain source directory structure |
| `conflictResolution` | `skip` | `skip`, `overwrite`, or `rename` |
| `maxConcurrentUploads` | `3` | Parallel upload limit |
| `retryAttempts` | `3` | Retry failed uploads |

## SharePoint Limits

- Maximum file size: 250 GB
- Maximum path length: 400 characters
- Invalid characters in names: `~ # % & * { } \ : < > ? / |`

UnoCloud automatically handles:
- Chunked uploads for large files
- Character sanitization in file/folder names
- Throttling and retry with exponential backoff

## License

MIT
